import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { collectBusinessFacts } from '../services/businessFacts.js';
const router = Router();
const inr = v => Number(v || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** Derived live from the data (nothing is stored); the client remembers which ids were read. */
router.get('/', asyncHandler(async (req, res) => {
  const ownerId = Number(req.user.sub);
  const facts = await collectBusinessFacts(ownerId);
  const items = [];
  const out = facts.velocity.filter(p => p.quantity === 0);
  if (out.length) items.push({ id: `out-${out.length}`, type: 'stock', severity: 'critical', title: `${out.length} product${out.length === 1 ? ' is' : 's are'} out of stock`, detail: out.slice(0, 3).map(p => p.name).join(', '), href: '/app/inventory?status=out' });
  const low = facts.velocity.filter(p => p.quantity > 0 && p.quantity <= p.threshold);
  if (low.length) items.push({ id: `low-${low.length}`, type: 'stock', severity: 'warning', title: `${low.length} product${low.length === 1 ? ' is' : 's are'} running low`, detail: low.slice(0, 3).map(p => `${p.name} (${p.quantity} left)`).join(', '), href: '/app/inventory?status=low' });
  const soon = facts.expiring.filter(p => p.daysToExpiry <= 14);
  if (soon.length) items.push({ id: `exp-${soon.length}-${soon[0].name}`, type: 'stock', severity: 'warning', title: `${soon.length} item${soon.length === 1 ? '' : 's'} expiring within 2 weeks`, detail: soon.slice(0, 3).map(p => `${p.name} (${p.daysToExpiry < 0 ? 'expired' : `${p.daysToExpiry}d`})`).join(', '), href: '/app/inventory?status=expiring' });
  if (facts.overdue.length) { const total = facts.overdue.reduce((s, c) => s + c.amount, 0); items.push({ id: `due-${facts.overdue.length}-${Math.round(total)}`, type: 'finance', severity: 'info', title: `${inr(total)} overdue from ${facts.overdue.length} customer${facts.overdue.length === 1 ? '' : 's'}`, detail: facts.overdue.slice(0, 3).map(c => c.name).join(', '), href: '/app/customers?status=owing' }); }
  if (facts.openOrders.count) items.push({ id: `ord-${facts.openOrders.count}-${facts.openOrders.oldestDays}`, type: 'orders', severity: facts.openOrders.oldestDays >= 3 ? 'warning' : 'info', title: `${facts.openOrders.count} open order${facts.openOrders.count === 1 ? '' : 's'} to process`, detail: facts.openOrders.oldestDays ? `Oldest is ${facts.openOrders.oldestDays} days old` : 'Placed recently', href: '/app/orders?status=open' });
  const rank = { critical: 0, warning: 1, info: 2 };
  items.sort((a, b) => rank[a.severity] - rank[b.severity]);
  res.json({ data: { count: items.length, items } });
}));
export default router;
