import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db.js';
import { collectBusinessFacts } from './businessFacts.js';
import { buildInsights, buildAdvancedInsights, prioritizeInsights } from './insightRules.js';
import { databaseToday, shiftDate, periodTotals, topProducts, topCustomers, forecastSales, receivables } from './analytics.js';

const inr = v => Number(v || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const RANGES = ['today', 'yesterday', '7d', '30d', 'month', 'last_month'];

async function resolveRange(range) {
  const today = await databaseToday();
  const month = `${today.slice(0, 7)}-01`;
  switch (range) {
    case 'yesterday': return { label: 'yesterday', from: shiftDate(today, -1), to: today };
    case '7d': return { label: 'the last 7 days', from: shiftDate(today, -6), to: shiftDate(today, 1) };
    case '30d': return { label: 'the last 30 days', from: shiftDate(today, -29), to: shiftDate(today, 1) };
    case 'month': return { label: 'this month', from: month, to: shiftDate(today, 1) };
    case 'last_month': return { label: 'last month', from: new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10), to: month };
    default: return { label: 'today', from: today, to: shiftDate(today, 1) };
  }
}

/**
 * Read-only tools shared by the Claude-powered assistant and the offline fallback. Every tool is scoped
 * to the signed-in owner; the model never writes SQL and never sees another account's rows.
 */
export const TOOLS = [
  {
    name: 'sales_summary', description: 'Revenue, number of sales, average sale, gross profit and margin for a period, compared with the period just before it.',
    input_schema: { type: 'object', properties: { range: { type: 'string', enum: RANGES, description: 'Period to summarise.' } }, required: ['range'], additionalProperties: false },
    async run(ownerId, { range = 'today' }) {
      const r = await resolveRange(range);
      const days = Math.max(1, Math.round((new Date(`${r.to}T00:00:00Z`) - new Date(`${r.from}T00:00:00Z`)) / 86400000));
      const [current, previous] = await Promise.all([periodTotals(ownerId, r.from, r.to), periodTotals(ownerId, shiftDate(r.from, -days), r.from)]);
      return { period: r.label, from: r.from, toExclusive: r.to, current, previousPeriod: previous };
    }
  },
  {
    name: 'top_products', description: 'Best-selling products by revenue over the last N days, with units sold and gross profit.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 }, limit: { type: 'integer', minimum: 1, maximum: 15 } }, additionalProperties: false },
    async run(ownerId, { days = 30, limit = 5 }) {
      const today = await databaseToday();
      return { days, products: await topProducts(ownerId, shiftDate(today, -(days - 1)), shiftDate(today, 1), Math.min(15, limit)) };
    }
  },
  {
    name: 'stock_status', description: 'Inventory lists: "out" (zero stock), "low" (at/below threshold), "reorder" (projected to run out within 7 days, with suggested order quantity), "expiring" (expires within 30 days) or "dead" (in stock but no sales for 30 days).',
    input_schema: { type: 'object', properties: { filter: { type: 'string', enum: ['out', 'low', 'reorder', 'expiring', 'dead'] } }, required: ['filter'], additionalProperties: false },
    async run(ownerId, { filter }) {
      const facts = await collectBusinessFacts(ownerId);
      const v = facts.velocity;
      const pick = {
        out: () => v.filter(p => p.quantity === 0).map(p => ({ name: p.name, soldLast30Days: p.sold })),
        low: () => v.filter(p => p.quantity > 0 && p.quantity <= p.threshold).map(p => ({ name: p.name, quantity: p.quantity, threshold: p.threshold })),
        reorder: () => v.filter(p => p.quantity > 0 && p.daysLeft !== null && p.daysLeft <= 7).sort((a, b) => a.daysLeft - b.daysLeft).map(p => ({ name: p.name, quantity: p.quantity, daysLeft: p.daysLeft, suggestedOrder: Math.max(1, Math.ceil(p.velocity * 14 + p.threshold - p.quantity)), unit: p.unit })),
        expiring: () => facts.expiring,
        dead: () => v.filter(p => p.quantity > 0 && p.sold === 0 && p.stockedSince && p.stockedSince.slice(0, 10) <= facts.thirtyDaysAgo).map(p => ({ name: p.name, quantity: p.quantity, valueAtCost: Math.round(p.quantity * p.costPrice) }))
      }[filter];
      return { filter, items: (pick ? pick() : []).slice(0, 25) };
    }
  },
  {
    name: 'find_product', description: 'Look up products by name, SKU or category: current stock, selling price, cost price and 30-day sales.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    async run(ownerId, { query }) {
      const like = `%${String(query).replace(/[\\%_]/g, c => `\\${c}`)}%`;
      const [rows] = await pool.execute("SELECT name, sku, category, quantity, low_stock_threshold AS threshold, selling_price AS price, cost_price AS cost, unit FROM products WHERE owner_id = ? AND is_active = 1 AND (name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\' OR COALESCE(category, '') LIKE ? ESCAPE '\\') ORDER BY name LIMIT 8", [ownerId, like, like, like]);
      return { matches: rows.map(r => ({ ...r, quantity: Number(r.quantity), threshold: Number(r.threshold), price: Number(r.price), cost: Number(r.cost) })) };
    }
  },
  {
    name: 'customer_dues', description: 'Customers who owe money (unpaid or partly paid credit sales), largest balance first.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    async run(ownerId) {
      const [rows] = await pool.execute("SELECT c.name, c.phone, SUM(s.total_amount - s.amount_paid) AS owed, MIN(s.sale_date) AS oldest FROM sales s JOIN customers c ON c.id = s.customer_id WHERE s.owner_id = ? AND s.status = 'completed' AND s.amount_paid < s.total_amount GROUP BY c.id, c.name, c.phone ORDER BY owed DESC LIMIT 15", [ownerId]);
      return { totalOutstanding: (await receivables(ownerId)).outstanding, customers: rows.map(r => ({ name: r.name, phone: r.phone, owed: Math.round(Number(r.owed) * 100) / 100, oldestSale: String(r.oldest).slice(0, 10) })) };
    }
  },
  {
    name: 'top_customers', description: 'Best customers by spend over the last N days.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false },
    async run(ownerId, { days = 30 }) {
      const today = await databaseToday();
      return { days, customers: await topCustomers(ownerId, shiftDate(today, -(days - 1)), shiftDate(today, 1), 8) };
    }
  },
  {
    name: 'sales_forecast', description: 'Statistical estimate of sales for the next 7 days (same-weekday averages scaled by recent trend). An estimate, not a guarantee.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    async run(ownerId) { const facts = await collectBusinessFacts(ownerId); return forecastSales(facts.trend, facts.today, 7); }
  },
  {
    name: 'current_insights', description: "OpsMitra's prioritised business insights and recommendations (stock, credit, customers, margins, trends).",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    async run(ownerId) {
      const facts = await collectBusinessFacts(ownerId);
      const lowStock = facts.velocity.filter(p => p.quantity <= p.threshold).map(p => ({ id: p.id, name: p.name, sku: p.sku, quantity: p.quantity, lowStockThreshold: p.threshold }));
      const basic = buildInsights({ lowStock, salesTrend: facts.trend.slice(-14), topProducts: facts.topProducts30, summary: {} });
      return { insights: prioritizeInsights(basic, buildAdvancedInsights(facts)).slice(0, 8).map(i => ({ severity: i.severity, title: i.title, description: i.description, recommendation: i.recommendation })) };
    }
  }
];
const toolByName = new Map(TOOLS.map(t => [t.name, t]));

// ---------------------------------------------------------------- offline engine
const pct = (a, b) => b > 0 ? `${a >= b ? '+' : ''}${Math.round((a / b - 1) * 100)}%` : 'n/a';
const bullets = lines => lines.map(l => `- ${l}`).join('\n');

const renderers = {
  sales_summary: d => {
    const c = d.current, p = d.previousPeriod;
    if (!c.salesCount) return `No sales were recorded for ${d.period} yet.`;
    return `**Sales for ${d.period}:** ${inr(c.revenue)} from ${c.salesCount} sale${c.salesCount === 1 ? '' : 's'} (average ${inr(c.averageSale)}).\n${bullets([
      `Gross profit: **${inr(c.profit)}** (${c.margin}% margin)`,
      `Compared with the previous period: revenue ${pct(c.revenue, p.revenue)}, ${p.salesCount} sales before`,
      c.discount ? `Discounts given: ${inr(c.discount)}` : null].filter(Boolean))}`;
  },
  top_products: d => d.products.length ? `**Top products, last ${d.days} days:**\n${bullets(d.products.map(p => `${p.name}: ${inr(p.revenue)} · ${p.quantitySold} sold · profit ${inr(p.profit)}`))}` : 'No product sales in that period yet.',
  stock_status: d => {
    if (!d.items.length) return { out: 'Nothing is out of stock.', low: 'No products are below their threshold.', reorder: 'No product is projected to run out in the next week.', expiring: 'Nothing expires in the next 30 days.', dead: 'Every stocked product has sold recently.' }[d.filter];
    const line = {
      out: i => `${i.name} (sold ${i.soldLast30Days} in the last 30 days)`,
      low: i => `${i.name}: ${i.quantity} left (threshold ${i.threshold})`,
      reorder: i => `${i.name}: about ${i.daysLeft} day${i.daysLeft === 1 ? '' : 's'} left, suggest ordering ${i.suggestedOrder} ${i.unit || 'units'}`,
      expiring: i => `${i.name}: ${i.daysToExpiry < 0 ? `expired ${-i.daysToExpiry} days ago` : `${i.daysToExpiry} days left`}, ${i.quantity} in stock`,
      dead: i => `${i.name}: ${i.quantity} in stock (${inr(i.valueAtCost)} at cost)`
    }[d.filter];
    const title = { out: 'Out of stock', low: 'Running low', reorder: 'Restock soon', expiring: 'Expiring soon', dead: 'Not selling' }[d.filter];
    return `**${title} (${d.items.length}):**\n${bullets(d.items.slice(0, 10).map(line))}`;
  },
  find_product: d => d.matches.length ? `**Matching products:**\n${bullets(d.matches.map(p => `${p.name} (${p.sku}): ${p.quantity} ${p.unit} in stock, price ${inr(p.price)}${p.quantity <= p.threshold ? ' ⚠ low stock' : ''}`))}` : 'I could not find a product matching that.',
  customer_dues: d => d.customers.length ? `**Customers who owe you ${inr(d.totalOutstanding)} in total:**\n${bullets(d.customers.slice(0, 8).map(c => `${c.name}: ${inr(c.owed)} (since ${c.oldestSale})`))}` : 'No customer owes you anything right now.',
  top_customers: d => d.customers.length ? `**Top customers, last ${d.days} days:**\n${bullets(d.customers.map(c => `${c.name}: ${inr(c.revenue)} over ${c.count} purchase${c.count === 1 ? '' : 's'}`))}` : 'No customer purchases in that period yet.',
  sales_forecast: d => `**Estimated sales for the next 7 days: ${inr(d.total)}**\n${bullets(d.days.map(x => `${x.date}: ${inr(x.predicted)}`))}\n_This is a statistical estimate from your recent weekday pattern, not a guarantee._`,
  current_insights: d => d.insights.length ? `**What needs your attention:**\n${bullets(d.insights.slice(0, 5).map(i => `**${i.title}.** ${i.recommendation}`))}` : 'Nothing needs attention right now.'
};

function plan(question) {
  const q = question.toLowerCase();
  const range = /yesterday/.test(q) ? 'yesterday' : /last month|previous month/.test(q) ? 'last_month' : /(this )?month/.test(q) ? 'month' : /week|7 day/.test(q) ? '7d' : /30|quarter/.test(q) ? '30d' : 'today';
  const steps = [];
  if (/expir|shelf life|best before/.test(q)) steps.push(['stock_status', { filter: 'expiring' }]);
  else if (/dead|slow|not selling|stuck|unsold/.test(q)) steps.push(['stock_status', { filter: 'dead' }]);
  else if (/out of stock|sold out|finished/.test(q)) steps.push(['stock_status', { filter: 'out' }]);
  else if (/restock|re-?order|run out|running out|buy more|order more|purchase/.test(q)) { steps.push(['stock_status', { filter: 'reorder' }], ['stock_status', { filter: 'out' }]); }
  else if (/low stock|low on|stock alert|inventory/.test(q)) steps.push(['stock_status', { filter: 'low' }]);
  else if (/owe|due|credit|udhaar|outstanding|receivable|unpaid|pending payment/.test(q)) steps.push(['customer_dues', {}]);
  else if (/forecast|predict|expect|next week|tomorrow|coming days/.test(q)) steps.push(['sales_forecast', {}]);
  else if (/top|best|most/.test(q) && /customer|buyer/.test(q)) steps.push(['top_customers', { days: range === '7d' ? 7 : 30 }]);
  else if (/top|best|most|popular|sell(ing)? (the )?most|bestsell/.test(q) && /product|item|sell/.test(q)) steps.push(['top_products', { days: range === '7d' ? 7 : 30, limit: 5 }]);
  else if (/profit|margin|earn|revenue|sales|sold|turnover|income|business doing|how (is|are)/.test(q)) steps.push(['sales_summary', { range }]);
  else if (/insight|advice|suggest|recommend|should i|attention|focus|summary|overview/.test(q)) steps.push(['current_insights', {}]);
  else {
    const words = q.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !['how', 'many', 'much', 'the', 'what', 'have', 'does', 'stock', 'price', 'for', 'and', 'are', 'there', 'left', 'much', 'whats', 'many'].includes(w));
    if (words.length) steps.push(['find_product', { query: words.slice(0, 3).join(' ') }]);
  }
  return steps;
}

export async function answerOffline(ownerId, question) {
  const steps = plan(question);
  if (!steps.length) {
    return { answer: "I can answer questions about your sales, profit, stock, expiring items, customers who owe money, top products and next week's expected sales.\n\nTry: **What should I restock?**, **How were sales this week?**, **Who owes me money?** or **Which products are not selling?**", sources: [], mode: 'offline' };
  }
  const parts = []; const sources = [];
  for (const [name, input] of steps) {
    const data = await toolByName.get(name).run(ownerId, input);
    sources.push(name); parts.push(renderers[name](data));
  }
  return { answer: parts.join('\n\n'), sources, mode: 'offline' };
}

// ---------------------------------------------------------------- Claude path
let client;
/** Test hook: inject a fake Anthropic client so the tool loop can be verified without network access. */
export const setAnthropicClient = fake => { client = fake; };
export const assistantMode = () => (process.env.ANTHROPIC_API_KEY ? 'claude' : 'offline');
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';

const SYSTEM = businessName => `You are OpsMitra's business assistant for ${businessName || "a small business owner's shop"}. You help the owner understand sales, stock, customers and cash flow.
Rules:
- Every number you state must come from a tool result in this conversation. Call the tools you need; never guess or invent figures.
- Money is in Indian rupees. Write amounts like ₹12,450.
- Be concise and practical: lead with the answer, then at most 4 short bullet points of supporting detail and one clear next step when useful.
- Forecasts are statistical estimates; say so. You cannot change data, send messages or place orders; suggest the screen in OpsMitra where the owner can do it.
- If the question is not about this business, politely steer back to what you can help with.`;

export async function answerWithClaude(ownerId, question, history, businessName) {
  client ??= new Anthropic();
  const messages = [...history.slice(-8).map(m => ({ role: m.role, content: m.content })), { role: 'user', content: question }];
  const tools = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const sources = new Set();
  for (let turn = 0; turn < 6; turn++) {
    const response = await client.messages.create({
      model: MODEL(), max_tokens: 4000, system: SYSTEM(businessName), tools, messages,
      output_config: { effort: 'low' }
    });
    if (response.stop_reason === 'refusal') throw Object.assign(new Error('Model declined'), { refusal: true });
    if (response.stop_reason === 'max_tokens') throw new Error('Assistant response was cut off.');
    messages.push({ role: 'assistant', content: response.content });
    const calls = response.content.filter(b => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !calls.length) {
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      return { answer: text || 'I could not put together an answer. Please try rephrasing.', sources: [...sources], mode: 'claude' };
    }
    const results = [];
    for (const call of calls) {
      const tool = toolByName.get(call.name);
      try {
        if (!tool) throw new Error('Unknown tool');
        sources.add(call.name);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(await tool.run(ownerId, call.input || {})) });
      } catch (error) {
        results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: `Tool failed: ${error.message}` });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error('Assistant used too many steps.');
}

/** Use Claude when an API key is configured; fall back to the offline engine on any failure. */
export async function ask(ownerId, question, history = [], businessName = '') {
  if (assistantMode() === 'claude') {
    try { return await answerWithClaude(ownerId, question, history, businessName); }
    catch (error) {
      console.error('[assistant] Claude request failed, using offline engine:', error.message);
      const fallback = await answerOffline(ownerId, question);
      return { ...fallback, notice: error.refusal ? 'The AI model declined this request, so a built-in answer is shown.' : 'The AI service is unavailable right now, so a built-in answer is shown.' };
    }
  }
  return answerOffline(ownerId, question);
}
