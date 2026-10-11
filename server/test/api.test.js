import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'opsmitra-api-test-'));
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_PATH = join(dir, 'api.sqlite');
process.env.JWT_SECRET = 'api-integration-test-secret-with-more-than-32-characters';
process.env.AUTH_MAX_ATTEMPTS = '10000';
process.env.SERVE_CLIENT = 'false';
delete process.env.ANTHROPIC_API_KEY;
const { app } = await import('../src/app.js');
const { pool } = await import('../src/db.js');

let server, base;
before(async () => { await new Promise(r => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise(r => server.close(r)); await pool.close(); rmSync(dir, { recursive: true, force: true }); });

/** Tiny cookie-aware client. */
function session() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-OpsMitra-Request': '1', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.getSetCookie?.() || [];
    const fresh = set.find(c => c.startsWith('opsmitra_session='));
    if (fresh) cookie = fresh.split(';')[0].includes('=;') || fresh.startsWith('opsmitra_session=;') ? '' : fresh.split(';')[0];
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, body: json, data: json?.data };
  };
  return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), patch: (p, b = {}) => call('PATCH', p, b), del: (p) => call('DELETE', p), cookie: () => cookie };
}
const email = () => `user-${randomUUID().slice(0, 8)}@example.com`;
async function newUser(label = 'Owner') {
  const s = session();
  const res = await s.post('/auth/register', { name: label, email: email(), password: 'correct horse battery' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return s;
}
async function addProduct(s, over = {}) {
  const res = await s.post('/products', { name: 'Test Rice', sku: `SKU-${randomUUID().slice(0, 6)}`, sellingPrice: 100, costPrice: 60, quantity: 50, lowStockThreshold: 5, ...over });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.data;
}
const sale = (s, items, extra = {}) => s.post('/sales', { requestKey: randomUUID(), items, ...extra });

test('auth: register, /me, profile, logout and session revocation', async () => {
  const s = await newUser('Asha Owner');
  const me = await s.get('/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.name, 'Asha Owner');
  const patched = await s.patch('/auth/profile', { businessName: 'Asha Stores', gstin: '33abcde1234f1z5' });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.user.businessName, 'Asha Stores');
  assert.equal(patched.data.user.gstin, '33ABCDE1234F1Z5');
  assert.equal((await s.patch('/auth/profile', { gstin: 'bad' })).status, 400);

  // A second device signs in, then "sign out everywhere" kills its cookie.
  const other = session();
  const login = await other.post('/auth/login', { email: me.data.user.email, password: 'correct horse battery' });
  assert.equal(login.status, 200);
  assert.equal((await other.get('/products')).status, 200);
  assert.equal((await s.post('/auth/logout-all')).status, 204);
  assert.equal((await other.get('/products')).status, 401);
  assert.equal((await other.get('/auth/me')).status, 401);
});

test('auth: unauthenticated requests and bad credentials are rejected', async () => {
  const anon = session();
  assert.equal((await anon.get('/products')).status, 401);
  assert.equal((await anon.post('/auth/login', { email: 'nobody@example.com', password: 'whatever123' })).status, 401);
  assert.equal((await anon.post('/auth/register', { name: 'X', email: 'bad', password: 'short' })).status, 400);
});

test('auth: password change keeps this device, drops others; reset link flow works once', async () => {
  const s = await newUser();
  const { user } = (await s.get('/auth/me')).data;
  const other = session();
  await other.post('/auth/login', { email: user.email, password: 'correct horse battery' });
  assert.equal((await s.post('/auth/change-password', { currentPassword: 'wrong password', newPassword: 'brand new password' })).status, 400);
  assert.equal((await s.post('/auth/change-password', { currentPassword: 'correct horse battery', newPassword: 'brand new password' })).status, 200);
  assert.equal((await s.get('/auth/me')).status, 200);
  assert.equal((await other.get('/auth/me')).status, 401);

  const anon = session();
  const forgot = await anon.post('/auth/forgot-password', { email: user.email });
  assert.equal(forgot.status, 200);
  const token = forgot.data.resetLink.split('/').pop();
  assert.equal((await anon.post('/auth/reset-password', { token: 'x'.repeat(64), password: 'another password 1' })).status, 400);
  assert.equal((await anon.post('/auth/reset-password', { token, password: 'another password 1' })).status, 200);
  assert.equal((await anon.post('/auth/reset-password', { token, password: 'another password 2' })).status, 400, 'link is single use');
  assert.equal((await anon.post('/auth/login', { email: user.email, password: 'another password 1' })).status, 200);
  const unknown = await anon.post('/auth/forgot-password', { email: 'nobody@example.com' });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.resetLink, undefined);
});

test('inventory: extended fields, stock ledger, SKU rules, bulk import', async () => {
  const s = await newUser();
  const p = await addProduct(s, { sku: 'ABC-1', quantity: 10, taxRate: 5, unit: 'kg', expiryDate: '2030-01-01' });
  assert.equal(p.taxRate, 5); assert.equal(p.unit, 'kg'); assert.equal(p.costPrice, 60);
  assert.equal((await s.post('/products', { name: 'Dup', sku: 'abc-1', sellingPrice: 1 })).body.error, 'SKU_EXISTS');
  assert.equal((await s.post('/products', { name: 'Bad tax', sku: 'T-1', sellingPrice: 1, taxRate: 150 })).status, 400);

  const adj = await s.patch(`/products/${p.id}/stock`, { delta: -3, note: 'Damaged in transit' });
  assert.equal(adj.data.quantity, 7);
  assert.equal((await s.patch(`/products/${p.id}/stock`, { delta: -100 })).status, 409);
  const moves = (await s.get(`/products/${p.id}/movements`)).data;
  assert.deepEqual(moves.map(m => [m.type, m.change, m.quantityAfter]), [['adjustment', -3, 7], ['opening', 10, 10]]);

  await s.del(`/products/${p.id}`);
  const clash = await s.post('/products', { name: 'Again', sku: 'ABC-1', sellingPrice: 1 });
  assert.equal(clash.body.error, 'SKU_INACTIVE');
  assert.equal(clash.body.existingId, p.id);
  assert.equal((await s.patch(`/products/${p.id}`, { isActive: true })).data.isActive, true);

  const bulk = await s.post('/products/bulk', { rows: [{ name: 'Row One', sku: 'B-1', sellingPrice: 10, quantity: 5 }, { name: 'X', sku: 'B-2' }, { name: 'Dup row', sku: 'ABC-1', sellingPrice: 1 }] });
  assert.equal(bulk.data.created, 1); assert.equal(bulk.data.failed, 2);
  const list = await s.get('/products?status=low&pageSize=5');
  assert.ok(list.body.meta.total >= 0 && list.body.meta.page === 1);
});

test('sales: discount, tax, cost snapshots, credit rules, stock ledger and void', async () => {
  const s = await newUser();
  const p = await addProduct(s, { sellingPrice: 105, costPrice: 60, taxRate: 5, quantity: 20 });
  const c = (await s.post('/customers', { requestKey: randomUUID(), name: 'Credit Customer' })).data;

  const walkInCredit = await sale(s, [{ productId: p.id, quantity: 1 }], { paymentMethod: 'credit' });
  assert.equal(walkInCredit.body.error, 'CUSTOMER_REQUIRED');
  assert.equal((await sale(s, [{ productId: p.id, quantity: 1 }], { discountAmount: 999 })).status, 400);
  assert.equal((await sale(s, [{ productId: p.id, quantity: 99 }])).status, 409);

  const ok = await sale(s, [{ productId: p.id, quantity: 4 }], { discountAmount: 20, customerId: c.id, paymentMethod: 'upi' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.data.totalAmount, 400); // 4 x 105 - 20
  const detail = (await s.get(`/sales/${ok.data.id}`)).data;
  assert.equal(detail.subtotal, 420); assert.equal(detail.discountAmount, 20);
  assert.equal(detail.paymentStatus, 'paid');
  assert.ok(Math.abs(detail.taxAmount - 19.05) < 0.02, `tax ${detail.taxAmount}`);
  assert.equal(detail.items[0].taxRate, 5);

  // Credit sale -> balance -> partial payment -> overpay rejected -> settle.
  const credit = await sale(s, [{ productId: p.id, quantity: 2 }], { customerId: c.id, paymentMethod: 'credit' });
  assert.equal(credit.status, 201);
  let customer = (await s.get(`/customers/${c.id}`)).data;
  assert.equal(customer.balance, 210); assert.equal(customer.totalSpent, 610);
  assert.equal((await s.post(`/customers/${c.id}/payments`, { amount: 500 })).status, 409);
  assert.equal((await s.post(`/customers/${c.id}/payments`, { amount: 100, method: 'upi' })).status, 201);
  customer = (await s.get(`/customers/${c.id}`)).data;
  assert.equal(customer.balance, 110);
  assert.equal((await s.get('/sales?payment=due')).body.meta.total, 1);
  assert.equal((await s.post(`/customers/${c.id}/payments`, { amount: 110 })).status, 201);
  assert.equal((await s.get(`/customers/${c.id}`)).data.balance, 0);

  // Idempotent retry returns the same sale and does not deduct stock twice.
  const key = randomUUID();
  const body = { requestKey: key, items: [{ productId: p.id, quantity: 1 }] };
  const first = await s.post('/sales', body); const retry = await s.post('/sales', body);
  assert.equal(first.status, 201); assert.equal(retry.status, 200); assert.equal(retry.data.id, first.data.id);
  assert.equal((await s.post('/sales', { ...body, items: [{ productId: p.id, quantity: 2 }] })).status, 409);

  // Void restores stock, logs it, and removes revenue.
  const before = (await s.get(`/products/${p.id}`)).data.quantity; // 20-4-2-1 = 13
  assert.equal(before, 13);
  assert.equal((await s.post(`/sales/${first.data.id}/void`)).status, 200);
  assert.equal((await s.get(`/products/${p.id}`)).data.quantity, 14);
  assert.equal((await s.post(`/sales/${first.data.id}/void`)).status, 409);
  const types = (await s.get(`/products/${p.id}/movements?pageSize=50`)).data.map(m => m.type);
  assert.deepEqual(types, ['sale_void', 'sale', 'sale', 'sale', 'opening']);
  assert.equal((await s.get('/sales?status=voided')).body.meta.total, 1);
  const health = await fetch(`${base}/api/health`);
  assert.equal((await health.json()).integrity, 'ok');
});

test('orders: completion creates a sale, ledger entries; cancellation restores everything', async () => {
  const s = await newUser();
  const p = await addProduct(s, { sellingPrice: 50, quantity: 10 });
  const c = (await s.post('/customers', { requestKey: randomUUID(), name: 'Order Customer' })).data;
  const order = await s.post('/orders', { requestKey: randomUUID(), customerId: c.id, items: [{ productId: p.id, quantity: 3 }], notes: 'Deliver early', expectedDate: '2030-05-01' });
  assert.equal(order.status, 201); assert.match(order.data.orderNumber, /^ORD-\d{4}$/);
  assert.equal((await s.get(`/products/${p.id}`)).data.quantity, 10);

  assert.equal((await s.patch(`/orders/${order.data.id}/status`, { status: 'completed', paymentMethod: 'credit' })).status, 200);
  assert.equal((await s.get(`/products/${p.id}`)).data.quantity, 7);
  const detail = (await s.get(`/orders/${order.data.id}`)).data;
  assert.equal(detail.status, 'completed'); assert.ok(detail.saleId); assert.equal(detail.notes, 'Deliver early');
  assert.equal((await s.get(`/customers/${c.id}`)).data.balance, 150, 'completed on credit leaves a balance');

  assert.equal((await s.patch(`/orders/${order.data.id}/status`, { status: 'cancelled' })).status, 200);
  assert.equal((await s.get(`/products/${p.id}`)).data.quantity, 10);
  assert.equal((await s.get(`/customers/${c.id}`)).data.balance, 0, 'voided sale no longer counts');
  assert.equal((await s.patch(`/orders/${order.data.id}/status`, { status: 'pending' })).status, 400);
  const credit = await s.post('/orders', { requestKey: randomUUID(), items: [{ productId: p.id, quantity: 1 }] });
  assert.equal((await s.patch(`/orders/${credit.data.id}/status`, { status: 'completed', paymentMethod: 'credit' })).body.error, 'CUSTOMER_REQUIRED');
  assert.equal((await s.get('/orders?status=cancelled')).body.meta.total, 1);
  assert.equal((await (await fetch(`${base}/api/health`)).json()).integrity, 'ok');
});

test('purchases and suppliers: receiving stock raises quantity, cost and ledger', async () => {
  const s = await newUser();
  const p = await addProduct(s, { quantity: 2, costPrice: 10 });
  const sup = (await s.post('/suppliers', { name: 'Metro Wholesale', phone: '999' })).data;
  const key = randomUUID();
  const res = await s.post('/purchases', { requestKey: key, supplierId: sup.id, items: [{ productId: p.id, quantity: 30, unitCost: 12.5 }] });
  assert.equal(res.status, 201); assert.equal(res.data.totalAmount, 375);
  assert.equal((await s.post('/purchases', { requestKey: key, supplierId: sup.id, items: [{ productId: p.id, quantity: 30, unitCost: 12.5 }] })).status, 200);
  const prod = (await s.get(`/products/${p.id}`)).data;
  assert.equal(prod.quantity, 32); assert.equal(prod.costPrice, 12.5);
  assert.equal((await s.get(`/suppliers/${sup.id}`)).data.totalPurchased, 375);
  assert.equal((await s.get(`/purchases/${res.data.id}`)).data.items[0].quantity, 30);
});

test('tenant isolation: another account cannot read or change records', async () => {
  const a = await newUser(); const b = await newUser();
  const p = await addProduct(a);
  const sl = (await sale(a, [{ productId: p.id, quantity: 1 }])).data;
  assert.equal((await b.get(`/products/${p.id}`)).status, 404);
  assert.equal((await b.get(`/sales/${sl.id}`)).status, 404);
  assert.equal((await b.post(`/sales/${sl.id}/void`)).status, 404);
  assert.equal((await b.patch(`/products/${p.id}/stock`, { delta: 1 })).status, 404);
  assert.equal((await sale(b, [{ productId: p.id, quantity: 1 }])).status, 404);
  assert.equal((await b.get('/products')).body.meta.total, 0);
  assert.equal((await b.get('/search?q=Test')).data.products.length, 0);
});

test('reports: today is included in top products; profit, categories and comparison add up', async () => {
  const s = await newUser();
  const p = await addProduct(s, { sellingPrice: 200, costPrice: 120, category: 'Staples', quantity: 30 });
  await sale(s, [{ productId: p.id, quantity: 3 }], { paymentMethod: 'cash' });
  const r = (await s.get('/reports?range=7d')).data;
  assert.equal(r.totals.revenue, 600); assert.equal(r.totals.profit, 240);
  assert.equal(r.topProducts[0].quantitySold, 3, "today's sale must be in top products");
  assert.equal(r.topProducts[0].profit, 240);
  assert.equal(r.categories[0].category, 'Staples');
  assert.equal(r.paymentMethods[0].method, 'cash');
  assert.equal(r.trend.length, 7); assert.equal(r.trend.at(-1).sales, 600);
  assert.equal(r.previous.revenue, 0);
  const custom = (await s.get(`/reports?from=${r.range.from}&to=${r.range.to}`)).data;
  assert.equal(custom.totals.revenue, 600);
  assert.equal((await s.get('/reports/inventory')).data.totals.units, 27);
  const exported = (await s.get('/reports/sales-export?range=7d')).data;
  assert.equal(exported.length, 1);
  const dash = (await s.get('/dashboard/summary')).data;
  assert.equal(dash.salesToday, 600); assert.equal(dash.profitThisMonth, 240);
});

test('demo workspace: seeds consistent history, passes integrity, resets, and powers insights + assistant', async () => {
  const s = session();
  const created = await s.post('/auth/demo');
  assert.equal(created.status, 201);
  assert.equal(created.data.user.isDemo, true);
  assert.equal((await (await fetch(`${base}/api/health`)).json()).integrity, 'ok');

  const dash = (await s.get('/dashboard/summary')).data;
  assert.ok(dash.totalProducts >= 30); assert.ok(dash.salesThisMonth > 0); assert.ok(dash.lowStockItems > 0);
  assert.equal(dash.trend.length, 30);

  // Every product's ledger must end exactly at its current quantity, and never go negative.
  const products = (await s.get('/products?pageSize=500')).body.data;
  for (const p of products.slice(0, 40)) {
    const moves = (await s.get(`/products/${p.id}/movements?pageSize=100`)).body;
    if (moves.meta.total <= 100) assert.equal(moves.data[0].quantityAfter, p.quantity, `${p.name} ledger tail`);
  }
  const ins = (await s.get('/insights')).data;
  assert.ok(ins.insights.length >= 5, `insights: ${ins.insights.map(i => i.id)}`);
  assert.ok(ins.insights.some(i => i.id === 'sales-trend-up' || i.id === 'month-pace' || i.id === 'weekday-pattern'));
  assert.equal(ins.forecast.days.length, 7);
  const severities = ins.insights.map(i => i.severity);
  assert.deepEqual(severities, [...severities].sort((a, b) => ['critical', 'warning', 'info', 'positive'].indexOf(a) - ['critical', 'warning', 'info', 'positive'].indexOf(b)));

  const notes = (await s.get('/notifications')).data;
  assert.ok(notes.count > 0);
  assert.equal((await s.get('/search?q=rice')).data.products.length > 0, true);

  const ask = async q => (await s.post('/assistant/ask', { question: q })).data;
  assert.equal((await s.get('/assistant/status')).data.mode, 'offline');
  assert.match((await ask('What should I restock this week?')).answer, /out of stock|Restock soon|Nothing/i);
  assert.match((await ask('Who owes me money?')).answer, /owe/i);
  assert.match((await ask('How were sales this month?')).answer, /Sales for this month/);
  assert.match((await ask('best selling products')).answer, /Top products/);
  assert.match((await ask('forecast next week')).answer, /Estimated sales/);
  assert.match((await ask('tell me a joke about cheese')).answer, /Matching|could not find|I can answer/);

  const reset = await s.post('/demo/reset');
  assert.equal(reset.status, 200);
  assert.equal((await (await fetch(`${base}/api/health`)).json()).integrity, 'ok');
  const real = await newUser();
  assert.equal((await real.post('/demo/reset')).status, 403, 'real accounts can never be wiped');
  assert.equal((await real.post('/auth/change-password', { currentPassword: 'x', newPassword: 'long enough pw' })).status, 400);
  assert.equal((await s.post('/auth/change-password', { currentPassword: 'x', newPassword: 'long enough pw' })).status, 403);
});

test('sample data loads only into empty real workspaces', async () => {
  const s = await newUser();
  assert.equal((await s.post('/demo/seed')).status, 201);
  assert.equal((await s.post('/demo/seed')).status, 409);
  assert.equal((await (await fetch(`${base}/api/health`)).json()).integrity, 'ok');
});

test('auth: /auth/session is quiet when signed out and follows revocation', async () => {
  const anon = session();
  const none = await anon.get('/auth/session');
  assert.equal(none.status, 200);
  assert.equal(none.data.user, null);
  const s = await newUser('Session Owner');
  assert.equal((await s.get('/auth/session')).data.user.name, 'Session Owner');
  const other = session();
  const { user } = (await s.get('/auth/me')).data;
  await other.post('/auth/login', { email: user.email, password: 'correct horse battery' });
  await s.post('/auth/logout-all');
  assert.equal((await other.get('/auth/session')).data.user, null, 'revoked sessions look signed out');
});

test('web app pages get a strict CSP, API responses stay JSON-only', async () => {
  const api = await fetch(`${base}/api/health`);
  assert.equal(api.headers.get('content-security-policy'), null);
  assert.equal(api.headers.get('x-frame-options'), 'DENY');
  assert.equal((await fetch(`${base}/api/does-not-exist`)).status, 401, 'unknown API paths are not probeable without a session');
  const s = await newUser();
  assert.equal((await s.get('/does-not-exist')).status, 404);
});

test('search treats % and _ literally and cannot be used to dump every record', async () => {
  const s = await newUser();
  await addProduct(s, { name: '50% Off Soap', sku: 'SOAP-50' });
  await addProduct(s, { name: 'Plain Rice', sku: 'RICE-1' });
  await addProduct(s, { name: 'Under_score Tea', sku: 'TEA-1' });
  const names = async q => (await s.get(`/products?q=${encodeURIComponent(q)}`)).data.map(p => p.name);
  assert.deepEqual(await names('50%'), ['50% Off Soap']);
  assert.deepEqual(await names('%'), ['50% Off Soap'], 'a lone % is a literal, not "match everything"');
  assert.deepEqual(await names('_'), ['Under_score Tea']);
  assert.deepEqual(await names('rice'), ['Plain Rice']);
  const palette = await s.get(`/search?q=${encodeURIComponent('%%')}`);
  assert.equal(palette.data.products.length, 0);
});
