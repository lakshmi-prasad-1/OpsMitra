import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, dbDriver } from './db.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import productRoutes from './routes/products.js';
import customerRoutes from './routes/customers.js';
import salesRoutes from './routes/sales.js';
import orderRoutes from './routes/orders.js';
import reportRoutes from './routes/reports.js';
import insightRoutes from './routes/insights.js';
import demoRoutes from './routes/demo.js';
import supplierRoutes from './routes/suppliers.js';
import purchaseRoutes from './routes/purchases.js';
import notificationRoutes from './routes/notifications.js';
import searchRoutes from './routes/search.js';
import assistantRoutes from './routes/assistant.js';
import { requireAuth } from './middleware/auth.js';
import { requireActiveUser } from './middleware/session.js';

if (dbDriver !== 'sqlite') {
  throw new Error('OpsMitra now requires DB_DRIVER=sqlite. MySQL support was frozen at Phase 4; use the migrate:mysql-to-sqlite script to move existing data.');
}

export const app = express();
app.disable('x-powered-by');
const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (Number.isInteger(trustedProxyHops) && trustedProxyHops >= 0) app.set('trust proxy', trustedProxyHops);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // The built web app is served by this process too, so give its pages a strict policy (APIs return JSON only).
  if (!req.path.startsWith('/api')) {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  }
  next();
});
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim());
app.use(cors({ origin: (origin, callback) => !origin || allowedOrigins.includes(origin) ? callback(null, true) : callback(new Error('Origin not allowed by CORS')), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => { if (!req.body || typeof req.body !== 'object') req.body = {}; next(); });
app.get('/api/health', async (_req, res) => {
  try {
    // Validate required tables/columns as well as connectivity, so a forgotten migration
    // cannot look healthy and fail only after the user opens a feature screen.
    const schemaChecks = [
      'SELECT id, name, email, password_hash FROM users LIMIT 0',
      'SELECT id, owner_id, sku, selling_price, cost_price, tax_rate, unit, expiry_date, quantity, low_stock_threshold, is_active FROM products LIMIT 0',
      'SELECT id, token_version, is_demo, business_name FROM users LIMIT 0',
      'SELECT id, owner_id, product_id, movement_type, quantity_change, quantity_after FROM stock_movements LIMIT 0',
      'SELECT id, owner_id, supplier_id, total_amount FROM purchases LIMIT 0',
      'SELECT id, owner_id, customer_id, sale_id, amount FROM customer_payments LIMIT 0',
      'SELECT id, owner_id, name, phone, email, request_key, request_hash FROM customers LIMIT 0',
      'SELECT id, owner_id, sale_date, subtotal, discount_amount, tax_amount, total_amount, payment_method, amount_paid, status, source_order_id, request_key, request_hash FROM sales LIMIT 0',
      'SELECT id, owner_id, status, stock_deducted, request_key, request_hash, updated_at FROM orders LIMIT 0',
      'SELECT id, order_id, product_id, quantity, unit_price, line_total FROM order_items LIMIT 0',
      'SELECT id, sale_id, product_id, quantity, unit_price, line_total FROM sale_items LIMIT 0',
      'SELECT client_key, window_started_at, attempt_count FROM auth_attempt_limits LIMIT 0'
    ];
    for (const query of schemaChecks) await pool.query(query);
    // Unique indexes are part of correctness, not only performance: they protect idempotency
    // keys and guarantee at most one sale record can represent a given completed order.
    const requiredUniqueIndexes = [
      { table: 'customers', name: 'uq_customers_owner_request_key', columns: ['owner_id', 'request_key'] },
      { table: 'orders', name: 'uq_orders_owner_request_key', columns: ['owner_id', 'request_key'] },
      { table: 'sales', name: 'uq_sales_owner_request_key', columns: ['owner_id', 'request_key'] },
      { table: 'sales', name: 'uq_sales_owner_source_order', columns: ['owner_id', 'source_order_id'] },
      { table: 'products', name: 'uq_products_owner_sku', columns: ['owner_id', 'sku'] },
    ];
    for (const required of requiredUniqueIndexes) {
      const [indexRows] = await pool.query(`SHOW INDEX FROM ${required.table}`);
      const rows = indexRows.filter(row => row.Key_name === required.name).sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index));
      if (rows.length !== required.columns.length || rows.some((row, i) => Number(row.Non_unique) !== 0 || row.Column_name !== required.columns[i])) {
        throw new Error(`Required unique index ${required.name} is missing or has the wrong definition.`);
      }
    }
    const [[orderLinkHealth]] = await pool.query(`
      SELECT COUNT(*) AS broken FROM orders o
      LEFT JOIN sales s ON s.owner_id = o.owner_id AND s.source_order_id = o.id
      WHERE (o.status = 'completed' AND (o.stock_deducted <> 1 OR s.id IS NULL OR s.status <> 'completed'))
         OR (o.status <> 'completed' AND o.stock_deducted <> 0)
         OR (s.id IS NOT NULL AND ((o.status IN ('pending','processing','ready'))
             OR (o.status = 'cancelled' AND s.status <> 'voided')
             OR (o.status = 'completed' AND s.status <> 'completed')))
    `);
    const [[orderTotalHealth]] = await pool.query(`
      SELECT COUNT(*) AS broken FROM orders o
      LEFT JOIN (SELECT order_id, COUNT(*) AS item_count, COALESCE(SUM(line_total), 0) AS line_sum FROM order_items GROUP BY order_id) oi
        ON oi.order_id = o.id
      WHERE oi.order_id IS NULL OR oi.item_count = 0 OR oi.line_sum <> o.total_amount
         OR EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = o.id AND ROUND(x.unit_price * x.quantity, 2) <> x.line_total)
    `);
    const [[saleTotalHealth]] = await pool.query(`
      SELECT COUNT(*) AS broken FROM sales s
      LEFT JOIN (SELECT sale_id, COUNT(*) AS item_count, COALESCE(SUM(line_total), 0) AS line_sum FROM sale_items GROUP BY sale_id) si
        ON si.sale_id = s.id
      WHERE si.sale_id IS NULL OR si.item_count = 0 OR ROUND(si.line_sum - s.discount_amount, 2) <> ROUND(s.total_amount, 2) OR s.amount_paid > s.total_amount
         OR EXISTS (SELECT 1 FROM sale_items x WHERE x.sale_id = s.id AND ROUND(x.unit_price * x.quantity, 2) <> x.line_total)
    `);
    if (Number(orderLinkHealth.broken) || Number(orderTotalHealth.broken) || Number(saleTotalHealth.broken)) {
      return res.status(503).json({ status: 'degraded', database: 'connected', schema: 'ready', integrity: 'failed', message: 'The database is reachable, but an order-to-sale link or stored transaction total is inconsistent. Back up the database and reconcile the affected records before processing new transactions.' });
    }
    res.json({ status: 'ok', database: 'connected', schema: 'ready', integrity: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'not_ready', schema: 'not_ready', message: 'The configured database is unavailable or its schema is incomplete. Check server/.env and confirm the selected database is initialized or migrated.' });
  }
});
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth, requireActiveUser);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/insights', insightRoutes);
app.use('/api/demo', demoRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'API route not found.' }));

// Single-process mode: serve the built React app (with client-side-routing fallback) when it exists.
const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (process.env.SERVE_CLIENT !== 'false' && existsSync(resolve(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(resolve(clientDist, 'index.html')));
}
app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Route not found.' }));
app.use((err, _req, res, _next) => {
  if (err.message === 'Origin not allowed by CORS') return res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED', message: 'This origin is not allowed to access the API.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'INVALID_JSON', message: 'Request body must contain valid JSON.' });
  console.error(err);
  const status = Number(err.status) >= 400 && Number(err.status) < 600 ? Number(err.status) : 500;
  res.status(status).json({ error: err.code || 'INTERNAL_ERROR', message: status === 500 ? 'The request could not be completed. Check server logs for details.' : err.message });
});
