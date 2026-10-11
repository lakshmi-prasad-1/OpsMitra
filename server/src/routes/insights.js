import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { buildInsights, buildAdvancedInsights, prioritizeInsights } from '../services/insightRules.js';
import { collectBusinessFacts } from '../services/businessFacts.js';
import { forecastSales } from '../services/analytics.js';
const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const ownerId = Number(req.user.sub);
  const facts = await collectBusinessFacts(ownerId);
  const lowStock = facts.velocity.filter(p => p.quantity <= p.threshold).sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name)).slice(0, 20)
    .map(p => ({ id: p.id, name: p.name, sku: p.sku, quantity: p.quantity, lowStockThreshold: p.threshold }));
  const basic = buildInsights({
    lowStock, salesTrend: facts.trend.slice(-14), topProducts: facts.topProducts30,
    summary: { totalProducts: facts.velocity.length, salesToday: facts.salesToday }
  });
  const advanced = buildAdvancedInsights(facts);
  const insights = prioritizeInsights(basic, advanced);
  const counts = insights.reduce((t, i) => ({ ...t, [i.severity]: (t[i.severity] || 0) + 1 }), {});
  res.json({ data: { generatedAt: new Date().toISOString(), source: 'recorded-business-data', method: 'rules', counts, insights, forecast: forecastSales(facts.trend, facts.today, 7), history: facts.trend.slice(-28) } });
}));
export default router;
