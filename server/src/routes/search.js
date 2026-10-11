import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { cleanString } from '../utils/validation.js';
import { likePattern } from '../utils/pagination.js';
const router = Router();

// Global search used by the Ctrl+K palette: a few matches from each record type.
router.get('/', asyncHandler(async (req, res) => {
  const q = cleanString(req.query.q);
  if (q.length < 2) return res.json({ data: { products: [], customers: [], sales: [], orders: [], suppliers: [] } });
  const ownerId = Number(req.user.sub); const like = likePattern(q);
  const [products] = await pool.execute("SELECT id, name, sku, quantity FROM products WHERE owner_id = ? AND is_active = 1 AND (name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\' OR COALESCE(barcode, '') LIKE ? ESCAPE '\\') ORDER BY name COLLATE NOCASE LIMIT 5", [ownerId, like, like, like]);
  const [customers] = await pool.execute("SELECT id, name, phone FROM customers WHERE owner_id = ? AND is_active = 1 AND (name LIKE ? ESCAPE '\\' OR COALESCE(phone, '') LIKE ? ESCAPE '\\') ORDER BY name COLLATE NOCASE LIMIT 5", [ownerId, like, like]);
  const [sales] = await pool.execute("SELECT s.id, s.sale_number AS number, s.total_amount AS total, c.name AS customer FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.owner_id = ? AND (s.sale_number LIKE ? ESCAPE '\\' OR COALESCE(c.name, '') LIKE ? ESCAPE '\\') ORDER BY s.sale_date DESC LIMIT 5", [ownerId, like, like]);
  const [orders] = await pool.execute("SELECT o.id, o.order_number AS number, o.status, c.name AS customer FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.owner_id = ? AND (o.order_number LIKE ? ESCAPE '\\' OR COALESCE(c.name, '') LIKE ? ESCAPE '\\') ORDER BY o.order_date DESC LIMIT 5", [ownerId, like, like]);
  const [suppliers] = await pool.execute("SELECT id, name FROM suppliers WHERE owner_id = ? AND is_active = 1 AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 3", [ownerId, like]);
  const num = rows => rows.map(r => ({ ...r, id: Number(r.id) }));
  res.json({ data: { products: num(products), customers: num(customers), sales: num(sales).map(s => ({ ...s, total: Number(s.total) })), orders: num(orders), suppliers: num(suppliers) } });
}));
export default router;
