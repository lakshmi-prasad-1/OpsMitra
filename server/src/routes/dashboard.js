import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { databaseToday, shiftDate, periodTotals, dailyTrend, dateRange, topProducts, receivables } from '../services/analytics.js';
const router = Router();

router.get('/summary', asyncHandler(async (req, res) => {
  const ownerId = Number(req.user.sub);
  const today = await databaseToday();
  const tomorrow = shiftDate(today, 1);
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 10);
  // One SQL statement keeps the headline KPI figures on the same database-day boundary.
  const [[summary]] = await pool.execute(`
    SELECT
      (SELECT COUNT(*) FROM products WHERE owner_id = ? AND is_active = 1) AS totalProducts,
      (SELECT COALESCE(SUM(CASE WHEN quantity <= low_stock_threshold THEN 1 ELSE 0 END), 0) FROM products WHERE owner_id = ? AND is_active = 1) AS lowStockItems,
      (SELECT COALESCE(SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END), 0) FROM products WHERE owner_id = ? AND is_active = 1) AS outOfStockItems,
      (SELECT COALESCE(SUM(quantity * cost_price), 0) FROM products WHERE owner_id = ? AND is_active = 1) AS inventoryValue,
      (SELECT COUNT(*) FROM orders WHERE owner_id = ? AND status IN ('pending','processing','ready')) AS pendingOrders,
      (SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE owner_id = ? AND status = 'completed' AND sale_date >= ? AND sale_date < ?) AS salesToday,
      (SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE owner_id = ? AND status = 'completed' AND sale_date >= ? AND sale_date < ?) AS salesYesterday,
      (SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE owner_id = ? AND status = 'completed' AND sale_date >= ? AND sale_date < ?) AS salesThisMonth,
      (SELECT COUNT(*) FROM sales WHERE owner_id = ? AND status = 'completed' AND sale_date >= ? AND sale_date < ?) AS salesCount,
      (SELECT COUNT(*) FROM customers WHERE owner_id = ? AND is_active = 1) AS totalCustomers
  `, [ownerId, ownerId, ownerId, ownerId, ownerId,
      ownerId, today, tomorrow, ownerId, shiftDate(today, -1), today, ownerId, monthStart, nextMonth, ownerId, today, tomorrow, ownerId]);
  const month = await periodTotals(ownerId, monthStart, tomorrow);
  const last30From = shiftDate(today, -29);
  const [trend, products, due] = await Promise.all([
    dailyTrend(ownerId, last30From, tomorrow, dateRange(last30From, today)),
    topProducts(ownerId, last30From, tomorrow, 5),
    receivables(ownerId)
  ]);
  const data = Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, Math.round(Number(value) * 100) / 100]));
  res.json({ data: { ...data, profitThisMonth: month.profit, marginThisMonth: month.margin, outstandingCredit: due.outstanding, creditCustomers: due.customers, trend, topProducts: products } });
}));
export default router;
