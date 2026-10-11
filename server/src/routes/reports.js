import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isDateOnly, nextDay } from '../utils/pagination.js';
import { databaseToday, shiftDate, diffDays, dateRange, periodTotals, dailyTrend, topProducts, categoryBreakdown, paymentBreakdown, topCustomers, receivables } from '../services/analytics.js';
const router = Router();
const presets = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };

/** Resolve ?range=7d|30d|90d|365d|mtd|ytd or an explicit ?from=&to= (max 366 days). */
async function resolveRange(query) {
  const today = await databaseToday();
  let from, to;
  if (isDateOnly(query.from) && isDateOnly(query.to)) {
    from = query.from; to = query.to;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    if (diffDays(from, to) > 365) from = shiftDate(to, -365);
    if (from > to) from = to;
  } else if (query.range === 'mtd') { to = today; from = `${today.slice(0, 7)}-01`; }
  else if (query.range === 'ytd') { to = today; from = `${today.slice(0, 4)}-01-01`; }
  else if (query.range === 'today') { to = today; from = today; }
  else { to = today; from = shiftDate(today, -((presets[query.range] || 30) - 1)); }
  return { today, from, to, toExclusive: nextDay(to), days: diffDays(from, to) + 1 };
}

router.get('/', asyncHandler(async (req, res) => {
  const ownerId = Number(req.user.sub);
  const range = await resolveRange(req.query);
  const previousTo = shiftDate(range.from, -1);
  const previousFrom = shiftDate(range.from, -range.days);
  const [totals, previous, trend, products, categories, methods, customers, due] = await Promise.all([
    periodTotals(ownerId, range.from, range.toExclusive),
    periodTotals(ownerId, previousFrom, range.from),
    dailyTrend(ownerId, range.from, range.toExclusive, dateRange(range.from, range.to)),
    topProducts(ownerId, range.from, range.toExclusive, 10),
    categoryBreakdown(ownerId, range.from, range.toExclusive),
    paymentBreakdown(ownerId, range.from, range.toExclusive),
    topCustomers(ownerId, range.from, range.toExclusive, 8),
    receivables(ownerId)
  ]);
  const [orderStatuses] = await pool.execute('SELECT status, COUNT(*) AS count FROM orders WHERE owner_id = ? AND order_date >= ? AND order_date < ? GROUP BY status', [ownerId, range.from, range.toExclusive]);
  res.json({ data: {
    range: { from: range.from, to: range.to, days: range.days, previousFrom, previousTo },
    totals, previous, trend, topProducts: products, categories, paymentMethods: methods, topCustomers: customers, receivables: due,
    orderStatuses: orderStatuses.map(o => ({ status: o.status, count: Number(o.count) }))
  } });
}));

// Stock valuation at cost and at selling price, grouped by category.
router.get('/inventory', asyncHandler(async (req, res) => {
  const ownerId = Number(req.user.sub);
  const [categories] = await pool.execute("SELECT COALESCE(category, 'Uncategorised') AS category, COUNT(*) AS products, COALESCE(SUM(quantity),0) AS units, COALESCE(SUM(quantity * cost_price),0) AS costValue, COALESCE(SUM(quantity * selling_price),0) AS retailValue FROM products WHERE owner_id = ? AND is_active = 1 GROUP BY COALESCE(category, 'Uncategorised') ORDER BY costValue DESC", [ownerId]);
  const [items] = await pool.execute('SELECT id, name, sku, quantity, cost_price AS costPrice, selling_price AS sellingPrice, quantity * cost_price AS costValue FROM products WHERE owner_id = ? AND is_active = 1 ORDER BY costValue DESC LIMIT 15', [ownerId]);
  const shapeCat = c => ({ category: c.category, products: Number(c.products), units: Number(c.units), costValue: Math.round(Number(c.costValue) * 100) / 100, retailValue: Math.round(Number(c.retailValue) * 100) / 100 });
  const cats = categories.map(shapeCat);
  res.json({ data: {
    totals: cats.reduce((t, c) => ({ products: t.products + c.products, units: t.units + c.units, costValue: Math.round((t.costValue + c.costValue) * 100) / 100, retailValue: Math.round((t.retailValue + c.retailValue) * 100) / 100 }), { products: 0, units: 0, costValue: 0, retailValue: 0 }),
    categories: cats,
    topValueItems: items.map(i => ({ ...i, id: Number(i.id), quantity: Number(i.quantity), costPrice: Number(i.costPrice), sellingPrice: Number(i.sellingPrice), costValue: Math.round(Number(i.costValue) * 100) / 100 }))
  } });
}));

// GST summary: sales value and the tax contained in it, by tax rate.
router.get('/tax', asyncHandler(async (req, res) => {
  const ownerId = Number(req.user.sub);
  const range = await resolveRange(req.query);
  const [rows] = await pool.execute("SELECT si.tax_rate AS rate, COALESCE(SUM(si.line_total),0) AS gross, COALESCE(SUM(si.line_total * si.tax_rate / (100 + si.tax_rate)),0) AS tax FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.owner_id = ? AND s.status = 'completed' AND s.sale_date >= ? AND s.sale_date < ? GROUP BY si.tax_rate ORDER BY si.tax_rate", [ownerId, range.from, range.toExclusive]);
  const lines = rows.map(r => ({ rate: Number(r.rate), gross: Math.round(Number(r.gross) * 100) / 100, tax: Math.round(Number(r.tax) * 100) / 100, taxable: Math.round((Number(r.gross) - Number(r.tax)) * 100) / 100 }));
  res.json({ data: { range: { from: range.from, to: range.to }, lines, totals: lines.reduce((t, l) => ({ gross: Math.round((t.gross + l.gross) * 100) / 100, tax: Math.round((t.tax + l.tax) * 100) / 100, taxable: Math.round((t.taxable + l.taxable) * 100) / 100 }), { gross: 0, tax: 0, taxable: 0 }) } });
}));

// Flat sales rows for CSV export (client builds the file).
router.get('/sales-export', asyncHandler(async (req, res) => {
  const ownerId = Number(req.user.sub);
  const range = await resolveRange(req.query);
  const [rows] = await pool.execute("SELECT s.sale_number AS invoice, s.sale_date AS date, COALESCE(c.name, 'Walk-in') AS customer, s.payment_method AS paymentMethod, s.subtotal, s.discount_amount AS discount, s.tax_amount AS tax, s.total_amount AS total, s.amount_paid AS paid, s.status FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.owner_id = ? AND s.sale_date >= ? AND s.sale_date < ? ORDER BY s.sale_date, s.id LIMIT 5000", [ownerId, range.from, range.toExclusive]);
  res.json({ data: rows.map(r => ({ ...r, subtotal: Number(r.subtotal), discount: Number(r.discount), tax: Number(r.tax), total: Number(r.total), paid: Number(r.paid) })), meta: { from: range.from, to: range.to } });
}));
export default router;
