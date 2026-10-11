/**
 * Browser end-to-end smoke test: drives the real app (demo login, every route, POS, inventory, credit,
 * orders, assistant, auth flows, dark mode, mobile layout) and fails on any broken step.
 * Run with `npm run test:e2e` (starts its own server on a throwaway database).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:4100';
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const results = [];
const errors = [];

async function newContext(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, ...opts });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${page.url()} :: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${page.url()} :: ${e.message}`));
  page.on('response', r => { if (r.status() >= 500) errors.push(`[http ${r.status()}] ${r.url()}`); });
  return { ctx, page };
}
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', `${name} :: ${e.message.split('\n')[0]}`]); }
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: false });

// ---------------------------------------------------------------- landing + demo
let { ctx, page } = await newContext();
await step('landing renders', async () => {
  await page.goto(BASE + '/');
  await page.getByRole('heading', { level: 1 }).waitFor();
  await shot(page, '01-landing');
});
await step('guard: /app redirects to login with next', async () => {
  await page.goto(BASE + '/app/sales');
  await page.waitForURL(/\/login\?next=%2Fapp%2Fsales/);
  await shot(page, '02-login');
});
await step('demo login lands on dashboard', async () => {
  await page.getByRole('button', { name: /Try the live demo/ }).click();
  await page.waitForURL(/\/app\/sales$/); // returns to the page the visitor asked for
  await page.getByRole('heading', { name: 'Sales', exact: true }).waitFor();
  await page.goto(BASE + '/app');
  await page.getByText('Sales today').waitFor();
  await page.getByText('Needs your attention').waitFor();
  await page.waitForTimeout(800);
  await shot(page, '03-dashboard');
});
await step('deep link survives refresh', async () => {
  await page.goto(BASE + '/app/inventory?status=attention');
  await page.getByRole('heading', { name: 'Inventory' }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Inventory' }).waitFor();
  if (!page.url().includes('status=attention')) throw new Error('filter lost on reload');
  await page.waitForTimeout(500);
  await shot(page, '04-inventory-low');
});

const routes = [
  ['/app/inventory', 'Inventory'], ['/app/sales', 'Sales'], ['/app/sales/new', 'New sale'], ['/app/orders', 'Orders'], ['/app/orders/new', 'New order'],
  ['/app/customers', 'Customers'], ['/app/suppliers', 'Suppliers & purchases'], ['/app/suppliers?tab=purchases', 'Suppliers & purchases'], ['/app/purchases/new', 'Receive stock'],
  ['/app/reports', 'Reports'], ['/app/reports?view=tax', 'Reports'], ['/app/reports?view=inventory', 'Reports'], ['/app/insights', 'Insights'], ['/app/assistant', 'Ask OpsMitra'],
  ['/app/settings/profile', 'Settings'], ['/app/settings/business', 'Settings'], ['/app/settings/security', 'Settings'], ['/app/settings/appearance', 'Settings'], ['/app/settings/about', 'Settings'], ['/app/help', 'Help & support']
];
for (const [path, heading] of routes) {
  await step(`route ${path}`, async () => {
    await page.goto(BASE + path);
    await page.getByRole('heading', { name: heading, exact: true }).first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
    if (['/app/sales/new', '/app/reports', '/app/insights', '/app/inventory', '/app/customers', '/app/orders', '/app/assistant', '/app/reports?view=tax', '/app/settings/business'].includes(path)) await shot(page, `05-${path.replaceAll(/[/?=]/g, '_')}`);
  });
}

// ---------------------------------------------------------------- detail pages by clicking through
await step('inventory -> product detail', async () => {
  await page.goto(BASE + '/app/inventory');
  await page.locator('tbody tr').first().click();
  await page.getByText('Stock history').waitFor();
  await page.waitForTimeout(400);
  await shot(page, '06-product');
});
await step('sales -> invoice', async () => {
  await page.goto(BASE + '/app/sales');
  await page.locator('tbody tr').first().click();
  await page.getByText('Billed to').waitFor();
  await shot(page, '07-invoice');
});
await step('customers -> detail', async () => {
  await page.goto(BASE + '/app/customers?status=owing');
  await page.locator('tbody tr').first().click();
  await page.getByText('Purchases', { exact: true }).first().waitFor();
  await shot(page, '08-customer');
});
await step('orders -> detail', async () => {
  await page.goto(BASE + '/app/orders?status=open');
  await page.locator('tbody tr').first().click();
  await page.getByText('Items', { exact: true }).first().waitFor();
  await shot(page, '09-order');
});
await step('supplier + purchase detail', async () => {
  await page.goto(BASE + '/app/suppliers');
  await page.locator('tbody tr').first().click();
  await page.getByText('Total bought').waitFor();
  await page.locator('tbody tr').first().click();
  await page.getByText('Cost each').waitFor();
});

// ---------------------------------------------------------------- functional flows
await step('POS: add items, credit sale needs customer, complete cash sale', async () => {
  await page.goto(BASE + '/app/sales/new');
  const tiles = page.locator('.product-tile:not([disabled])');
  await tiles.nth(0).click(); await tiles.nth(0).click(); await tiles.nth(2).click();
  await page.getByRole('button', { name: 'Credit', exact: true }).click();
  await page.getByRole('button', { name: /Complete sale/ }).click();
  await page.getByText(/Choose a customer to sell on credit/).waitFor();
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await page.getByLabel('Discount type').selectOption('percent');
  await page.getByPlaceholder('0').first().fill('5');
  await shot(page, '10-pos-cart');
  await page.getByRole('button', { name: /Complete sale/ }).click();
  await page.waitForURL(/\/app\/sales\/\d+$/);
  await page.getByText(/^INV-\d{4}$/).first().waitFor();
});
await step('record payment on credit invoice via customer page', async () => {
  await page.goto(BASE + '/app/customers?status=owing');
  await page.locator('tbody tr').first().click();
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByRole('button', { name: /^Record ₹/ }).click();
  await page.getByText(/payment recorded/).waitFor();
});
await step('add product modal + validation + SKU conflict', async () => {
  await page.goto(BASE + '/app/inventory?new=1');
  await page.getByRole('dialog').waitFor();
  await page.getByLabel(/Product name/).fill('E2E Test Biscuits');
  await page.getByLabel(/^SKU/).fill('E2E-1');
  await page.getByLabel(/Selling price/).fill('30');
  await page.getByLabel(/Cost price/).fill('20');
  await page.getByLabel('Opening stock').fill('12');
  await page.getByRole('dialog').getByRole('button', { name: 'Add product' }).click();
  await page.getByText('Product added.').waitFor();
  await page.getByPlaceholder(/Search name, SKU/).fill('E2E');
  await page.getByText('E2E Test Biscuits').first().waitFor();
  await page.getByRole('button', { name: 'Add product' }).first().click();
  await page.getByLabel(/Product name/).fill('Dup');
  await page.getByLabel(/^SKU/).fill('e2e-1');
  await page.getByLabel(/Selling price/).fill('5');
  await page.getByRole('dialog').getByRole('button', { name: 'Add product' }).click();
  await page.getByText(/already exists/).waitFor();
  await shot(page, '11-sku-conflict');
});
await step('adjust stock modal updates quantity', async () => {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Adjust stock for E2E Test Biscuits/ }).click();
  await page.getByRole('tab', { name: 'Remove stock' }).click();
  await page.getByLabel('Quantity').fill('2');
  await page.getByRole('button', { name: 'Update stock' }).click();
  await page.getByText(/stock is now 10/).waitFor();
});
await step('CSV import', async () => {
  await page.goto(BASE + '/app/inventory?import=1');
  await page.getByLabel('…or paste CSV text').fill('Name,SKU,Price,Stock\nCSV Item A,CSV-A,10,5\nCSV Item B,CSV-B,20,6\nE2E dup,E2E-1,1,1');
  await page.getByText('3 rows found').waitFor();
  await page.getByRole('button', { name: /Import 3 rows/ }).click();
  await page.getByText(/2 products imported, 1 skipped/).waitFor();
  await shot(page, '12-import');
});
await step('command palette search and navigate', async () => {
  await page.goto(BASE + '/app');
  await page.getByText('Sales today').waitFor();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/Search products/).fill('basmati');
  await page.locator('.palette-item', { hasText: 'Basmati' }).first().waitFor();
  await shot(page, '13-palette');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/app\/inventory\/\d+/);
});
await step('notifications bell opens and navigates', async () => {
  await page.goto(BASE + '/app');
  await page.getByRole('button', { name: /Notifications/ }).click();
  await page.locator('.dropdown-item').first().waitFor();
  await shot(page, '14-notifications');
  await page.locator('.dropdown-item').first().click();
  await page.waitForURL(/\/app\/(inventory|customers|orders)/);
});
await step('assistant answers a question', async () => {
  await page.goto(BASE + '/app/assistant');
  await page.getByRole('button', { name: 'Who owes me money?' }).click();
  await page.getByText(/Customers who owe you/).waitFor();
  await page.getByLabel('Your question').fill('what should I restock?');
  await page.getByLabel('Your question').press('Enter');
  await page.getByText(/Restock soon|out of stock/i).first().waitFor();
  await shot(page, '15-assistant');
});
await step('order: advance to completed with payment method', async () => {
  await page.goto(BASE + '/app/orders?status=pending');
  await page.locator('tbody tr').first().click();
  await page.getByRole('button', { name: 'Start processing' }).click();
  await page.getByRole('button', { name: 'Mark ready' }).click();
  await page.getByRole('button', { name: 'Complete order' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Complete ·/ }).click();
  await page.getByText(/Order marked completed/).waitFor();
});
await step('theme toggle to dark persists', async () => {
  await page.goto(BASE + '/app/settings/appearance');
  await page.getByRole('button', { name: 'Dark' }).click();
  if ((await page.locator('html').getAttribute('data-theme')) !== 'dark') throw new Error('theme attr not set');
  await page.reload();
  if ((await page.locator('html').getAttribute('data-theme')) !== 'dark') throw new Error('theme not persisted');
  await page.goto(BASE + '/app'); await page.getByText('Sales today').waitFor(); await page.waitForTimeout(600);
  await shot(page, '16-dashboard-dark');
});
await step('revoked session sends the user to sign-in with a return path', async () => {
  // Simulate "signed out everywhere" from another device, then keep using the open app.
  await page.goto(BASE + '/app');
  await page.getByText('Sales today').waitFor();
  await page.evaluate(async () => { const r = await fetch('/api/auth/logout-all', { method: 'POST', headers: { 'X-OpsMitra-Request': '1' }, credentials: 'include' }); if (r.status !== 204) throw new Error(`logout-all returned ${r.status}`); });
  await page.getByRole('link', { name: 'Inventory' }).first().click();
  await page.waitForURL(/\/login/, { timeout: 8000 });
  // Sign back in with a fresh demo workspace so later steps keep working.
  await page.getByRole('button', { name: /Try the live demo/ }).click();
  await page.waitForURL(/\/app\/inventory/);
});
await step('unknown app route shows 404 inside layout', async () => {
  await page.goto(BASE + '/app/nope');
  await page.getByText("We couldn't find that page").waitFor();
});
await step('sign out returns to landing; protected route redirects', async () => {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: /Sign out/ }).click();
  await page.waitForURL(BASE + '/');
  await page.goto(BASE + '/app');
  await page.waitForURL(/\/login/);
});
await ctx.close();

// ---------------------------------------------------------------- register + password flows
({ ctx, page } = await newContext());
const email = `e2e-${Date.now()}@example.com`;
await step('register new account -> empty dashboard with getting-started', async () => {
  await page.goto(BASE + '/register');
  await page.getByLabel(/Your name/).fill('Test Owner');
  await page.getByLabel('Business name').fill('Test Traders');
  await page.getByLabel(/Email address/).fill(email);
  await page.getByLabel(/^Password/).fill('a-long-password-1');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL(/\/app$/);
  await page.getByText("Let's get you started").waitFor();
  await shot(page, '17-empty-dashboard');
});
await step('load sample data from getting-started', async () => {
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await page.getByText(/Sample business loaded/).waitFor();
  await page.getByText('Sales today').waitFor();
});
await step('change password then sign in again', async () => {
  await page.goto(BASE + '/app/settings/security');
  await page.getByLabel('Current password').fill('a-long-password-1');
  await page.getByLabel('New password', { exact: true }).fill('another-long-password-2');
  await page.getByLabel('Confirm new password').fill('another-long-password-2');
  await page.getByRole('button', { name: 'Update password' }).click();
  await page.getByText(/Password changed/).waitFor();
});
await step('forgot password -> reset link -> login with new password', async () => {
  await page.context().clearCookies();
  await page.goto(BASE + '/forgot-password');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await page.getByRole('link', { name: /Open your reset link/ }).click();
  await page.getByLabel('New password', { exact: true }).fill('third-long-password-3');
  await page.getByLabel('Confirm new password').fill('third-long-password-3');
  await page.getByRole('button', { name: 'Update password' }).click();
  await page.waitForURL(/\/login/, { timeout: 8000 });
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('third-long-password-3');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app$/);
});
await ctx.close();

// ---------------------------------------------------------------- mobile
({ ctx, page } = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }));
await step('mobile: landing, demo, drawer nav, POS', async () => {
  await page.goto(BASE + '/');
  await shot(page, '20-m-landing');
  await page.getByRole('button', { name: /Try the live demo/ }).first().click();
  await page.waitForURL(/\/app$/);
  await page.getByText('Sales today').waitFor();
  await page.waitForTimeout(600);
  await shot(page, '21-m-dashboard');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.waitForTimeout(300);
  await shot(page, '22-m-drawer');
  await page.getByRole('link', { name: 'Sales' }).first().click();
  await page.getByRole('heading', { name: 'Sales', exact: true }).waitFor();
  await page.waitForTimeout(400);
  await shot(page, '23-m-sales');
  await page.goto(BASE + '/app/sales/new');
  await page.locator('.product-tile').first().click();
  await shot(page, '24-m-pos');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error('horizontal overflow on mobile POS');
});
for (const p of ['/app', '/app/inventory', '/app/reports', '/app/insights', '/app/customers']) {
  await step(`mobile no horizontal overflow ${p}`, async () => {
    await page.goto(BASE + p); await page.waitForTimeout(900);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 1) throw new Error(`page is ${wide}px wider than the viewport`);
  });
}
await ctx.close();
await browser.close();

console.log('\n' + results.map(r => `${r[0]}  ${r[1]}`).join('\n'));
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} steps passed`);
const uniq = [...new Set(errors)];
console.log(uniq.length ? `\nBrowser errors (${uniq.length}):\n` + uniq.slice(0, 25).join('\n') : '\nNo browser console/page errors.');
process.exit(failed ? 1 : 0);
