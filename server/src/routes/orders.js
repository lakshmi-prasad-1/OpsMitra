import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, positiveInt, positiveId, calculateAmountCents, amountCentsToNumber, MAX_AMOUNT_CENTS, MYSQL_INT_UNSIGNED_MAX, cleanString } from '../utils/validation.js';
import { getOrderTransition } from '../services/orderRules.js';
import { createSaleFromOrder } from '../services/orderSales.js';
import { validRequestKey, requestFingerprint } from '../utils/idempotency.js';
import { findIdempotentOrder, idempotencyReplayState, orderResponse } from '../services/idempotency.js';
import { logMovement } from '../services/stock.js';
import { nextNumber } from '../services/numbering.js';
import { pageParams, pageMeta, likePattern, isDateOnly, nextDay, PAYMENT_METHODS } from '../utils/pagination.js';
const router = Router();
const owner = req => Number(req.user.sub);
const validStatuses = new Set(['pending','processing','ready','completed','cancelled']);

const orderColumns = `o.id, o.order_number AS orderNumber, o.status, o.total_amount AS totalAmount, o.order_date AS orderDate, o.stock_deducted AS stockDeducted,
  o.customer_id AS customerId, c.name AS customerName, o.expected_date AS expectedDate, COALESCE(item_counts.lineCount, 0) AS lineCount`;
const orderFrom = `FROM orders o LEFT JOIN customers c ON c.id=o.customer_id AND c.owner_id=o.owner_id
  LEFT JOIN (SELECT order_id, COUNT(*) AS lineCount FROM order_items GROUP BY order_id) item_counts ON item_counts.order_id=o.id`;
const shapeOrder = row => ({ ...row, id: Number(row.id), totalAmount: Number(row.totalAmount), lineCount: Number(row.lineCount), stockDeducted: Number(row.stockDeducted) === 1, customerId: row.customerId == null ? null : Number(row.customerId) });

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query);
  const where = ['o.owner_id = ?']; const params = [owner(req)];
  const q = cleanString(req.query.q);
  if (q) { where.push("(o.order_number LIKE ? ESCAPE '\\' OR COALESCE(c.name, '') LIKE ? ESCAPE '\\')"); params.push(likePattern(q), likePattern(q)); }
  if (validStatuses.has(req.query.status)) { where.push('o.status = ?'); params.push(req.query.status); }
  if (req.query.status === 'open') where.push("o.status IN ('pending','processing','ready')");
  if (isDateOnly(req.query.from)) { where.push('o.order_date >= ?'); params.push(req.query.from); }
  if (isDateOnly(req.query.to)) { where.push('o.order_date < ?'); params.push(nextDay(req.query.to)); }
  if (positiveId(req.query.customerId)) { where.push('o.customer_id = ?'); params.push(Number(req.query.customerId)); }
  const clause = where.join(' AND ');
  const [[count]] = await pool.execute(`SELECT COUNT(*) AS total ${orderFrom} WHERE ${clause}`, params);
  const [rows] = await pool.execute(`SELECT ${orderColumns} ${orderFrom} WHERE ${clause} ORDER BY o.order_date DESC, o.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  res.json({ data: rows.map(shapeOrder), meta: pageMeta(page, pageSize, count.total) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found.' });
  const [rows] = await pool.execute(`SELECT ${orderColumns}, o.notes, o.updated_at AS updatedAt, c.phone AS customerPhone, c.email AS customerEmail, s.id AS saleId, s.sale_number AS saleNumber ${orderFrom} LEFT JOIN sales s ON s.owner_id=o.owner_id AND s.source_order_id=o.id WHERE o.owner_id = ? AND o.id = ?`, [owner(req), req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found.' });
  const [items] = await pool.execute('SELECT oi.id, oi.product_id AS productId, p.name, p.sku, p.unit, oi.quantity, oi.unit_price AS unitPrice, oi.line_total AS lineTotal FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id = ? ORDER BY oi.id', [rows[0].id]);
  res.json({ data: { ...shapeOrder(rows[0]), notes: rows[0].notes, updatedAt: rows[0].updatedAt, saleId: rows[0].saleId == null ? null : Number(rows[0].saleId), saleNumber: rows[0].saleNumber, customer: rows[0].customerId ? { name: rows[0].customerName, phone: rows[0].customerPhone, email: rows[0].customerEmail } : null, items: items.map(i => ({ ...i, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), lineTotal: Number(i.lineTotal) })) } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const items = req.body.items;
  if (!Array.isArray(items) || !items.length || items.length > 100) return badRequest(res, 'An order must contain between 1 and 100 product lines.', 'items');
  if (!validRequestKey(req.body.requestKey)) return badRequest(res, 'A UUID requestKey is required so retries cannot create duplicate orders.', 'requestKey');
  const requestKey = req.body.requestKey.toLowerCase();
  let customerId = null;
  if (req.body.customerId !== undefined && req.body.customerId !== null && req.body.customerId !== '') {
    if (!positiveId(req.body.customerId)) return badRequest(res, 'Customer ID must be a valid positive integer.', 'customerId');
    customerId = Number(req.body.customerId);
  }
  const status = req.body.status ? String(req.body.status).toLowerCase() : 'pending';
  if (!validStatuses.has(status)) return badRequest(res, 'Invalid order status.', 'status');
  const notes = cleanString(req.body.notes).slice(0, 500) || null;
  const expectedDate = isDateOnly(req.body.expectedDate) ? req.body.expectedDate : null;
  const createPayment = req.body.paymentMethod ? String(req.body.paymentMethod).toLowerCase() : 'cash';
  if (!PAYMENT_METHODS.includes(createPayment)) return badRequest(res, 'Payment method must be cash, upi, card, bank or credit.', 'paymentMethod');
  const merged = new Map();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !positiveId(item.productId) || !positiveInt(item.quantity)) return badRequest(res, 'Each order line needs a valid productId and positive whole-number quantity.', 'items');
    const productId = Number(item.productId);
    const quantity = (merged.get(productId) || 0) + Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity > MYSQL_INT_UNSIGNED_MAX) return badRequest(res, 'Combined quantity for a product cannot exceed the database stock limit.', 'items');
    merged.set(productId, quantity);
  }
  const normalizedItems = [...merged].sort((a, b) => a[0] - b[0]).map(([productId, quantity]) => ({ productId, quantity }));
  const requestHash = requestFingerprint(customerId, normalizedItems, { status, pay: status === 'completed' ? createPayment : null });
  const ownerId = owner(req);
  const replay = async executor => {
    const prior = await findIdempotentOrder(executor, ownerId, requestKey);
    const state = idempotencyReplayState(prior, requestHash);
    if (state === 'missing') return null;
    if (state === 'conflict') return { conflict: true };
    return { data: orderResponse(prior), replayed: true };
  };
  const existing = await replay(pool);
  if (existing?.conflict) return res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED', message: 'This requestKey was already used for a different order. Start a new order with a new request key.' });
  if (existing) return res.status(200).json(existing);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const duringTransaction = await replay(connection);
    if (duringTransaction?.conflict) { await connection.rollback(); return res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED', message: 'This requestKey was already used for a different order. Start a new order with a new request key.' }); }
    if (duringTransaction) { await connection.commit(); return res.status(200).json(duringTransaction); }

    let totalCents = 0n; const pricedItems = [];
    for (const { productId, quantity } of normalizedItems) {
      const [rows] = await connection.execute('SELECT id, name, selling_price, quantity, is_active FROM products WHERE id = ? AND owner_id = ? FOR UPDATE', [productId, ownerId]);
      if (!rows.length || !rows[0].is_active) { const e = new Error('One of the selected products was not found in your workspace.'); e.status = 404; throw e; }
      const product = rows[0];
      const unitPrice = Number(product.selling_price);
      const lineCents = calculateAmountCents(unitPrice, quantity);
      if (lineCents === null || totalCents + lineCents > MAX_AMOUNT_CENTS) { const e = new Error('Order total exceeds the supported maximum of ₹9,999,999,999.99.'); e.status = 400; e.code = 'AMOUNT_TOO_LARGE'; throw e; }
      totalCents += lineCents;
      pricedItems.push({ productId, quantity, unitPrice, lineTotal: amountCentsToNumber(lineCents), available: Number(product.quantity), name: product.name });
    }
    if (customerId) { const [customers] = await connection.execute('SELECT id FROM customers WHERE id = ? AND owner_id = ? AND is_active = 1', [customerId, ownerId]); if (!customers.length) { const e = new Error('Customer not found in your workspace.'); e.status = 400; throw e; } }
    if (status === 'completed') {
      if (!pricedItems.length) { const e = new Error('A completed order must include at least one item.'); e.status = 400; throw e; }
      for (const item of pricedItems) if (item.available < item.quantity) { const e = new Error(`Not enough stock for ${item.name}. Available: ${item.available}.`); e.status = 409; e.code = 'INSUFFICIENT_STOCK'; throw e; }
    }
    const deducted = status === 'completed';
    const orderNumber = await nextNumber(connection, 'orders', ownerId, 'ORD');
    const totalAmount = amountCentsToNumber(totalCents);
    const [result] = await connection.execute('INSERT INTO orders (owner_id, order_number, customer_id, status, total_amount, stock_deducted, request_key, request_hash, notes, expected_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [ownerId, orderNumber, customerId, status, totalAmount, deducted, requestKey, requestHash, notes, expectedDate]);
    for (const item of pricedItems) {
      await connection.execute('INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)', [result.insertId,item.productId,item.quantity,item.unitPrice,item.lineTotal]);
      if (deducted) {
        const [stockResult] = await connection.execute('UPDATE products SET quantity = quantity - ? WHERE id = ? AND owner_id = ? AND quantity >= ?', [item.quantity,item.productId,ownerId,item.quantity]);
        if (Number(stockResult.affectedRows) !== 1) { const e = new Error('Stock changed before the order could be completed. No order was recorded; refresh inventory and retry.'); e.status = 409; e.code = 'INSUFFICIENT_STOCK'; throw e; }
        await logMovement(connection, { ownerId, productId: item.productId, type: 'order', change: -item.quantity, after: item.available - item.quantity, refType: 'order', refId: Number(result.insertId), note: orderNumber });
      }
    }
    const linkedSale = deducted ? await createSaleFromOrder(connection, ownerId, result.insertId, { paymentMethod: createPayment }) : null;
    await connection.commit();
    res.status(201).json({ data: { id: Number(result.insertId), orderNumber, status, totalAmount, stockDeducted: deducted, saleId: linkedSale?.id ?? null } });
  } catch (error) {
    await connection.rollback();
    if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) {
      const recovered = await replay(connection);
      if (recovered?.conflict) return res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED', message: 'This requestKey was already used for a different order. Start a new order with a new request key.' });
      if (recovered) return res.status(200).json(recovered);
      if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) return res.status(503).json({ error: 'RETRYABLE_TRANSACTION_CONFLICT', message: 'A concurrent order request conflicted with this transaction. Retry the same request with the same requestKey.' });
    }
    if (error.status) return res.status(error.status).json({ error: error.code || 'ORDER_FAILED', message: error.message });
    throw error;
  } finally { connection.release(); }
}));

router.patch('/:id/status', asyncHandler(async (req, res) => {
  const nextStatus = String(req.body.status || '').toLowerCase();
  const settlement = req.body.paymentMethod ? String(req.body.paymentMethod).toLowerCase() : 'cash';
  if (!validStatuses.has(nextStatus)) return badRequest(res, 'Status must be pending, processing, ready, completed, or cancelled.', 'status');
  if (!PAYMENT_METHODS.includes(settlement)) return badRequest(res, 'Payment method must be cash, upi, card, bank or credit.', 'paymentMethod');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [orders] = await connection.execute('SELECT id, status, stock_deducted FROM orders WHERE id = ? AND owner_id = ? FOR UPDATE', [req.params.id, owner(req)]);
    if (!orders.length) { await connection.rollback(); return res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found.' }); }
    const order = orders[0];
    const transition = getOrderTransition(order.status, nextStatus, Number(order.stock_deducted) === 1);
    if (!transition.ok) {
      await connection.rollback();
      return res.status(transition.status).json({ error: transition.code, message: transition.message });
    }
    // Validate linkage on every transition, not only on completion. This prevents an unexpected
    // sale link from remaining active if someone tries to cancel a damaged pending-order record.
    const [linkedSales] = await connection.execute('SELECT id, status FROM sales WHERE owner_id = ? AND source_order_id = ? FOR UPDATE', [owner(req), order.id]);
    let linkedSale = null;
    const linkageInconsistent = order.status === 'completed'
      ? linkedSales.length !== 1 || linkedSales[0]?.status !== 'completed'
      : order.status === 'cancelled'
        ? linkedSales.length > 1 || (linkedSales.length === 1 && linkedSales[0].status !== 'voided')
        : linkedSales.length > 0;
    if (linkageInconsistent) {
      await connection.rollback();
      return res.status(409).json({ error: 'ORDER_SALE_INCONSISTENT', message: 'The order status and its linked sales record do not agree. Run the order-sales migration or reconcile this order before changing it.' });
    }
    if (linkedSales.length === 1) linkedSale = linkedSales[0];
    if (transition.shouldDeductStock) {
      const [items] = await connection.execute('SELECT oi.product_id AS productId, oi.quantity, p.name, p.quantity AS available FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id = ? AND p.owner_id = ? ORDER BY p.id FOR UPDATE', [order.id, owner(req)]);
      for (const item of items) if (Number(item.available) < Number(item.quantity)) { await connection.rollback(); return res.status(409).json({ error: 'INSUFFICIENT_STOCK', message: `Not enough stock for ${item.name}. Available: ${item.available}.` }); }
      for (const item of items) {
        await connection.execute('UPDATE products SET quantity = quantity - ? WHERE id = ? AND owner_id = ?', [item.quantity,item.productId,owner(req)]);
        await logMovement(connection, { ownerId: owner(req), productId: item.productId, type: 'order', change: -Number(item.quantity), after: Number(item.available) - Number(item.quantity), refType: 'order', refId: Number(order.id), note: 'Order completed' });
      }
      await connection.execute('UPDATE orders SET stock_deducted = 1 WHERE id = ? AND owner_id = ?', [order.id, owner(req)]);
    }
    if (transition.shouldRestoreStock) {
      const [items] = await connection.execute('SELECT oi.product_id AS productId, oi.quantity, p.quantity AS currentQuantity, p.name FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? AND p.owner_id = ? ORDER BY p.id FOR UPDATE', [order.id, owner(req)]);
      for (const item of items) {
        if (Number(item.currentQuantity) + Number(item.quantity) > MYSQL_INT_UNSIGNED_MAX) {
          await connection.rollback();
          return res.status(409).json({ error: 'STOCK_LIMIT_EXCEEDED', message: `Restoring ${item.name} would exceed the maximum supported stock quantity. Adjust its stock count before cancelling this order.` });
        }
      }
      for (const item of items) {
        await connection.execute('UPDATE products SET quantity = quantity + ? WHERE id = ? AND owner_id = ?', [item.quantity,item.productId,owner(req)]);
        await logMovement(connection, { ownerId: owner(req), productId: item.productId, type: 'order_cancel', change: Number(item.quantity), after: Number(item.currentQuantity) + Number(item.quantity), refType: 'order', refId: Number(order.id), note: 'Completed order cancelled' });
      }
      await connection.execute('UPDATE orders SET stock_deducted = 0 WHERE id = ? AND owner_id = ?', [order.id, owner(req)]);
    }
    if (transition.shouldDeductStock) {
      linkedSale = await createSaleFromOrder(connection, owner(req), order.id, { paymentMethod: settlement });
    } else if (transition.shouldRestoreStock) {
      const [voidResult] = await connection.execute("UPDATE sales SET status = 'voided' WHERE id = ? AND owner_id = ? AND source_order_id = ? AND status = 'completed'", [linkedSale.id, owner(req), order.id]);
      if (Number(voidResult.affectedRows) !== 1) {
        const error = new Error('The linked sale could not be voided safely. No stock or order changes were committed.');
        error.status = 409; error.code = 'ORDER_SALE_INCONSISTENT'; throw error;
      }
    }
    await connection.execute('UPDATE orders SET status = ? WHERE id = ? AND owner_id = ?', [nextStatus,order.id,owner(req)]);
    await connection.commit();
    res.json({ data: { id: Number(order.id), status: nextStatus, saleId: linkedSale?.id ?? null } });
  } catch (error) {
    await connection.rollback();
    if (error.status && error.status < 500) return res.status(error.status).json({ error: error.code || 'ORDER_FAILED', message: error.message });
    throw error;
  } finally { connection.release(); }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found.' });
  const notes = req.body.notes === undefined ? undefined : (cleanString(req.body.notes).slice(0, 500) || null);
  const expected = req.body.expectedDate === undefined ? undefined : (isDateOnly(req.body.expectedDate) ? req.body.expectedDate : null);
  const sets = []; const params = [];
  if (notes !== undefined) { sets.push('notes = ?'); params.push(notes); }
  if (expected !== undefined) { sets.push('expected_date = ?'); params.push(expected); }
  if (!sets.length) return badRequest(res, 'Provide notes or expectedDate to update.');
  const [result] = await pool.execute(`UPDATE orders SET ${sets.join(', ')} WHERE id = ? AND owner_id = ?`, [...params, req.params.id, owner(req)]);
  if (!result.affectedRows) return res.status(404).json({ error: 'NOT_FOUND', message: 'Order not found.' });
  res.json({ data: { id: Number(req.params.id) } });
}));
export default router;
