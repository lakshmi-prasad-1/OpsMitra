import { Router } from 'express';
import { pool, databaseTodaySql } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, cleanString, nonNegativeInt, validMoney, positiveId, MYSQL_INT_UNSIGNED_MAX } from '../utils/validation.js';
import { logMovement } from '../services/stock.js';
import { pageParams, pageMeta, likePattern, isDateOnly } from '../utils/pagination.js';
const router = Router();
const fields = 'id, sku, name, category, selling_price AS sellingPrice, cost_price AS costPrice, tax_rate AS taxRate, unit, barcode, expiry_date AS expiryDate, quantity, low_stock_threshold AS lowStockThreshold, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt';
const owner = (req) => Number(req.user.sub);
const shape = row => ({ ...row, id: Number(row.id), sellingPrice: Number(row.sellingPrice), costPrice: Number(row.costPrice), taxRate: Number(row.taxRate), quantity: Number(row.quantity), lowStockThreshold: Number(row.lowStockThreshold), isActive: Number(row.isActive) === 1 });
const SORTS = { name: 'name COLLATE NOCASE', stock: 'quantity', price: 'selling_price', created: 'created_at', category: 'COALESCE(category, \'\') COLLATE NOCASE' };

/** Validate the optional/extended product attributes; returns { error, field } or { values }. */
function extendedFields(body, { partial }) {
  const values = {};
  const has = key => body[key] !== undefined;
  if (has('costPrice') || !partial) { const v = body.costPrice ?? 0; if (!validMoney(v)) return { error: 'Cost price must be a non-negative amount with at most two decimals.', field: 'costPrice' }; values.cost_price = Number(v); }
  if (has('taxRate') || !partial) { const v = body.taxRate ?? 0; const n = Number(v); if (v === '' || !Number.isFinite(n) || n < 0 || n > 100) return { error: 'GST rate must be between 0 and 100.', field: 'taxRate' }; values.tax_rate = Math.round(n * 100) / 100; }
  if (has('unit') || !partial) { const v = cleanString(body.unit) || 'pcs'; if (v.length > 20) return { error: 'Unit must be at most 20 characters.', field: 'unit' }; values.unit = v; }
  if (has('barcode')) { const v = cleanString(body.barcode) || null; if (v && v.length > 64) return { error: 'Barcode must be at most 64 characters.', field: 'barcode' }; values.barcode = v; }
  if (has('expiryDate')) { const v = body.expiryDate; if (v && !isDateOnly(v)) return { error: 'Expiry date must be a valid date (YYYY-MM-DD).', field: 'expiryDate' }; values.expiry_date = v || null; }
  return { values };
}

router.get('/categories', asyncHandler(async (req, res) => {
  const [rows] = await pool.execute("SELECT category AS name, COUNT(*) AS count FROM products WHERE owner_id = ? AND is_active = 1 AND category IS NOT NULL AND category <> '' GROUP BY category ORDER BY category COLLATE NOCASE", [owner(req)]);
  res.json({ data: rows.map(r => ({ name: r.name, count: Number(r.count) })) });
}));

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query, 25, 500);
  const where = ['owner_id = ?']; const params = [owner(req)];
  if (req.query.status === 'inactive') where.push('is_active = 0');
  else if (req.query.includeInactive !== 'true') where.push('is_active = 1');
  const q = cleanString(req.query.q ?? req.query.search ?? '');
  if (q) { where.push("(name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\' OR COALESCE(category, '') LIKE ? ESCAPE '\\' OR COALESCE(barcode, '') LIKE ? ESCAPE '\\')"); params.push(likePattern(q), likePattern(q), likePattern(q), likePattern(q)); }
  const category = cleanString(req.query.category);
  if (category) { where.push('category = ?'); params.push(category); }
  const status = cleanString(req.query.status);
  if (status === 'out') where.push('quantity = 0');
  else if (status === 'low') where.push('quantity > 0 AND quantity <= low_stock_threshold');
  else if (status === 'attention') where.push('quantity <= low_stock_threshold');
  else if (status === 'ok') where.push('quantity > low_stock_threshold');
  else if (status === 'expiring') {
    const [[d]] = await pool.execute(databaseTodaySql);
    where.push("expiry_date IS NOT NULL AND expiry_date <= date(?, '+30 day')"); params.push(String(d.today).slice(0, 10));
  }
  const clause = where.join(' AND ');
  const sort = SORTS[req.query.sort] || SORTS.created;
  const dir = req.query.dir === 'asc' ? 'ASC' : (req.query.sort ? (req.query.dir === 'desc' ? 'DESC' : 'ASC') : 'DESC');
  const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM products WHERE ${clause}`, params);
  const [rows] = await pool.execute(`SELECT ${fields} FROM products WHERE ${clause} ORDER BY ${sort} ${dir}, id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  res.json({ data: rows.map(shape), meta: pageMeta(page, pageSize, count.total) });
}));

// Bulk import (CSV on the client). Valid rows are inserted; invalid/duplicate rows are reported back.
router.post('/bulk', asyncHandler(async (req, res) => {
  const rows = req.body.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) return badRequest(res, 'Provide between 1 and 500 product rows.', 'rows');
  const ownerId = owner(req);
  const results = []; let created = 0;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const name = cleanString(row.name), sku = cleanString(row.sku).toUpperCase(), category = cleanString(row.category) || null;
      const quantity = row.quantity ?? 0, threshold = row.lowStockThreshold ?? 5, price = row.sellingPrice ?? 0;
      const fail = message => results.push({ row: i + 1, sku: sku || null, status: 'error', message });
      if (name.length < 2 || name.length > 180) { fail('Name must be 2–180 characters.'); continue; }
      if (!sku || sku.length > 64) { fail('SKU is required (max 64 characters).'); continue; }
      if (!nonNegativeInt(quantity) || !nonNegativeInt(threshold)) { fail('Stock and threshold must be whole numbers.'); continue; }
      if (!validMoney(price)) { fail('Selling price is not a valid amount.'); continue; }
      const extra = extendedFields(row, { partial: false });
      if (extra.error) { fail(extra.error); continue; }
      const [dup] = await connection.execute('SELECT id FROM products WHERE owner_id = ? AND sku = ?', [ownerId, sku]);
      if (dup.length) { fail('A product with this SKU already exists.'); continue; }
      const [inserted] = await connection.execute('INSERT INTO products (owner_id, sku, name, category, selling_price, cost_price, tax_rate, unit, barcode, expiry_date, quantity, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ownerId, sku, name, category, Number(price), extra.values.cost_price, extra.values.tax_rate, extra.values.unit, null, null, Number(quantity), Number(threshold)]);
      if (Number(quantity) > 0) await logMovement(connection, { ownerId, productId: Number(inserted.insertId), type: 'opening', change: Number(quantity), after: Number(quantity), note: 'Imported opening stock' });
      results.push({ row: i + 1, sku, status: 'created' }); created++;
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  res.status(created ? 201 : 200).json({ data: { created, failed: results.length - created, results } });
}));

// Atomic relative adjustment prevents the +/- controls from overwriting a concurrent sale.
router.patch('/:id/stock', asyncHandler(async (req, res) => {
  const delta = req.body.delta;
  if (typeof delta !== 'number' || !Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > MYSQL_INT_UNSIGNED_MAX) {
    return badRequest(res, 'Stock adjustment must be a non-zero whole-number delta.', 'delta');
  }
  const note = cleanString(req.body.note ?? req.body.reason).slice(0, 200) || null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT id, quantity FROM products WHERE id = ? AND owner_id = ? AND is_active = 1 FOR UPDATE', [req.params.id, owner(req)]);
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
    }
    const current = Number(rows[0].quantity);
    const next = current + delta;
    if (next < 0) {
      await connection.rollback();
      return res.status(409).json({ error: 'INSUFFICIENT_STOCK', message: `Stock cannot become negative. Current quantity: ${current}.` });
    }
    if (next > MYSQL_INT_UNSIGNED_MAX) {
      await connection.rollback();
      return badRequest(res, `Stock cannot exceed ${MYSQL_INT_UNSIGNED_MAX} units.`, 'delta');
    }
    await connection.execute('UPDATE products SET quantity = ? WHERE id = ? AND owner_id = ? AND is_active = 1', [next, req.params.id, owner(req)]);
    await logMovement(connection, { ownerId: owner(req), productId: Number(req.params.id), type: 'adjustment', change: delta, after: next, refType: 'manual', note });
    const [updated] = await connection.execute(`SELECT ${fields} FROM products WHERE id = ? AND owner_id = ? AND is_active = 1`, [req.params.id, owner(req)]);
    if (!updated.length) { await connection.rollback(); return res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' }); }
    await connection.commit();
    res.json({ data: shape(updated[0]) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.get('/:id/movements', asyncHandler(async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
  const { page, pageSize, offset } = pageParams(req.query, 20, 100);
  const [[count]] = await pool.execute('SELECT COUNT(*) AS total FROM stock_movements WHERE owner_id = ? AND product_id = ?', [owner(req), req.params.id]);
  const [rows] = await pool.execute('SELECT id, movement_type AS type, quantity_change AS change, quantity_after AS quantityAfter, ref_type AS refType, ref_id AS refId, note, created_at AS createdAt FROM stock_movements WHERE owner_id = ? AND product_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?', [owner(req), req.params.id, pageSize, offset]);
  res.json({ data: rows.map(r => ({ ...r, id: Number(r.id), change: Number(r.change), quantityAfter: Number(r.quantityAfter) })), meta: pageMeta(page, pageSize, count.total) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
  const [rows] = await pool.execute(`SELECT ${fields} FROM products WHERE id = ? AND owner_id = ?`, [req.params.id, owner(req)]);
  if (!rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
  const product = shape(rows[0]);
  const [[today]] = await pool.execute(databaseTodaySql);
  const start = new Date(`${String(today.today).slice(0, 10)}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - 29);
  const [[stats]] = await pool.execute("SELECT COALESCE(SUM(si.quantity),0) AS sold, COALESCE(SUM(si.line_total),0) AS revenue, COALESCE(SUM(si.quantity * si.unit_cost),0) AS cost, MAX(s.sale_date) AS lastSold FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.owner_id = ? AND s.status = 'completed' AND si.product_id = ? AND s.sale_date >= ?", [owner(req), product.id, start.toISOString().slice(0, 10)]);
  const sold30 = Number(stats.sold); const avgDaily = sold30 / 30;
  res.json({ data: { ...product, stats: { sold30, revenue30: Number(stats.revenue), profit30: Number(stats.revenue) - Number(stats.cost), avgDailySales: Math.round(avgDaily * 100) / 100, daysOfStockLeft: avgDaily > 0 ? Math.floor(product.quantity / avgDaily) : null, lastSold: stats.lastSold } } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const name = cleanString(req.body.name), sku = cleanString(req.body.sku).toUpperCase(), category = cleanString(req.body.category) || null;
  const quantity = req.body.quantity ?? req.body.stock ?? 0;
  const threshold = req.body.lowStockThreshold ?? req.body.threshold ?? 5;
  const price = req.body.sellingPrice ?? 0;
  if (name.length < 2 || name.length > 180) return badRequest(res, 'Product name must be 2–180 characters.', 'name');
  if (!sku || sku.length > 64) return badRequest(res, 'SKU is required and must be at most 64 characters.', 'sku');
  if (category && category.length > 100) return badRequest(res, 'Category must be at most 100 characters.', 'category');
  if (!nonNegativeInt(quantity) || !nonNegativeInt(threshold)) return badRequest(res, 'Stock and low-stock threshold must be non-negative whole numbers.');
  if (!validMoney(price)) return badRequest(res, 'Selling price must be a non-negative amount with at most two decimals.', 'sellingPrice');
  const extra = extendedFields(req.body, { partial: false });
  if (extra.error) return badRequest(res, extra.error, extra.field);
  const ownerId = owner(req);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [dup] = await connection.execute('SELECT id, is_active FROM products WHERE owner_id = ? AND sku = ?', [ownerId, sku]);
    if (dup.length) {
      await connection.rollback();
      const inactive = Number(dup[0].is_active) === 0;
      return res.status(409).json({ error: inactive ? 'SKU_INACTIVE' : 'SKU_EXISTS', existingId: Number(dup[0].id), message: inactive ? 'A deactivated product already uses this SKU. Restore that product instead of creating a new one.' : 'A product with this SKU already exists in your workspace.' });
    }
    const v = extra.values;
    const [result] = await connection.execute('INSERT INTO products (owner_id, sku, name, category, selling_price, cost_price, tax_rate, unit, barcode, expiry_date, quantity, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [ownerId, sku, name, category, Number(price), v.cost_price, v.tax_rate, v.unit, v.barcode ?? null, v.expiry_date ?? null, Number(quantity), Number(threshold)]);
    if (Number(quantity) > 0) await logMovement(connection, { ownerId, productId: Number(result.insertId), type: 'opening', change: Number(quantity), after: Number(quantity), note: 'Opening stock' });
    const [created] = await connection.execute(`SELECT ${fields} FROM products WHERE id = ? AND owner_id = ?`, [result.insertId, ownerId]);
    await connection.commit();
    res.status(201).json({ data: shape(created[0]) });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'SKU_EXISTS', message: 'A product with this SKU already exists in your workspace.' });
    throw error;
  } finally { connection.release(); }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const allowed = {};
  if (req.body.name !== undefined) { allowed.name = cleanString(req.body.name); if (allowed.name.length < 2 || allowed.name.length > 180) return badRequest(res, 'Product name must be 2–180 characters.', 'name'); }
  if (req.body.sku !== undefined) { allowed.sku = cleanString(req.body.sku).toUpperCase(); if (!allowed.sku || allowed.sku.length > 64) return badRequest(res, 'SKU is required and must be at most 64 characters.', 'sku'); }
  if (req.body.category !== undefined) { allowed.category = cleanString(req.body.category) || null; if (allowed.category && allowed.category.length > 100) return badRequest(res, 'Category must be at most 100 characters.', 'category'); }
  if (req.body.sellingPrice !== undefined) { if (!validMoney(req.body.sellingPrice)) return badRequest(res, 'Enter a valid selling price.', 'sellingPrice'); allowed.selling_price = Number(req.body.sellingPrice); }
  if (req.body.quantity !== undefined || req.body.stock !== undefined) return badRequest(res, 'Use the atomic stock-adjustment endpoint to change inventory quantity.', 'quantity');
  if (req.body.lowStockThreshold !== undefined || req.body.threshold !== undefined) { const v = req.body.lowStockThreshold ?? req.body.threshold; if (!nonNegativeInt(v)) return badRequest(res, 'Threshold must be a non-negative whole number.', 'lowStockThreshold'); allowed.low_stock_threshold = Number(v); }
  if (req.body.isActive !== undefined) { if (![true, false, 0, 1].includes(req.body.isActive)) return badRequest(res, 'isActive must be true or false.', 'isActive'); allowed.is_active = req.body.isActive ? 1 : 0; }
  const extra = extendedFields(req.body, { partial: true });
  if (extra.error) return badRequest(res, extra.error, extra.field);
  Object.assign(allowed, extra.values);
  const keys = Object.keys(allowed);
  if (!keys.length) return badRequest(res, 'Provide at least one supported field to update.');
  try {
    const sqlFields = keys.map(k => `${k} = ?`).join(', ');
    await pool.execute(`UPDATE products SET ${sqlFields} WHERE id = ? AND owner_id = ?`, [...keys.map(k => allowed[k]), req.params.id, owner(req)]);
    // An unchanged edit can legitimately affect zero rows; existence, not affectedRows, determines 404.
    const [rows] = await pool.execute(`SELECT ${fields} FROM products WHERE id = ? AND owner_id = ?`, [req.params.id, owner(req)]);
    if (!rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
    res.json({ data: shape(rows[0]) });
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'SKU_EXISTS', message: 'A product with this SKU already exists in your workspace.' }); throw error; }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const [result] = await pool.execute('UPDATE products SET is_active = 0 WHERE id = ? AND owner_id = ? AND is_active = 1', [req.params.id, owner(req)]);
  if (!result.affectedRows) return res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
  res.status(204).end();
}));
export default router;
