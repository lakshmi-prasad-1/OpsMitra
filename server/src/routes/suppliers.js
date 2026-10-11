import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, cleanString, positiveId } from '../utils/validation.js';
import { pageParams, pageMeta, likePattern } from '../utils/pagination.js';
const router = Router();
const owner = req => Number(req.user.sub);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const select = `s.id, s.name, s.phone, s.email, s.address, s.notes, s.is_active AS isActive, s.created_at AS createdAt,
  COALESCE(st.total, 0) AS totalPurchased, COALESCE(st.count, 0) AS purchaseCount, st.lastPurchase`;
const from = `FROM suppliers s LEFT JOIN (SELECT supplier_id, SUM(total_amount) AS total, COUNT(*) AS count, MAX(purchase_date) AS lastPurchase FROM purchases WHERE owner_id = ? GROUP BY supplier_id) st ON st.supplier_id = s.id`;
const shape = r => ({ ...r, id: Number(r.id), isActive: Number(r.isActive) === 1, totalPurchased: Number(r.totalPurchased), purchaseCount: Number(r.purchaseCount) });

function validate(body, current = {}) {
  const name = body.name === undefined ? current.name : cleanString(body.name);
  const phone = body.phone === undefined ? current.phone ?? null : (cleanString(body.phone) || null);
  const email = body.email === undefined ? current.email ?? null : (cleanString(body.email).toLowerCase() || null);
  const address = body.address === undefined ? current.address ?? null : (cleanString(body.address).slice(0, 300) || null);
  const notes = body.notes === undefined ? current.notes ?? null : (cleanString(body.notes).slice(0, 500) || null);
  if (!name || name.length < 2 || name.length > 160) return { error: 'Supplier name must be 2–160 characters.', field: 'name' };
  if (phone && phone.length > 32) return { error: 'Phone must be at most 32 characters.', field: 'phone' };
  if (email && (!EMAIL.test(email) || email.length > 190)) return { error: 'Enter a valid email address.', field: 'email' };
  return { values: { name, phone, email, address, notes } };
}

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query, 25, 500);
  const where = ['s.owner_id = ?']; const params = [owner(req)];
  where.push(req.query.status === 'archived' ? 's.is_active = 0' : 's.is_active = 1');
  const q = cleanString(req.query.q);
  if (q) { where.push("(s.name LIKE ? ESCAPE '\\' OR COALESCE(s.phone, '') LIKE ? ESCAPE '\\')"); params.push(likePattern(q), likePattern(q)); }
  const clause = where.join(' AND ');
  const [[count]] = await pool.execute(`SELECT COUNT(*) AS total ${from} WHERE ${clause}`, [owner(req), ...params]);
  const [rows] = await pool.execute(`SELECT ${select} ${from} WHERE ${clause} ORDER BY s.name COLLATE NOCASE LIMIT ? OFFSET ?`, [owner(req), ...params, pageSize, offset]);
  res.json({ data: rows.map(shape), meta: pageMeta(page, pageSize, count.total) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Supplier not found.' });
  const [rows] = await pool.execute(`SELECT ${select} ${from} WHERE s.owner_id = ? AND s.id = ?`, [owner(req), owner(req), req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: 'Supplier not found.' });
  const [purchases] = await pool.execute('SELECT id, purchase_number AS purchaseNumber, purchase_date AS purchaseDate, total_amount AS totalAmount FROM purchases WHERE owner_id = ? AND supplier_id = ? ORDER BY purchase_date DESC, id DESC LIMIT 30', [owner(req), req.params.id]);
  res.json({ data: { ...shape(rows[0]), purchases: purchases.map(p => ({ ...p, id: Number(p.id), totalAmount: Number(p.totalAmount) })) } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const result = validate(req.body);
  if (result.error) return badRequest(res, result.error, result.field);
  const v = result.values;
  const [inserted] = await pool.execute('INSERT INTO suppliers (owner_id, name, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?)', [owner(req), v.name, v.phone, v.email, v.address, v.notes]);
  res.status(201).json({ data: { id: Number(inserted.insertId), ...v } });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const [found] = await pool.execute('SELECT id, name, phone, email, address, notes, is_active AS isActive FROM suppliers WHERE id = ? AND owner_id = ?', [req.params.id, owner(req)]);
  if (!found.length) return res.status(404).json({ error: 'NOT_FOUND', message: 'Supplier not found.' });
  const result = validate(req.body, found[0]);
  if (result.error) return badRequest(res, result.error, result.field);
  const v = result.values; const isActive = req.body.isActive === undefined ? Number(found[0].isActive) : (req.body.isActive ? 1 : 0);
  await pool.execute('UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, notes = ?, is_active = ? WHERE id = ? AND owner_id = ?', [v.name, v.phone, v.email, v.address, v.notes, isActive, req.params.id, owner(req)]);
  res.json({ data: { id: Number(req.params.id), ...v, isActive: isActive === 1 } });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const [result] = await pool.execute('UPDATE suppliers SET is_active = 0 WHERE id = ? AND owner_id = ? AND is_active = 1', [req.params.id, owner(req)]);
  if (!result.affectedRows) return res.status(404).json({ error: 'NOT_FOUND', message: 'Supplier not found.' });
  res.status(204).end();
}));
export default router;
