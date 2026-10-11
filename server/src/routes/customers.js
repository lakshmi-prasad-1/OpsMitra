import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, cleanString, positiveId, validMoney } from '../utils/validation.js';
import { validRequestKey, payloadFingerprint } from '../utils/idempotency.js';
import { findIdempotentCustomer, idempotencyReplayState, customerResponse } from '../services/idempotency.js';
import { pageParams, pageMeta, likePattern } from '../utils/pagination.js';
const router = Router();
const owner = req => Number(req.user.sub);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Aggregates are computed from completed sales so voided/cancelled records never inflate balances.
const statsSelect = `c.id, c.name, c.phone, c.email, c.address, c.notes, c.is_active AS isActive, c.created_at AS createdAt,
  COALESCE(st.totalSpent, 0) AS totalSpent, COALESCE(st.saleCount, 0) AS saleCount, COALESCE(st.balance, 0) AS balance, st.lastPurchase AS lastPurchase`;
const statsFrom = `FROM customers c LEFT JOIN (
    SELECT customer_id, SUM(total_amount) AS totalSpent, COUNT(*) AS saleCount, SUM(total_amount - amount_paid) AS balance, MAX(sale_date) AS lastPurchase
    FROM sales WHERE owner_id = ? AND status = 'completed' AND customer_id IS NOT NULL GROUP BY customer_id) st ON st.customer_id = c.id`;
const shape = row => ({ ...row, id: Number(row.id), isActive: Number(row.isActive) === 1, totalSpent: Number(row.totalSpent), saleCount: Number(row.saleCount), balance: Math.max(0, Math.round(Number(row.balance) * 100) / 100) });

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query, 25, 500);
  const ownerId = owner(req);
  const where = ['c.owner_id = ?']; const params = [ownerId];
  const status = cleanString(req.query.status);
  if (status === 'archived') where.push('c.is_active = 0'); else where.push('c.is_active = 1');
  if (status === 'owing') where.push('COALESCE(st.balance, 0) > 0.004');
  const q = cleanString(req.query.q ?? req.query.search ?? '');
  if (q) { where.push("(c.name LIKE ? ESCAPE '\\' OR COALESCE(c.phone, '') LIKE ? ESCAPE '\\' OR COALESCE(c.email, '') LIKE ? ESCAPE '\\')"); params.push(likePattern(q), likePattern(q), likePattern(q)); }
  const sorts = { name: 'c.name COLLATE NOCASE ASC', spent: 'totalSpent DESC', balance: 'balance DESC', recent: 'lastPurchase DESC', created: 'c.created_at DESC' };
  const order = sorts[req.query.sort] || sorts.created;
  const clause = where.join(' AND ');
  const [[count]] = await pool.execute(`SELECT COUNT(*) AS total ${statsFrom} WHERE ${clause}`, [ownerId, ...params]);
  const [rows] = await pool.execute(`SELECT ${statsSelect} ${statsFrom} WHERE ${clause} ORDER BY ${order}, c.id DESC LIMIT ? OFFSET ?`, [ownerId, ...params, pageSize, offset]);
  res.json({ data: rows.map(shape), meta: pageMeta(page, pageSize, count.total) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Customer not found.' });
  const ownerId = owner(req);
  const [rows] = await pool.execute(`SELECT ${statsSelect} ${statsFrom} WHERE c.owner_id = ? AND c.id = ?`, [ownerId, ownerId, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: 'Customer not found.' });
  const [sales] = await pool.execute("SELECT id, sale_number AS saleNumber, sale_date AS saleDate, total_amount AS totalAmount, amount_paid AS amountPaid, payment_method AS paymentMethod, status FROM sales WHERE owner_id = ? AND customer_id = ? ORDER BY sale_date DESC, id DESC LIMIT 30", [ownerId, req.params.id]);
  const [payments] = await pool.execute('SELECT p.id, p.amount, p.method, p.note, p.paid_at AS paidAt, s.sale_number AS saleNumber FROM customer_payments p LEFT JOIN sales s ON s.id = p.sale_id WHERE p.owner_id = ? AND p.customer_id = ? ORDER BY p.paid_at DESC, p.id DESC LIMIT 30', [ownerId, req.params.id]);
  const [orders] = await pool.execute('SELECT id, order_number AS orderNumber, status, total_amount AS totalAmount, order_date AS orderDate FROM orders WHERE owner_id = ? AND customer_id = ? ORDER BY order_date DESC, id DESC LIMIT 10', [ownerId, req.params.id]);
  const [topItems] = await pool.execute("SELECT p.name, SUM(si.quantity) AS quantity FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id WHERE s.owner_id = ? AND s.customer_id = ? AND s.status = 'completed' GROUP BY p.id, p.name ORDER BY quantity DESC LIMIT 5", [ownerId, req.params.id]);
  res.json({ data: { ...shape(rows[0]),
    sales: sales.map(s => ({ ...s, id: Number(s.id), totalAmount: Number(s.totalAmount), amountPaid: Number(s.amountPaid) })),
    payments: payments.map(p => ({ ...p, id: Number(p.id), amount: Number(p.amount) })),
    orders: orders.map(o => ({ ...o, id: Number(o.id), totalAmount: Number(o.totalAmount) })),
    topItems: topItems.map(t => ({ name: t.name, quantity: Number(t.quantity) })) } });
}));

router.post('/', asyncHandler(async (req, res) => {
  if (!validRequestKey(req.body.requestKey)) return badRequest(res, 'A UUID requestKey is required so retries cannot create duplicate customers.', 'requestKey');
  const requestKey = req.body.requestKey.toLowerCase();
  const name = cleanString(req.body.name);
  const phone = cleanString(req.body.phone) || null;
  const email = cleanString(req.body.email).toLowerCase() || null;
  const address = cleanString(req.body.address).slice(0, 300) || null;
  const notes = cleanString(req.body.notes).slice(0, 500) || null;
  if (name.length < 2 || name.length > 160) return badRequest(res, 'Customer name must be 2–160 characters.', 'name');
  if (phone && phone.length > 32) return badRequest(res, 'Phone must be at most 32 characters.', 'phone');
  if (email && (!EMAIL.test(email) || email.length > 190)) return badRequest(res, 'Enter a valid email address.', 'email');

  const ownerId = owner(req);
  const requestHash = payloadFingerprint({ name, phone, email, address, notes });
  const replay = async executor => {
    const prior = await findIdempotentCustomer(executor, ownerId, requestKey);
    const state = idempotencyReplayState(prior, requestHash);
    if (state === 'missing') return null;
    if (state === 'conflict') return { conflict: true };
    return { data: customerResponse(prior), replayed: true };
  };
  const existing = await replay(pool);
  if (existing?.conflict) return res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED', message: 'This requestKey was already used for a different customer. Start a new customer record with a new request key.' });
  if (existing) return res.status(200).json(existing);

  try {
    const [result] = await pool.execute('INSERT INTO customers (owner_id, name, phone, email, address, notes, request_key, request_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [ownerId, name, phone, email, address, notes, requestKey, requestHash]);
    res.status(201).json({ data: { id: Number(result.insertId), name, phone, email } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      const recovered = await replay(pool);
      if (recovered?.conflict) return res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED', message: 'This requestKey was already used for a different customer. Start a new customer record with a new request key.' });
      if (recovered) return res.status(200).json(recovered);
    }
    throw error;
  }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const [found] = await pool.execute('SELECT id, name, phone, email, address, notes, is_active AS isActive FROM customers WHERE id = ? AND owner_id = ?', [req.params.id, owner(req)]);
  if (!found.length) return res.status(404).json({ error: 'NOT_FOUND', message: 'Customer not found.' });
  const current = found[0];
  const name = req.body.name === undefined ? current.name : cleanString(req.body.name);
  const phone = req.body.phone === undefined ? current.phone : (cleanString(req.body.phone) || null);
  const email = req.body.email === undefined ? current.email : (cleanString(req.body.email).toLowerCase() || null);
  const address = req.body.address === undefined ? current.address : (cleanString(req.body.address).slice(0, 300) || null);
  const notes = req.body.notes === undefined ? current.notes : (cleanString(req.body.notes).slice(0, 500) || null);
  const isActive = req.body.isActive === undefined ? Number(current.isActive) : (req.body.isActive ? 1 : 0);
  if (name.length < 2 || name.length > 160) return badRequest(res, 'Customer name must be 2–160 characters.', 'name');
  if (phone && phone.length > 32) return badRequest(res, 'Phone must be at most 32 characters.', 'phone');
  if (email && (!EMAIL.test(email) || email.length > 190)) return badRequest(res, 'Enter a valid email address.', 'email');
  await pool.execute('UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, notes = ?, is_active = ? WHERE id = ? AND owner_id = ?', [name, phone, email, address, notes, isActive, req.params.id, owner(req)]);
  res.json({ data: { id: Number(req.params.id), name, phone, email, address, notes, isActive: isActive === 1 } });
}));

// Archive instead of delete so past sales keep their customer name.
router.delete('/:id', asyncHandler(async (req, res) => {
  const [result] = await pool.execute('UPDATE customers SET is_active = 0 WHERE id = ? AND owner_id = ? AND is_active = 1', [req.params.id, owner(req)]);
  if (!result.affectedRows) return res.status(404).json({ error: 'NOT_FOUND', message: 'Customer not found.' });
  res.status(204).end();
}));

// Record a payment against what the customer owes. Allocated to a chosen sale, or oldest dues first.
router.post('/:id/payments', asyncHandler(async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Customer not found.' });
  if (!validMoney(req.body.amount) || Number(req.body.amount) <= 0) return badRequest(res, 'Enter a payment amount greater than zero (max two decimals).', 'amount');
  const method = String(req.body.method || 'cash').toLowerCase();
  if (!['cash', 'upi', 'card', 'bank'].includes(method)) return badRequest(res, 'Payment method must be cash, upi, card or bank.', 'method');
  const note = cleanString(req.body.note).slice(0, 200) || null;
  const ownerId = owner(req);
  let remaining = Math.round(Number(req.body.amount) * 100);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [customers] = await connection.execute('SELECT id FROM customers WHERE id = ? AND owner_id = ?', [req.params.id, ownerId]);
    if (!customers.length) { await connection.rollback(); return res.status(404).json({ error: 'NOT_FOUND', message: 'Customer not found.' }); }
    const saleFilter = positiveId(req.body.saleId) ? ' AND id = ?' : '';
    const [dues] = await connection.execute(`SELECT id, total_amount, amount_paid FROM sales WHERE owner_id = ? AND customer_id = ? AND status = 'completed' AND amount_paid < total_amount${saleFilter} ORDER BY sale_date ASC, id ASC`, positiveId(req.body.saleId) ? [ownerId, req.params.id, Number(req.body.saleId)] : [ownerId, req.params.id]);
    const dueCents = dues.reduce((sum, s) => sum + Math.round((Number(s.total_amount) - Number(s.amount_paid)) * 100), 0);
    if (!dues.length || remaining > dueCents) { await connection.rollback(); return res.status(409).json({ error: 'PAYMENT_EXCEEDS_BALANCE', message: dues.length ? `This payment is more than the amount due (₹${(dueCents / 100).toFixed(2)}).` : 'This customer has nothing outstanding.' }); }
    const allocations = [];
    for (const sale of dues) {
      if (remaining <= 0) break;
      const due = Math.round((Number(sale.total_amount) - Number(sale.amount_paid)) * 100);
      const apply = Math.min(due, remaining);
      await connection.execute('UPDATE sales SET amount_paid = ? WHERE id = ? AND owner_id = ?', [(Math.round(Number(sale.amount_paid) * 100) + apply) / 100, sale.id, ownerId]);
      await connection.execute('INSERT INTO customer_payments (owner_id, customer_id, sale_id, amount, method, note) VALUES (?, ?, ?, ?, ?, ?)', [ownerId, req.params.id, sale.id, apply / 100, method, note]);
      allocations.push({ saleId: Number(sale.id), amount: apply / 100 });
      remaining -= apply;
    }
    await connection.commit();
    res.status(201).json({ data: { customerId: Number(req.params.id), amount: Number(req.body.amount), allocations } });
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));
export default router;
