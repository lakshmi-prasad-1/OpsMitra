import { pool, databaseTodaySql } from '../db.js';
import { dateKeysEndingAt } from '../utils/dates.js';

/** Shared read-only analytics queries. Every query is scoped to one owner and to completed sales. */
export async function databaseToday() {
  const [[row]] = await pool.execute(databaseTodaySql);
  return String(row.today).slice(0, 10);
}
export function shiftDate(dateOnly, days) {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const diffDays = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
export function dateRange(from, to) {
  const days = diffDays(from, to) + 1;
  return dateKeysEndingAt(to, days);
}
const round2 = n => Math.round(Number(n) * 100) / 100;
const NET_OF_TAX = 'si.line_total - si.line_total * si.tax_rate / (100 + si.tax_rate)';

/** Totals for [from, toExclusive). Profit is revenue net of GST, minus product cost. */
export async function periodTotals(ownerId, from, toExclusive) {
  const [[sales]] = await pool.execute("SELECT COALESCE(SUM(total_amount),0) AS revenue, COUNT(*) AS salesCount, COALESCE(SUM(discount_amount),0) AS discount, COALESCE(SUM(tax_amount),0) AS tax FROM sales WHERE owner_id = ? AND status = 'completed' AND sale_date >= ? AND sale_date < ?", [ownerId, from, toExclusive]);
  const [[lines]] = await pool.execute(`SELECT COALESCE(SUM(${NET_OF_TAX}),0) AS net, COALESCE(SUM(si.quantity * si.unit_cost),0) AS cost, COALESCE(SUM(si.quantity),0) AS units FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.owner_id = ? AND s.status = 'completed' AND s.sale_date >= ? AND s.sale_date < ?`, [ownerId, from, toExclusive]);
  const revenue = Number(sales.revenue), count = Number(sales.salesCount), cost = Number(lines.cost), discount = Number(sales.discount);
  const profit = Number(lines.net) - cost - discount;
  return { revenue: round2(revenue), salesCount: count, averageSale: count ? round2(revenue / count) : 0, discount: round2(discount), tax: round2(sales.tax), cost: round2(cost), profit: round2(profit), margin: revenue ? round2(profit / revenue * 100) : 0, itemsSold: Number(lines.units) };
}

export async function dailyTrend(ownerId, from, toExclusive, keys) {
  const [sales] = await pool.execute("SELECT DATE(sale_date) AS date, COALESCE(SUM(total_amount),0) AS sales, COUNT(*) AS transactions, COALESCE(SUM(discount_amount),0) AS discount FROM sales WHERE owner_id = ? AND status = 'completed' AND sale_date >= ? AND sale_date < ? GROUP BY DATE(sale_date)", [ownerId, from, toExclusive]);
  const [lines] = await pool.execute(`SELECT DATE(s.sale_date) AS date, COALESCE(SUM(${NET_OF_TAX}),0) AS net, COALESCE(SUM(si.quantity * si.unit_cost),0) AS cost FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.owner_id = ? AND s.status = 'completed' AND s.sale_date >= ? AND s.sale_date < ? GROUP BY DATE(s.sale_date)`, [ownerId, from, toExclusive]);
  const byDate = new Map(sales.map(r => [String(r.date).slice(0, 10), { sales: Number(r.sales), transactions: Number(r.transactions), discount: Number(r.discount) }]));
  const lineByDate = new Map(lines.map(r => [String(r.date).slice(0, 10), Number(r.net) - Number(r.cost)]));
  return keys.map(date => {
    const s = byDate.get(date) || { sales: 0, transactions: 0, discount: 0 };
    return { date, sales: round2(s.sales), transactions: s.transactions, profit: round2((lineByDate.get(date) || 0) - s.discount) };
  });
}

export async function topProducts(ownerId, from, toExclusive, limit = 10) {
  const [rows] = await pool.execute(`SELECT p.id, p.name, p.sku, COALESCE(p.category, 'Uncategorised') AS category, COALESCE(SUM(si.quantity),0) AS quantitySold, COALESCE(SUM(si.line_total),0) AS revenue, COALESCE(SUM(${NET_OF_TAX} - si.quantity * si.unit_cost),0) AS profit FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id WHERE s.owner_id = ? AND s.status = 'completed' AND p.owner_id = ? AND s.sale_date >= ? AND s.sale_date < ? GROUP BY p.id, p.name, p.sku, p.category ORDER BY revenue DESC LIMIT ?`, [ownerId, ownerId, from, toExclusive, limit]);
  return rows.map(r => ({ id: Number(r.id), name: r.name, sku: r.sku, category: r.category, quantitySold: Number(r.quantitySold), revenue: round2(r.revenue), profit: round2(r.profit) }));
}

export async function categoryBreakdown(ownerId, from, toExclusive) {
  const [rows] = await pool.execute(`SELECT COALESCE(p.category, 'Uncategorised') AS category, COALESCE(SUM(si.quantity),0) AS quantity, COALESCE(SUM(si.line_total),0) AS revenue, COALESCE(SUM(${NET_OF_TAX} - si.quantity * si.unit_cost),0) AS profit FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id WHERE s.owner_id = ? AND s.status = 'completed' AND s.sale_date >= ? AND s.sale_date < ? GROUP BY COALESCE(p.category, 'Uncategorised') ORDER BY revenue DESC`, [ownerId, from, toExclusive]);
  return rows.map(r => ({ category: r.category, quantity: Number(r.quantity), revenue: round2(r.revenue), profit: round2(r.profit) }));
}

export async function paymentBreakdown(ownerId, from, toExclusive) {
  const [rows] = await pool.execute("SELECT payment_method AS method, COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS amount FROM sales WHERE owner_id = ? AND status = 'completed' AND sale_date >= ? AND sale_date < ? GROUP BY payment_method ORDER BY amount DESC", [ownerId, from, toExclusive]);
  return rows.map(r => ({ method: r.method, count: Number(r.count), amount: round2(r.amount) }));
}

export async function topCustomers(ownerId, from, toExclusive, limit = 8) {
  const [rows] = await pool.execute("SELECT c.id, c.name, COUNT(*) AS count, COALESCE(SUM(s.total_amount),0) AS revenue FROM sales s JOIN customers c ON c.id = s.customer_id WHERE s.owner_id = ? AND s.status = 'completed' AND s.sale_date >= ? AND s.sale_date < ? GROUP BY c.id, c.name ORDER BY revenue DESC LIMIT ?", [ownerId, from, toExclusive, limit]);
  return rows.map(r => ({ id: Number(r.id), name: r.name, count: Number(r.count), revenue: round2(r.revenue) }));
}

export async function receivables(ownerId) {
  const [[row]] = await pool.execute("SELECT COALESCE(SUM(total_amount - amount_paid),0) AS outstanding, COUNT(DISTINCT customer_id) AS customers, COUNT(*) AS invoices FROM sales WHERE owner_id = ? AND status = 'completed' AND amount_paid < total_amount", [ownerId]);
  return { outstanding: round2(row.outstanding), customers: Number(row.customers), invoices: Number(row.invoices) };
}

/** Stock velocity per product over the last `windowDays`, used for days-of-stock and reorder maths. */
export async function stockVelocity(ownerId, today, windowDays = 30) {
  const start = shiftDate(today, -(windowDays - 1));
  const end = shiftDate(today, 1);
  const [rows] = await pool.execute(`SELECT p.id, p.name, p.sku, p.category, p.quantity, p.low_stock_threshold AS threshold, p.cost_price AS costPrice, p.selling_price AS sellingPrice, p.tax_rate AS taxRate, p.unit, p.expiry_date AS expiryDate,
      COALESCE(v.sold, 0) AS sold, v.lastSold AS lastSold, (SELECT MIN(created_at) FROM stock_movements m WHERE m.product_id = p.id AND m.owner_id = p.owner_id) AS stockedSince
    FROM products p LEFT JOIN (
      SELECT si.product_id, SUM(si.quantity) AS sold, MAX(s.sale_date) AS lastSold FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.owner_id = ? AND s.status = 'completed' AND s.sale_date >= ? AND s.sale_date < ? GROUP BY si.product_id) v ON v.product_id = p.id
    WHERE p.owner_id = ? AND p.is_active = 1`, [ownerId, start, end, ownerId]);
  return rows.map(r => {
    const sold = Number(r.sold); const velocity = sold / windowDays; const quantity = Number(r.quantity);
    return { id: Number(r.id), name: r.name, sku: r.sku, category: r.category, quantity, threshold: Number(r.threshold), costPrice: Number(r.costPrice), sellingPrice: Number(r.sellingPrice), taxRate: Number(r.taxRate), unit: r.unit, expiryDate: r.expiryDate, sold, velocity, lastSold: r.lastSold, stockedSince: r.stockedSince,
      daysLeft: velocity > 0 ? Math.floor(quantity / velocity) : null };
  });
}

/** Statistical sales forecast: same-weekday average of the last 8 weeks, scaled by the recent trend. */
export function forecastSales(history, today, horizon = 7) {
  const byDate = new Map(history.map(d => [d.date, d.sales]));
  const weekdayValues = Array.from({ length: 7 }, () => []);
  for (let back = 1; back <= 56; back++) {
    const date = shiftDate(today, -back);
    if (!byDate.has(date)) continue;
    weekdayValues[new Date(`${date}T00:00:00Z`).getUTCDay()].push(byDate.get(date));
  }
  const avg = list => list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  const recent = avg(history.slice(-14).map(d => d.sales));
  const prior = avg(history.slice(-28, -14).map(d => d.sales));
  const trend = prior > 0 && recent > 0 ? Math.min(1.25, Math.max(0.8, recent / prior)) : 1;
  const out = [];
  for (let i = 1; i <= horizon; i++) {
    const date = shiftDate(today, i);
    const base = avg(weekdayValues[new Date(`${date}T00:00:00Z`).getUTCDay()]);
    out.push({ date, predicted: round2(base * (1 + (trend - 1) * 0.5)) });
  }
  return { trendFactor: Math.round(trend * 100) / 100, days: out, total: round2(out.reduce((s, d) => s + d.predicted, 0)) };
}
