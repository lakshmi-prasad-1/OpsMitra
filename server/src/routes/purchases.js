import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, cleanString, positiveId, positiveInt, validMoney, calculateAmountCents, amountCentsToNumber, MAX_AMOUNT_CENTS, MYSQL_INT_UNSIGNED_MAX } from '../utils/validation.js';
import { validRequestKey } from '../utils/idempotency.js';
import { logMovement } from '../services/stock.js';
import { nextNumber } from '../services/numbering.js';
import { pageParams, pageMeta, likePattern, isDateOnly, nextDay } from '../utils/pagination.js';
const router = Router();
const owner = req => Number(req.user.sub);
const select = `p.id, p.purchase_number AS purchaseNumber, p.purchase_date AS purchaseDate, p.total_amount AS totalAmount, p.notes, p.supplier_id AS supplierId, s.name AS supplierName,
  (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS lineCount`;
const from = 'FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.owner_id = p.owner_id';
const shape = r => ({ ...r, id: Number(r.id), totalAmount: Number(r.totalAmount), lineCount: Number(r.lineCount), supplierId: r.supplierId == null ? null : Number(r.supplierId) });

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query);
  const where = ['p.owner_id = ?']; const params = [owner(req)];
  const q = cleanString(req.query.q);
  if (q) { where.push("(p.purchase_number LIKE ? ESCAPE '\\' OR COALESCE(s.name, '') LIKE ? ESCAPE '\\')"); params.push(likePattern(q), likePattern(q)); }
  if (positiveId(req.query.supplierId)) { where.push('p.supplier_id = ?'); params.push(Number(req.query.supplierId)); }
  if (isDateOnly(req.query.from)) { where.push('p.purchase_date >= ?'); params.push(req.query.from); }
  if (isDateOnly(req.query.to)) { where.push('p.purchase_date < ?'); params.push(nextDay(req.query.to)); }
  const clause = where.join(' AND ');
  const [[count]] = await pool.execute(`SELECT COUNT(*) AS total ${from} WHERE ${clause}`, params);
  const [rows] = await pool.execute(`SELECT ${select} ${from} WHERE ${clause} ORDER BY p.purchase_date DESC, p.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  res.json({ data: rows.map(shape), meta: pageMeta(page, pageSize, count.total) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Purchase not found.' });
  const [rows] = await pool.execute(`SELECT ${select} ${from} WHERE p.owner_id = ? AND p.id = ?`, [owner(req), req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: 'Purchase not found.' });
  const [items] = await pool.execute('SELECT pi.id, pi.product_id AS productId, pr.name, pr.sku, pi.quantity, pi.unit_cost AS unitCost, pi.line_total AS lineTotal FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id WHERE pi.purchase_id = ? ORDER BY pi.id', [rows[0].id]);
  res.json({ data: { ...shape(rows[0]), items: items.map(i => ({ ...i, quantity: Number(i.quantity), unitCost: Number(i.unitCost), lineTotal: Number(i.lineTotal) })) } });
}));

// Receiving stock: raises quantity, records the cost paid, and writes a stock-ledger entry.
router.post('/', asyncHandler(async (req, res) => {
  const items = req.body.items;
  if (!Array.isArray(items) || !items.length || items.length > 100) return badRequest(res, 'A purchase must contain between 1 and 100 product lines.', 'items');
  if (!validRequestKey(req.body.requestKey)) return badRequest(res, 'A UUID requestKey is required so retries cannot duplicate stock.', 'requestKey');
  const requestKey = req.body.requestKey.toLowerCase();
  const ownerId = owner(req);
  const notes = cleanString(req.body.notes).slice(0, 500) || null;
  let supplierId = null;
  if (req.body.supplierId !== undefined && req.body.supplierId !== null && req.body.supplierId !== '') {
    if (!positiveId(req.body.supplierId)) return badRequest(res, 'Supplier ID must be a valid positive integer.', 'supplierId');
    supplierId = Number(req.body.supplierId);
  }
  const merged = new Map();
  for (const item of items) {
    if (!item || typeof item !== 'object' || !positiveId(item.productId) || !positiveInt(item.quantity) || !validMoney(item.unitCost ?? 0)) return badRequest(res, 'Each line needs a productId, a positive whole quantity and a valid unit cost.', 'items');
    const key = Number(item.productId);
    const prev = merged.get(key);
    if (prev && Number(prev.unitCost) !== Number(item.unitCost ?? 0)) return badRequest(res, 'The same product appears twice with different costs.', 'items');
    merged.set(key, { productId: key, quantity: (prev?.quantity || 0) + Number(item.quantity), unitCost: Number(item.unitCost ?? 0) });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [prior] = await connection.execute('SELECT id, purchase_number AS purchaseNumber, total_amount AS totalAmount FROM purchases WHERE owner_id = ? AND request_key = ?', [ownerId, requestKey]);
    if (prior.length) { await connection.commit(); return res.status(200).json({ data: { id: Number(prior[0].id), purchaseNumber: prior[0].purchaseNumber, totalAmount: Number(prior[0].totalAmount) }, replayed: true }); }
    if (supplierId) { const [s] = await connection.execute('SELECT id FROM suppliers WHERE id = ? AND owner_id = ? AND is_active = 1', [supplierId, ownerId]); if (!s.length) { await connection.rollback(); return badRequest(res, 'Supplier not found in your workspace.', 'supplierId'); } }
    const lines = []; let totalCents = 0n;
    for (const line of [...merged.values()].sort((a, b) => a.productId - b.productId)) {
      const [rows] = await connection.execute('SELECT id, name, quantity FROM products WHERE id = ? AND owner_id = ? AND is_active = 1', [line.productId, ownerId]);
      if (!rows.length) { await connection.rollback(); return res.status(404).json({ error: 'NOT_FOUND', message: 'One of the selected products was not found.' }); }
      const after = Number(rows[0].quantity) + line.quantity;
      if (after > MYSQL_INT_UNSIGNED_MAX) { await connection.rollback(); return res.status(409).json({ error: 'STOCK_LIMIT_EXCEEDED', message: `Receiving this quantity would exceed the stock limit for ${rows[0].name}.` }); }
      const lineCents = calculateAmountCents(line.unitCost, line.quantity);
      if (lineCents === null || totalCents + lineCents > MAX_AMOUNT_CENTS) { await connection.rollback(); return badRequest(res, 'Purchase total exceeds the supported maximum.', 'items'); }
      totalCents += lineCents;
      lines.push({ ...line, after, lineTotal: amountCentsToNumber(lineCents) });
    }
    const date = isDateOnly(req.body.purchaseDate) ? `${req.body.purchaseDate} 12:00:00` : null;
    const number = await nextNumber(connection, 'purchases', ownerId, 'PUR');
    const [purchase] = await connection.execute(`INSERT INTO purchases (owner_id, purchase_number, supplier_id, total_amount, notes, request_key${date ? ', purchase_date' : ''}) VALUES (?, ?, ?, ?, ?, ?${date ? ', ?' : ''})`, [ownerId, number, supplierId, amountCentsToNumber(totalCents), notes, requestKey, ...(date ? [date] : [])]);
    for (const line of lines) {
      await connection.execute('INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, line_total) VALUES (?, ?, ?, ?, ?)', [purchase.insertId, line.productId, line.quantity, line.unitCost, line.lineTotal]);
      await connection.execute('UPDATE products SET quantity = quantity + ?, cost_price = ? WHERE id = ? AND owner_id = ?', [line.quantity, line.unitCost, line.productId, ownerId]);
      await logMovement(connection, { ownerId, productId: line.productId, type: 'purchase', change: line.quantity, after: line.after, refType: 'purchase', refId: Number(purchase.insertId), note: number, at: date });
    }
    await connection.commit();
    res.status(201).json({ data: { id: Number(purchase.insertId), purchaseNumber: number, totalAmount: amountCentsToNumber(totalCents), items: lines.length } });
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));
export default router;
