import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights } from '../src/services/insightRules.js';

test('flags products at or below their threshold with grounded evidence', () => {
  const insights = buildInsights({ lowStock: [{ id: 1, name: 'Rice', quantity: 2, lowStockThreshold: 5 }], summary: { totalProducts: 1 } });
  assert.equal(insights[0].id, 'low-stock');
  assert.match(insights[0].title, /1 product/);
  assert.match(insights[0].description, /Rice/);
  assert.equal(insights[0].evidence[0].value, '2 left · threshold 5');
});

test('compares recent sales periods and explains the calculation direction', () => {
  const insights = buildInsights({
    salesTrend: Array.from({length:14}, (_,i) => ({sales:i<7?100:160})),
    summary: {}
  });
  assert.ok(insights.some(i => i.id === 'sales-trend-up'));
});

test('reports a top product using recorded units and revenue', () => {
  const insights = buildInsights({ topProducts: [{ name: 'Honey', sku: 'H-1', quantitySold: 4, revenue: 400 }] });
  const top = insights.find(i => i.id === 'top-product');
  assert.ok(top);
  assert.match(top.description, /Honey/);
  assert.equal(top.evidence[0].value, 4);
  assert.equal(top.evidence[1].value, 400);
});

test('returns a getting-started recommendation when there are no signals yet', () => {
  const insights = buildInsights({ summary: { totalProducts: 0, salesToday: 0 } });
  assert.equal(insights.length, 1);
  assert.equal(insights[0].id, 'getting-started');
  assert.match(insights[0].recommendation, /Add your current inventory/);
});

test('does not create a sales trend recommendation without two meaningful periods', () => {
  const insights = buildInsights({ salesTrend: Array.from({length:14}, (_,i) => ({sales:i<7?0:5})) });
  assert.ok(!insights.some(i => i.id.startsWith('sales-trend-')));
});
