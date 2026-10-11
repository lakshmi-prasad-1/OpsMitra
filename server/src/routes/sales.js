import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, positiveInt, positiveId, calculateAmountCents, amountCentsToNumber, MAX_AMOUNT_CENTS, MYSQL_INT_UNSIGNED_MAX, validMoney, cleanString } from '../utils/validation.js';
import { validRequestKey, requestFingerprint } from '../utils/idempotency.js';
import { findIdempotentSale, idempotencyReplayState, saleResponse } from '../services/idempotency.js';
import { logMovement } from '../services/stock.js';
import { nextNumber } from '../services/numbering.js';
import { pageParams, pageMeta, likePattern, isDateOnly, nextDay, PAYMENT_METHODS, paymentStatus } from '../utils/pagination.js';
const router = Router();
const owner = req => Number(req.user.sub);

const saleColumns = `s.id, s.sale_number AS saleNumber, s.total_amount AS totalAmount, s.subtotal, s.discount_amount AS discountAmount, s.tax_amount AS taxAmount,
  s.sale_date AS saleDate, s.status AS saleStatus, s.source_order_id AS sourceOrderId, s.payment_method AS paymentMethod, s.amount_paid AS amountPaid,
  s.customer_id AS customerId, c.name AS customerName, COALESCE(item_counts.lineCount, 0) AS lineCount`;
const saleFrom = `FROM sales s LEFT JOIN customers c ON c.id=s.customer_id AND c.owner_id=s.owner_id
  LEFT JOIN (SELECT sale_id, COUNT(*) AS lineCount FROM sale_items GROUP BY sale_id) item_counts ON item_counts.sale_id=s.id`;

function shapeSale(row) {
  const total = Number(row.totalAmount), paid = Number(row.amountPaid);
  return {
    ...row, id: Number(row.id), totalAmount: total, subtotal: Number(row.subtotal), discountAmount: Number(row.discountAmount), taxAmount: Number(row.taxAmount),
    amountPaid: paid, lineCount: Number(row.lineCount), customerId: row.customerId == null ? null : Number(row.customerId),
    balanceDue: row.saleStatus === 'completed' ? Math.max(0, Math.round((total - paid) * 100) / 100) : 0,
    paymentStatus: row.saleStatus === 'completed' ? paymentStatus(total, paid) : 'void'
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query);
  const where = ['s.owner_id = ?']; const params = [owner(req)];
  const q = cleanString(req.query.q);
  if (q) { where.push("(s.sale_number LIKE ? ESCAPE '\\' OR COALESCE(c.name, '') LIKE ? ESCAPE '\\')"); params.push(likePattern(q), likePattern(q)); }
  const status = cleanString(req.query.status);
  if (['completed', 'voided'].includes(status)) { where.push('s.status = ?'); params.push(status); }
  if (req.query.type === 'direct') where.push('s.source_order_id IS NULL');
  if (req.query.type === 'order') where.push('s.source_order_id IS NOT NULL');
  if (PAYMENT_METHODS.includes(req.query.method)) { where.push('s.payment_method = ?'); params.push(req.query.method); }
  if (req.query.payment === 'unpaid') where.push("s.status = 'completed' AND s.amount_paid <= 0 AND s.total_amount > 0");
  if (req.query.payment === 'partial') where.push("s.status = 'completed' AND s.amount_paid > 0 AND s.amount_paid < s.total_amount");
  if (req.query.payment === 'paid') where.push("s.status = 'completed' AND s.amount_paid >= s.total_amount");
  if (req.query.payment === 'due') where.push("s.status = 'completed' AND s.amount_paid < s.total_amount");
  if (isDateOnly(req.query.from)) { where.push('s.sale_date >= ?'); params.push(req.query.from); }
  if (isDateOnly(req.query.to)) { where.push('s.sale_date < ?'); params.push(nextDay(req.query.to)); }
  if (positiveId(req.query.customerId)) { where.push('s.customer_id = ?'); params.push(Number(req.query.customerId)); }
  const clause = where.join(' AND ');
  const [[count]] = await pool.execute(`SELECT COUNT(*) AS total ${saleFrom} WHERE ${clause}`, params);
  const [rows] = await pool.execute(`SELECT ${saleColumns} ${saleFrom} WHERE ${clause} ORDER BY s.sale_date DESC, s.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  res.json({ data: rows.map(shapeSale), meta: pageMeta(page, pageSize, count.total) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Sale not found.' });
  const [rows] = await pool.execute(`SELECT ${saleColumns}, s.notes, c.phone AS customerPhone, c.email AS customerEmail, c.address AS customerAddress ${saleFrom} WHERE s.owner_id = ? AND s.id = ?`, [owner(req), req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: 'Sale not found.' });
  const sale = shapeSale(rows[0]);
  const [items] = await pool.execute('SELECT si.id, si.product_id AS productId, p.name, p.sku, p.unit, si.quantity, si.unit_price AS unitPrice, si.line_total AS lineTotal, si.tax_rate AS taxRate FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? ORDER BY si.id', [sale.id]);
  const [payments] = await pool.execute('SELECT id, amount, method, note, paid_at AS paidAt FROM customer_payments WHERE owner_id = ? AND sale_id = ? ORDER BY paid_at', [owner(req), sale.id]);
  const [[business]] = await pool.execute('SELECT business_name AS businessName, business_phone AS businessPhone, business_address AS businessAddress, gstin, name AS ownerName FROM users WHERE id = ?', [owner(req)]);
  res.json({ data: { ...sale, notes: rows[0].notes, customer: sale.customerId ? { name: rows[0].customerName, phone: rows[0].customerPhone, email: rows[0].customerEmail, address: rows[0].customerAddress } : null, items: items.map(i => ({ ...i, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), lineTotal: Number(i.lineTotal), taxRate: Number(i.taxRate) })), payments: payments.map(p => ({ ...p, amount: Number(p.amount) })), business } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const items = req.body.items;
  if (!Array.isArray(items) || !items.length || items.length > 100) return badRequest(res, 'A sale must contain between 1 and 100 product lines.', 'items');
  if (!validRequestKey(req.body.requestKey)) return badRequest(res, 'A UUID requestKey is required so retries cannot create duplicate sales.', 'requestKey');
  const requestKey = req.body.requestKey.toLowerCase();
  let customerId = null;
  if (req.body.customerId !== undefined && req.body.customerId !== null && req.body.customerId !== '') {
    if (!positiveId(req.body.customerId)) return badRequest(res, 'Customer ID must be a valid positive integer.', 'customerId');
    customerId = Number(req.body.customerId);
  }
  const discountInput = req.body.discountAmount ?? 0;
  if (!validMoney(discountInput)) return badRequest(res, 'Discount must be a non-negative amount with at most two decimals.', 'discountAmount');
  const discountCents = Math.round(Number(discountInput) * 100);
  const paymentMethod = String(req.body.paymentMethod || 'cash').toLowerCase();
  if (!PAYMENT_METHODS.includes(paymentMethod)) return badRequest(res, 'Payment method must be cash, upi, card, bank or credit.', 'paymentMethod');
  if (req.body.amountPaid !== undefined && req.body.amountPaid !== null && req.body.amountPaid !== '' && !validMoney(req.body.amountPaid)) return badRequest(res, 'Amount paid must be a non-negative amount with at most two decimals.', 'amountPaid');
  const notes = cleanString(req.body.notes).slice(0, 500) || null;
  const merged = new Map();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !positiveId(item.productId) || !positiveInt(item.quantity)) return badRequest(res, 'Each sale line needs a valid productId and positive whole-number quantity.', 'items');
    const productId = Number(item.productId);
    const quantity = (merged.get(productId) || 0) + Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity > MYSQL_INT_UNSIGNED_MAX) return badRequest(res, 'Combined quantity for a product cannot exceed the database stock limit.', 'items');
    merged.set(productId, quantity);
  }
  const normalizedItems = [...merged].sort((a, b) => a[0] - b[0]).map(([productId, quantity]) => ({ productId, quantity }));
  const paidInput = req.body.amountPaid === undefined || req.body.amountPaid === null || req.body.amountPaid === '' ? null : Math.round(Number(req.body.amountPaid) * 100);
  const requestHash = requestFingerprint(customerId, normalizedItems, { discountCents, paymentMethod, paidInput });
  const ownerId = owner(req);
  const replay = async executor => {
    const prior = await findIdempotentSale(executor, ownerId, requestKey);
    const state = idempotencyReplayState(prior, requestHash);
    if (state === 'missing') return null;
    if (state === 'conflict') return { conflict: true };
    return { data: saleResponse(prior), replayed: true };
  };
  const existing = await replay(pool);
  if (existing?.conflict) return res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED', message: 'This requestKey was already used for a different sale. Start a new sale with a new request key.' });
  if (existing) return res.status(200).json(existing);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const duringTransaction = await replay(connection);
    if (duringTransaction?.conflict) { await connection.rollback(); return res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED', message: 'This requestKey was already used for a different sale. Start a new sale with a new request key.' }); }
    if (duringTransaction) { await connection.commit(); return res.status(200).json(duringTransaction); }

    const pricedItems = []; let totalCents = 0n; let taxCentsRaw = 0;
    for (const { productId, quantity } of normalizedItems) {
      const [rows] = await connection.execute('SELECT id, name, selling_price, cost_price, tax_rate, quantity FROM products WHERE id = ? AND owner_id = ? AND is_active = 1 FOR UPDATE', [productId, ownerId]);
      if (!rows.length) { const e = new Error('One of the selected products was not found in your workspace.'); e.status = 404; throw e; }
      const product = rows[0];
      if (Number(product.quantity) < quantity) { const e = new Error(`Not enough stock for ${product.name}. Available: ${product.quantity}.`); e.status = 409; e.code = 'INSUFFICIENT_STOCK'; throw e; }
      const unitPrice = Number(product.selling_price);
      const lineCents = calculateAmountCents(unitPrice, quantity);
      if (lineCents === null || totalCents + lineCents > MAX_AMOUNT_CENTS) { const e = new Error('Sale total exceeds the supported maximum of ₹9,999,999,999.99.'); e.status = 400; e.code = 'AMOUNT_TOO_LARGE'; throw e; }
      totalCents += lineCents;
      const taxRate = Number(product.tax_rate || 0);
      taxCentsRaw += Number(lineCents) * taxRate / (100 + taxRate);
      pricedItems.push({ productId, name: product.name, available: Number(product.quantity), quantity, unitPrice, unitCost: Number(product.cost_price || 0), taxRate, lineTotal: amountCentsToNumber(lineCents) });
    }
    const subtotalCents = Number(totalCents);
    if (discountCents > subtotalCents) { const e = new Error('Discount cannot be more than the sale subtotal.'); e.status = 400; e.code = 'VALIDATION_ERROR'; throw e; }
    const grandCents = subtotalCents - discountCents;
    const taxCents = Math.round(taxCentsRaw * (subtotalCents ? grandCents / subtotalCents : 0));
    const paidCents = paidInput === null ? (paymentMethod === 'credit' ? 0 : grandCents) : paidInput;
    if (paidCents > grandCents) { const e = new Error('Amount paid cannot be more than the sale total.'); e.status = 400; e.code = 'VALIDATION_ERROR'; throw e; }
    if (paidCents < grandCents && !customerId) { const e = new Error('Choose a customer to sell on credit or accept partial payment.'); e.status = 400; e.code = 'CUSTOMER_REQUIRED'; throw e; }
    if (customerId) { const [customers] = await connection.execute('SELECT id FROM customers WHERE id = ? AND owner_id = ? AND is_active = 1', [customerId, ownerId]); if (!customers.length) { const e = new Error('Customer not found in your workspace.'); e.status = 400; throw e; } }
    const saleNumber = await nextNumber(connection, 'sales', ownerId, 'INV');
    const [sale] = await connection.execute(
      'INSERT INTO sales (owner_id, sale_number, customer_id, subtotal, discount_amount, tax_amount, total_amount, payment_method, amount_paid, notes, request_key, request_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [ownerId, saleNumber, customerId, subtotalCents / 100, discountCents / 100, taxCents / 100, grandCents / 100, paymentMethod, paidCents / 100, notes, requestKey, requestHash]);
    for (const item of pricedItems) {
      await connection.execute('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total, unit_cost, tax_rate) VALUES (?, ?, ?, ?, ?, ?, ?)', [sale.insertId, item.productId, item.quantity, item.unitPrice, item.lineTotal, item.unitCost, item.taxRate]);
      const [stockResult] = await connection.execute('UPDATE products SET quantity = quantity - ? WHERE id = ? AND owner_id = ? AND quantity >= ?', [item.quantity, item.productId, ownerId, item.quantity]);
      if (Number(stockResult.affectedRows) !== 1) { const e = new Error('Stock changed before the sale could be committed. No sale was recorded; refresh inventory and retry.'); e.status = 409; e.code = 'INSUFFICIENT_STOCK'; throw e; }
      await logMovement(connection, { ownerId, productId: item.productId, type: 'sale', change: -item.quantity, after: item.available - item.quantity, refType: 'sale', refId: Number(sale.insertId), note: saleNumber });
    }
    await connection.commit();
    res.status(201).json({ data: { id: Number(sale.insertId), saleNumber, totalAmount: grandCents / 100, amountPaid: paidCents / 100, items: pricedItems.length, sourceOrderId: null, saleStatus: 'completed' } });
  } catch (error) {
    await connection.rollback();
    if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) {
      const recovered = await replay(connection);
      if (recovered?.conflict) return res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED', message: 'This requestKey was already used for a different sale. Start a new sale with a new request key.' });
      if (recovered) return res.status(200).json(recovered);
      if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) return res.status(503).json({ error: 'RETRYABLE_TRANSACTION_CONFLICT', message: 'A concurrent sale request conflicted with this transaction. Retry the same request with the same requestKey.' });
    }
    if (error.status) return res.status(error.status).json({ error: error.code || 'SALE_FAILED', message: error.message });
    throw error;
  } finally { connection.release(); }
}));

// Void a direct sale (returns everything to stock). Order-linked sales are voided by cancelling the order.
router.post('/:id/void', asyncHandler(async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Sale not found.' });
  const ownerId = owner(req);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [sales] = await connection.execute('SELECT id, sale_number AS saleNumber, status, source_order_id AS sourceOrderId FROM sales WHERE id = ? AND owner_id = ? FOR UPDATE', [req.params.id, ownerId]);
    if (!sales.length) { await connection.rollback(); return res.status(404).json({ error: 'NOT_FOUND', message: 'Sale not found.' }); }
    const sale = sales[0];
    if (sale.sourceOrderId) { await connection.rollback(); return res.status(409).json({ error: 'ORDER_LINKED_SALE', message: 'This sale came from an order. Cancel the order to void it and restore stock.' }); }
    if (sale.status !== 'completed') { await connection.rollback(); return res.status(409).json({ error: 'ALREADY_VOIDED', message: 'This sale is already voided.' }); }
    const [items] = await connection.execute('SELECT si.product_id AS productId, si.quantity, p.quantity AS currentQuantity FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? AND p.owner_id = ? ORDER BY p.id', [sale.id, ownerId]);
    for (const item of items) if (Number(item.currentQuantity) + Number(item.quantity) > MYSQL_INT_UNSIGNED_MAX) { await connection.rollback(); return res.status(409).json({ error: 'STOCK_LIMIT_EXCEEDED', message: 'Restoring this sale would exceed the maximum supported stock quantity.' }); }
    for (const item of items) {
      await connection.execute('UPDATE products SET quantity = quantity + ? WHERE id = ? AND owner_id = ?', [item.quantity, item.productId, ownerId]);
      await logMovement(connection, { ownerId, productId: item.productId, type: 'sale_void', change: Number(item.quantity), after: Number(item.currentQuantity) + Number(item.quantity), refType: 'sale', refId: Number(sale.id), note: `Void ${sale.saleNumber}` });
    }
    await connection.execute("UPDATE sales SET status = 'voided' WHERE id = ? AND owner_id = ?", [sale.id, ownerId]);
    await connection.commit();
    res.json({ data: { id: Number(sale.id), saleStatus: 'voided' } });
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));
export default router;
