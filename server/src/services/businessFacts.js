import { pool } from '../db.js';
import { databaseToday, shiftDate, diffDays, dateRange, periodTotals, dailyTrend, topProducts, topCustomers, stockVelocity } from './analytics.js';

/** Gathers the measured facts the insight rules, notifications and assistant all reason over. */
export async function collectBusinessFacts(ownerId) {
  const today = await databaseToday();
  const tomorrow = shiftDate(today, 1);
  const from90 = shiftDate(today, -89);
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthEnd = monthStart;
  const prevMonthStart = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  const daysInMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
  const thirtyDaysAgo = shiftDate(today, -30);

  const [velocity, trend, month, previousMonth, products30, customers30] = await Promise.all([
    stockVelocity(ownerId, today, 30),
    dailyTrend(ownerId, from90, tomorrow, dateRange(from90, today)),
    periodTotals(ownerId, monthStart, tomorrow),
    periodTotals(ownerId, prevMonthStart, prevMonthEnd),
    topProducts(ownerId, shiftDate(today, -29), tomorrow, 5),
    topCustomers(ownerId, shiftDate(today, -29), tomorrow, 5)
  ]);

  const [overdueRows] = await pool.execute(
    "SELECT c.name, SUM(s.total_amount - s.amount_paid) AS amount, MIN(s.sale_date) AS oldest FROM sales s JOIN customers c ON c.id = s.customer_id WHERE s.owner_id = ? AND s.status = 'completed' AND s.amount_paid < s.total_amount AND s.sale_date < ? GROUP BY c.id, c.name ORDER BY amount DESC LIMIT 20",
    [ownerId, shiftDate(today, -6)]);
  const overdue = overdueRows.map(r => ({ name: r.name, amount: Math.round(Number(r.amount) * 100) / 100, oldestDays: diffDays(String(r.oldest).slice(0, 10), today) }));

  const [inactiveRows] = await pool.execute(
    "SELECT c.name, COUNT(*) AS purchases, MAX(s.sale_date) AS lastPurchase, SUM(s.total_amount) AS spent FROM sales s JOIN customers c ON c.id = s.customer_id WHERE s.owner_id = ? AND s.status = 'completed' AND c.is_active = 1 GROUP BY c.id, c.name HAVING purchases >= 3 AND MAX(s.sale_date) < ? ORDER BY spent DESC LIMIT 10",
    [ownerId, thirtyDaysAgo]);
  const inactive = inactiveRows.map(r => ({ name: r.name, daysSince: diffDays(String(r.lastPurchase).slice(0, 10), today), totalSpent: Math.round(Number(r.spent)) }));

  // Average takings per weekday over the last 8 weeks (zero days included).
  const buckets = Array.from({ length: 7 }, () => []);
  for (const d of trend.slice(-56)) buckets[new Date(`${d.date}T00:00:00Z`).getUTCDay()].push(d.sales);
  const weekday = buckets.map((values, day) => ({ day, average: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0 }));

  const [[open]] = await pool.execute("SELECT COUNT(*) AS count, MIN(order_date) AS oldest FROM orders WHERE owner_id = ? AND status IN ('pending','processing','ready')", [ownerId]);
  const openOrders = { count: Number(open.count), oldestDays: open.oldest ? diffDays(String(open.oldest).slice(0, 10), today) : 0 };

  const margins = velocity.filter(p => p.costPrice > 0 && p.sellingPrice > 0).map(p => {
    const net = p.sellingPrice / (1 + p.taxRate / 100);
    return { name: p.name, sold: p.sold, cost: p.costPrice, price: p.sellingPrice, margin: Math.round((net - p.costPrice) / p.sellingPrice * 1000) / 10 };
  });
  const expiring = velocity.filter(p => p.expiryDate && p.quantity > 0 && diffDays(today, p.expiryDate) <= 30)
    .map(p => ({ name: p.name, quantity: p.quantity, daysToExpiry: diffDays(today, p.expiryDate) })).sort((a, b) => a.daysToExpiry - b.daysToExpiry);

  return {
    today, thirtyDaysAgo, velocity, trend, month, previousMonth, monthProgress: Number(today.slice(8, 10)) / daysInMonth,
    topProducts30: products30, revenue30: trend.slice(-30).reduce((s, d) => s + d.sales, 0), salesToday: trend[trend.length - 1]?.sales ?? 0,
    overdue, customers: { top: customers30, inactive }, weekday, openOrders, margins, expiring
  };
}
