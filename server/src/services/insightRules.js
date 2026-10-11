/** Deterministic, explainable recommendations. This is rules-based analysis, not a generative AI prediction. */
export function buildInsights({ lowStock = [], salesTrend = [], topProducts = [], summary = {} }) {
  const insights = [];
  if (lowStock.length) {
    const names = lowStock.slice(0, 3).map(p => p.name).join(', ');
    insights.push({ id: 'low-stock', severity: 'warning', title: `${lowStock.length} product${lowStock.length === 1 ? '' : 's'} need restocking`, description: `${names}${lowStock.length > 3 ? ` and ${lowStock.length - 3} more` : ''} ${lowStock.length === 1 ? 'is' : 'are'} at or below the configured stock threshold.`, recommendation: 'Review stock levels and plan replenishment before the next sale.', evidence: lowStock.slice(0, 5).map(p => ({ label: p.name, value: `${p.quantity} left · threshold ${p.lowStockThreshold}` })), action: 'inventory' });
  }
  const recent = salesTrend.slice(-14);
  if (recent.length >= 14) {
    const current = recent.slice(-7).reduce((sum, d) => sum + Number(d.sales || 0), 0);
    const previous = recent.slice(0, 7).reduce((sum, d) => sum + Number(d.sales || 0), 0);
    if (current > 0 && previous > 0) {
      const pct = Math.round(((current - previous) / previous) * 100);
      if (pct >= 15) insights.push({ id: 'sales-trend-up', severity: 'positive', title: 'Sales activity is higher in the latest week', description: `Sales in the latest 7 days are ${pct}% above the preceding 7 days.`, recommendation: 'Check which products and customer orders contributed before increasing stock.', evidence: [{ label: 'Latest 7 days', value: current }, { label: 'Previous 7 days', value: previous }], action: 'reports' });
      else if (pct <= -15) insights.push({ id: 'sales-trend-down', severity: 'info', title: 'Recent sales are lower than the prior week', description: `Sales in the latest 7 days are ${Math.abs(pct)}% below the preceding 7 days.`, recommendation: 'Review product availability and recent order activity before changing purchasing plans.', evidence: [{ label: 'Latest 7 days', value: current }, { label: 'Previous 7 days', value: previous }], action: 'reports' });
    }
  }
  if (topProducts.length) {
    const p = topProducts[0];
    insights.push({ id: 'top-product', severity: 'positive', title: `${p.name} leads recorded sales`, description: `${p.name} contributed ${Number(p.revenue || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })} in recorded sales over the last 30 days.`, recommendation: 'Keep this item available and compare its margin and stock needs before reordering.', evidence: [{ label: 'Units sold', value: Number(p.quantitySold || 0) }, { label: 'Recorded revenue', value: Number(p.revenue || 0) }], action: 'reports' });
  }
  if (!insights.length) insights.push({ id: 'getting-started', severity: 'info', title: 'Your workspace is ready for its first insight', description: 'Insights become more useful after you add products and record sales or orders.', recommendation: 'Add your current inventory, then record your first sale to start building a business picture.', evidence: [{ label: 'Products tracked', value: Number(summary.totalProducts || 0) }, { label: 'Sales today', value: Number(summary.salesToday || 0) }], action: 'inventory' });
  return insights;
}

const inr = v => Number(v || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const list = (items, max = 3) => items.slice(0, max).join(', ') + (items.length > max ? ` and ${items.length - max} more` : '');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Richer rule set built from precomputed facts. Each rule only fires when the data supports it and
 * always carries the evidence it used. Pure function so it can be unit tested.
 *
 * facts: { today, velocity[], overdue[], customers{top[],inactive[]}, weekday[], month{}, previousMonth{},
 *          openOrders{count,oldestDays}, margins[], expiring[] }
 */
export function buildAdvancedInsights(facts = {}) {
  const out = [];
  const { velocity = [], overdue = [], customers = {}, weekday = [], month, previousMonth, openOrders, margins = [], expiring = [] } = facts;

  const outOfStock = velocity.filter(p => p.quantity === 0 && p.sold > 0);
  if (outOfStock.length) {
    out.push({ id: 'out-of-stock', category: 'stock', severity: 'critical', title: `${outOfStock.length} selling product${outOfStock.length === 1 ? ' is' : 's are'} out of stock`,
      description: `${list(outOfStock.map(p => p.name))} sold in the last 30 days but ${outOfStock.length === 1 ? 'has' : 'have'} no stock left, so every new request is a lost sale.`,
      recommendation: 'Restock these first. Use Receive stock to record the purchase and update the cost price.',
      evidence: outOfStock.slice(0, 5).map(p => ({ label: p.name, value: `${p.sold} sold in 30 days` })), action: 'inventory', href: '/app/inventory?status=out' });
  }

  const reorder = velocity.filter(p => p.quantity > 0 && p.daysLeft !== null && p.daysLeft <= 7).sort((a, b) => a.daysLeft - b.daysLeft);
  if (reorder.length) {
    const suggestion = p => Math.max(1, Math.ceil(p.velocity * 14 + p.threshold - p.quantity));
    out.push({ id: 'reorder-soon', category: 'stock', severity: 'warning', title: `${reorder.length} product${reorder.length === 1 ? '' : 's'} will run out within a week`,
      description: `At the current selling pace, ${list(reorder.map(p => p.name))} ${reorder.length === 1 ? 'is' : 'are'} projected to run out in ${reorder[0].daysLeft} day${reorder[0].daysLeft === 1 ? '' : 's'} or less.`,
      recommendation: 'Place a purchase order to cover about two weeks of sales. Suggested quantities are shown below.',
      evidence: reorder.slice(0, 5).map(p => ({ label: p.name, value: `${p.daysLeft} days left · order ~${suggestion(p)} ${p.unit || 'units'}` })), action: 'inventory', href: '/app/inventory?status=attention' });
  }

  const dead = velocity.filter(p => p.quantity > 0 && p.sold === 0 && p.stockedSince && p.stockedSince.slice(0, 10) <= facts.thirtyDaysAgo);
  if (dead.length) {
    const tied = dead.reduce((s, p) => s + p.quantity * p.costPrice, 0);
    out.push({ id: 'dead-stock', category: 'products', severity: 'info', title: `${inr(tied)} is tied up in products that did not sell`,
      description: `${list(dead.map(p => p.name))} had no sales in the last 30 days despite ${dead.length === 1 ? 'being' : 'all being'} in stock.`,
      recommendation: 'Bundle them with fast sellers, offer a small discount, or stop reordering until demand returns.',
      evidence: dead.slice(0, 5).map(p => ({ label: p.name, value: `${p.quantity} in stock · ${inr(p.quantity * p.costPrice)} at cost` })), action: 'inventory', href: '/app/inventory' });
  }

  if (expiring.length) {
    const expired = expiring.filter(p => p.daysToExpiry < 0);
    out.push({ id: 'expiring', category: 'stock', severity: expired.length || expiring.some(p => p.daysToExpiry <= 7) ? 'critical' : 'warning',
      title: `${expiring.length} product${expiring.length === 1 ? '' : 's'} ${expired.length ? 'expired or expiring' : 'expiring'} soon`,
      description: `${list(expiring.map(p => p.name))} ${expiring.length === 1 ? 'reaches its' : 'reach their'} expiry date within 30 days.`,
      recommendation: 'Move these to the front, discount them, and avoid reordering until they clear.',
      evidence: expiring.slice(0, 5).map(p => ({ label: p.name, value: p.daysToExpiry < 0 ? `expired ${-p.daysToExpiry} days ago · ${p.quantity} left` : `${p.daysToExpiry} days left · ${p.quantity} in stock` })), action: 'inventory', href: '/app/inventory?status=expiring' });
  }

  if (overdue.length) {
    const total = overdue.reduce((s, c) => s + c.amount, 0);
    out.push({ id: 'overdue-credit', category: 'finance', severity: total > 5000 ? 'warning' : 'info', title: `${inr(total)} of credit is more than a week overdue`,
      description: `${overdue.length} customer${overdue.length === 1 ? ' has' : 's have'} unpaid credit sales older than 7 days, led by ${overdue[0].name}.`,
      recommendation: 'Send a polite reminder and record each payment as it arrives so balances stay accurate.',
      evidence: overdue.slice(0, 5).map(c => ({ label: c.name, value: `${inr(c.amount)} · oldest ${c.oldestDays} days` })), action: 'customers', href: '/app/customers?status=owing' });
  }

  if (month && previousMonth && previousMonth.revenue > 0 && facts.monthProgress >= 0.4) {
    const pace = month.revenue / facts.monthProgress;
    const pct = Math.round((pace / previousMonth.revenue - 1) * 100);
    if (Math.abs(pct) >= 10) out.push({ id: 'month-pace', category: 'sales', severity: pct > 0 ? 'positive' : 'info', title: pct > 0 ? `This month is on pace for ${pct}% more sales than last month` : `This month is pacing ${Math.abs(pct)}% below last month`,
      description: `${inr(month.revenue)} sold so far (${Math.round(facts.monthProgress * 100)}% of the month). At this pace the month ends near ${inr(pace)} versus ${inr(previousMonth.revenue)} last month.`,
      recommendation: pct > 0 ? 'Make sure the best sellers are stocked for the rest of the month.' : 'Review slow days and consider a promotion on your best-margin items.',
      evidence: [{ label: 'Sold so far', value: month.revenue }, { label: 'Projected month', value: Math.round(pace) }, { label: 'Last month', value: previousMonth.revenue }], action: 'reports', href: '/app/reports' });
  }

  if (month && month.revenue > 0 && previousMonth && previousMonth.revenue > 0) {
    const delta = Math.round((month.margin - previousMonth.margin) * 10) / 10;
    if (Math.abs(delta) >= 2) out.push({ id: 'margin-shift', category: 'finance', severity: delta < 0 ? 'warning' : 'positive', title: `Profit margin ${delta < 0 ? 'fell' : 'rose'} to ${month.margin}%`,
      description: `Gross margin this month is ${month.margin}% compared with ${previousMonth.margin}% last month (${delta > 0 ? '+' : ''}${delta} points).`,
      recommendation: delta < 0 ? 'Check recent supplier price increases and discounts given; update selling prices where costs rose.' : 'Keep an eye on whether the improvement comes from pricing or from the product mix.',
      evidence: [{ label: 'Margin this month', value: `${month.margin}%` }, { label: 'Margin last month', value: `${previousMonth.margin}%` }], action: 'reports', href: '/app/reports' });
  }

  const lowMargin = margins.filter(p => p.margin < 8 && p.sold > 0).sort((a, b) => a.margin - b.margin);
  if (lowMargin.length) {
    out.push({ id: 'low-margin', category: 'products', severity: 'info', title: `${lowMargin.length} selling product${lowMargin.length === 1 ? ' earns' : 's earn'} under 8% margin`,
      description: `${list(lowMargin.map(p => p.name))} ${lowMargin.length === 1 ? 'has' : 'have'} a thin margin after cost and GST.`,
      recommendation: 'Raise the selling price slightly or negotiate a better purchase price with the supplier.',
      evidence: lowMargin.slice(0, 5).map(p => ({ label: p.name, value: `${p.margin}% margin · cost ${inr(p.cost)} vs price ${inr(p.price)}` })), action: 'inventory', href: '/app/inventory' });
  }

  const bestCustomers = customers.top || [];
  if (bestCustomers.length >= 3 && facts.revenue30 > 0) {
    const share = Math.round(bestCustomers.slice(0, 3).reduce((s, c) => s + c.revenue, 0) / facts.revenue30 * 100);
    out.push({ id: 'top-customers', category: 'customers', severity: 'positive', title: `Your top 3 customers bring ${share}% of sales`,
      description: `${list(bestCustomers.map(c => c.name))} are your most valuable customers over the last 30 days.`,
      recommendation: share > 50 ? 'Sales depend heavily on a few customers. Look after them and work on widening the base.' : 'Keep them happy with reliable stock and consider a small loyalty gesture.',
      evidence: bestCustomers.slice(0, 3).map(c => ({ label: c.name, value: `${inr(c.revenue)} · ${c.count} purchases` })), action: 'customers', href: '/app/customers?sort=spent' });
  }

  const inactive = customers.inactive || [];
  if (inactive.length) {
    out.push({ id: 'inactive-customers', category: 'customers', severity: 'info', title: `${inactive.length} regular customer${inactive.length === 1 ? ' has' : 's have'} not bought in over a month`,
      description: `${list(inactive.map(c => c.name))} used to buy regularly but nothing was recorded for 30+ days.`,
      recommendation: 'A quick call or message about new stock can win them back.',
      evidence: inactive.slice(0, 5).map(c => ({ label: c.name, value: `last purchase ${c.daysSince} days ago · ${inr(c.totalSpent)} lifetime` })), action: 'customers', href: '/app/customers?sort=recent' });
  }

  const days = weekday.filter(d => d.average > 0);
  if (days.length >= 5) {
    const best = [...days].sort((a, b) => b.average - a.average)[0];
    const worst = [...days].sort((a, b) => a.average - b.average)[0];
    if (best.average > worst.average * 1.2) out.push({ id: 'weekday-pattern', category: 'sales', severity: 'info', title: `${WEEKDAYS[best.day]} is your strongest day, ${WEEKDAYS[worst.day]} your weakest`,
      description: `Over the last 8 weeks you average ${inr(best.average)} on ${WEEKDAYS[best.day]}s and ${inr(worst.average)} on ${WEEKDAYS[worst.day]}s.`,
      recommendation: `Restock before ${WEEKDAYS[best.day]} and consider an offer to lift ${WEEKDAYS[worst.day]}.`,
      evidence: [{ label: `Average ${WEEKDAYS[best.day]}`, value: Math.round(best.average) }, { label: `Average ${WEEKDAYS[worst.day]}`, value: Math.round(worst.average) }], action: 'reports', href: '/app/reports' });
  }

  if (openOrders && openOrders.count > 0 && openOrders.oldestDays >= 3) {
    out.push({ id: 'stale-orders', category: 'sales', severity: 'warning', title: `${openOrders.count} open order${openOrders.count === 1 ? '' : 's'} waiting, the oldest for ${openOrders.oldestDays} days`,
      description: 'Orders that sit in Pending, Processing or Ready delay revenue and can disappoint customers.',
      recommendation: 'Move them forward or contact the customer about timing.',
      evidence: [{ label: 'Open orders', value: openOrders.count }, { label: 'Oldest (days)', value: openOrders.oldestDays }], action: 'orders', href: '/app/orders?status=open' });
  }
  return out;
}

const RANK = { critical: 0, warning: 1, info: 2, positive: 3 };
/** Merge the legacy rules with the richer ones, dropping duplicates and ordering by urgency. */
export function prioritizeInsights(basic, advanced) {
  const advancedIds = new Set(advanced.map(i => i.id));
  const merged = [...advanced, ...basic.filter(i => !advancedIds.has(i.id))];
  return merged.map(i => ({ category: i.category || (i.action === 'inventory' ? 'stock' : 'sales'), ...i })).sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9));
}
