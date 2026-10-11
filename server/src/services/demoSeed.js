import { logMovement } from './stock.js';

/**
 * Builds a realistic 90-day small-business history (a kirana / provisions store) inside the caller's
 * transaction. Stock levels are derived backwards from the simulated events so the ledger, the
 * product quantities and every sale line always agree.
 */

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const dateOnly = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const cents = n => Math.round(n * 100);

// name, sku, category, price, cost, gst%, unit, popularity, state, threshold
const CATALOG = [
  ['Premium Basmati Rice 5kg', 'GRC-102', 'Groceries', 540, 455, 5, 'pack', 9, 'ok', 12],
  ['Sona Masoori Rice 10kg', 'GRC-110', 'Groceries', 690, 590, 5, 'bag', 6, 'ok', 8],
  ['Toor Dal 1kg', 'GRC-130', 'Groceries', 168, 140, 5, 'kg', 8, 'ok', 12],
  ['Moong Dal 1kg', 'GRC-131', 'Groceries', 142, 118, 5, 'kg', 5, 'ok', 10],
  ['Wheat Flour 5kg', 'FLR-014', 'Groceries', 260, 222, 0, 'pack', 8, 'ok', 10],
  ['Sugar 1kg', 'GRC-150', 'Groceries', 48, 41, 5, 'kg', 10, 'ok', 20],
  ['Iodised Salt 1kg', 'GRC-160', 'Groceries', 24, 18, 0, 'pack', 7, 'ok', 20],
  ['Sunflower Oil 1L', 'OIL-205', 'Cooking Essentials', 145, 124, 5, 'bottle', 10, 'low', 12],
  ['Groundnut Oil 1L', 'OIL-210', 'Cooking Essentials', 205, 176, 5, 'bottle', 4, 'ok', 8],
  ['Coconut Oil 500ml', 'OIL-215', 'Cooking Essentials', 118, 98, 5, 'bottle', 5, 'ok', 8],
  ['Turmeric Powder 200g', 'SPC-301', 'Cooking Essentials', 62, 46, 5, 'pack', 4, 'ok', 10],
  ['Red Chilli Powder 200g', 'SPC-302', 'Cooking Essentials', 78, 58, 5, 'pack', 4, 'ok', 10],
  ['Garam Masala 100g', 'SPC-305', 'Cooking Essentials', 85, 62, 5, 'pack', 3, 'dead', 6],
  ['Full Cream Milk 500ml', 'DRY-401', 'Dairy', 33, 29, 0, 'pack', 12, 'ok', 25],
  ['Curd 400g', 'DRY-402', 'Dairy', 38, 31, 0, 'cup', 8, 'ok', 15],
  ['Salted Butter 100g', 'DRY-410', 'Dairy', 58, 49, 12, 'pack', 4, 'expiring', 8],
  ['Paneer 200g', 'DRY-415', 'Dairy', 88, 72, 5, 'pack', 4, 'expiring', 8],
  ['Cheese Slices 10pc', 'DRY-420', 'Dairy', 132, 108, 12, 'pack', 3, 'expiring', 6],
  ['Millet Snacks Pack', 'SNK-041', 'Snacks', 65, 44, 12, 'pack', 8, 'ok', 12],
  ['Potato Chips 90g', 'SNK-050', 'Snacks', 30, 22, 12, 'pack', 11, 'ok', 25],
  ['Salted Peanuts 200g', 'SNK-055', 'Snacks', 55, 40, 12, 'pack', 5, 'ok', 10],
  ['Cream Biscuits 150g', 'SNK-060', 'Snacks', 28, 21, 18, 'pack', 9, 'ok', 20],
  ['Dark Chocolate Bar', 'SNK-070', 'Snacks', 95, 70, 18, 'bar', 3, 'dead', 8],
  ['Filter Coffee 250g', 'DRK-008', 'Beverages', 180, 138, 5, 'pack', 7, 'low', 8],
  ['Tea Powder 500g', 'DRK-012', 'Beverages', 235, 188, 5, 'pack', 6, 'ok', 10],
  ['Packaged Water 1L', 'DRK-020', 'Beverages', 20, 13, 18, 'bottle', 12, 'ok', 40],
  ['Orange Juice 1L', 'DRK-025', 'Beverages', 110, 84, 12, 'pack', 4, 'out', 8],
  ['Cola 750ml', 'DRK-030', 'Beverages', 40, 31, 28, 'bottle', 9, 'ok', 24],
  ['Bath Soap 3pc', 'PCR-501', 'Personal Care', 120, 93, 18, 'pack', 5, 'ok', 10],
  ['Shampoo Sachet 10pc', 'PCR-510', 'Personal Care', 50, 36, 18, 'pack', 4, 'ok', 10],
  ['Toothpaste 150g', 'PCR-515', 'Personal Care', 96, 74, 18, 'tube', 6, 'low', 10],
  ['Detergent Powder 1kg', 'HSE-601', 'Household', 128, 102, 18, 'pack', 6, 'ok', 10],
  ['Dishwash Liquid 500ml', 'HSE-610', 'Household', 99, 74, 18, 'bottle', 4, 'ok', 8],
  ['Floor Cleaner 1L', 'HSE-615', 'Household', 150, 112, 18, 'bottle', 2, 'dead', 6],
  ['Organic Honey 500g', 'HNY-011', 'Organic', 320, 235, 5, 'jar', 3, 'ok', 6],
  ['Organic Jaggery 1kg', 'ORG-720', 'Organic', 110, 84, 0, 'kg', 3, 'low', 6],
  ['Cold Pressed Sesame Oil 500ml', 'ORG-725', 'Organic', 260, 198, 5, 'bottle', 2, 'ok', 5]
];
const CUSTOMERS = [
  ['Priya Stores', '9876501111', 'priya@example.com', 'MG Road, Chennai', true],
  ['Ravi Kumar', '9876502222', 'ravi@example.com', 'Anna Nagar', false],
  ['Meena Traders', '9876503333', 'meena@example.com', 'T Nagar', true],
  ['Lakshmi Narayanan', '9876504444', null, 'Adyar', false],
  ['Sunrise Tiffin Centre', '9876505555', 'sunrise@example.com', 'Velachery', true],
  ['Farhan Ahmed', '9876506666', null, 'Mylapore', false],
  ['Kavitha Rajan', '9876507777', 'kavitha@example.com', 'Besant Nagar', false],
  ['Annapoorna Catering', '9876508888', 'annapoorna@example.com', 'Guindy', true],
  ['Suresh Babu', '9876509999', null, 'Tambaram', false],
  ['Deepa Menon', '9876510000', 'deepa@example.com', 'Porur', false],
  ['Gopal & Sons', '9876511111', null, 'Perambur', true],
  ['Nisha Fernandes', '9876512222', 'nisha@example.com', 'Kodambakkam', false],
  ['Hari Prasad', '9876513333', null, 'Saidapet', false],
  ['Shanti Mess', '9876514444', 'shanti@example.com', 'Egmore', true]
];
const SUPPLIERS = [
  ['Annai Wholesale Traders', '9840011111', 'orders@annai.example.com', 'Koyambedu Market, Chennai'],
  ['Sri Balaji Distributors', '9840022222', 'sales@balaji.example.com', 'Ambattur Industrial Estate'],
  ['FreshDairy Co-op', '9840033333', null, 'Madhavaram Milk Colony'],
  ['Metro Cash & Carry Agent', '9840044444', 'agent@metro.example.com', 'Sholinganallur']
];

export async function wipeWorkspace(connection, ownerId) {
  for (const sql of [
    'DELETE FROM customer_payments WHERE owner_id = ?',
    'DELETE FROM stock_movements WHERE owner_id = ?',
    'DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE owner_id = ?)',
    'DELETE FROM purchases WHERE owner_id = ?',
    'DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE owner_id = ?)',
    'DELETE FROM sales WHERE owner_id = ?',
    'DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE owner_id = ?)',
    'DELETE FROM orders WHERE owner_id = ?',
    'DELETE FROM products WHERE owner_id = ?',
    'DELETE FROM suppliers WHERE owner_id = ?',
    'DELETE FROM customers WHERE owner_id = ?'
  ]) await connection.execute(sql, [ownerId]);
}

export async function seedWorkspace(connection, ownerId, { days = 90 } = {}) {
  const rand = rng(20260);
  const pick = list => list[Math.floor(rand() * list.length)];
  const now = new Date();
  const dayStart = offset => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset); return d; };

  // --- people ---------------------------------------------------------------
  const supplierIds = [];
  for (const [name, phone, email, address] of SUPPLIERS) {
    const [r] = await connection.execute('INSERT INTO suppliers (owner_id, name, phone, email, address) VALUES (?, ?, ?, ?, ?)', [ownerId, name, phone, email, address]);
    supplierIds.push(Number(r.insertId));
  }
  const customers = [];
  for (const [name, phone, email, address, creditOk] of CUSTOMERS) {
    const [r] = await connection.execute('INSERT INTO customers (owner_id, name, phone, email, address) VALUES (?, ?, ?, ?, ?)', [ownerId, name, phone, email, address]);
    customers.push({ id: Number(r.insertId), creditOk, name });
  }

  // --- products (quantities fixed after simulation) -------------------------
  const products = [];
  for (const [name, sku, category, price, cost, tax, unit, weight, state, threshold] of CATALOG) {
    let expiry = null;
    if (state === 'expiring') expiry = dateOnly(dayStart(-(4 + Math.floor(rand() * 20))));
    const [r] = await connection.execute('INSERT INTO products (owner_id, sku, name, category, selling_price, cost_price, tax_rate, unit, expiry_date, quantity, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)', [ownerId, sku, name, category, price, cost, tax, unit, expiry, threshold]);
    products.push({ id: Number(r.insertId), name, price, cost, tax, weight, state, threshold, events: [], purchased: false });
  }
  const sellable = products.filter(p => p.weight > 0);

  // --- simulate sales -------------------------------------------------------
  const events = []; // { at: Date, kind, ... } sorted later
  const weekdayFactor = [1.45, 0.9, 0.9, 0.95, 1.0, 1.2, 1.5]; // Sun..Sat
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = dayStart(offset);
    const growth = 1 + 0.35 * ((days - 1 - offset) / (days - 1));
    const count = Math.max(2, Math.round(7 * weekdayFactor[day.getDay()] * growth * (0.8 + rand() * 0.4)));
    for (let n = 0; n < count; n++) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9 + Math.floor(rand() * 12), Math.floor(rand() * 60), Math.floor(rand() * 60));
      if (at > now) at.setTime(now.getTime() - Math.floor(rand() * 3600000));
      const lines = new Map();
      const lineCount = 1 + Math.floor(rand() * rand() * 4);
      for (let l = 0; l < lineCount; l++) {
        const total = sellable.reduce((s, p) => s + (p.state === 'dead' && offset < 50 ? 0 : p.state === 'out' && offset < 5 ? 0 : p.weight), 0);
        let roll = rand() * total, chosen = sellable[0];
        for (const p of sellable) { const w = p.state === 'dead' && offset < 50 ? 0 : p.state === 'out' && offset < 5 ? 0 : p.weight; roll -= w; if (roll <= 0) { chosen = p; break; } }
        lines.set(chosen, (lines.get(chosen) || 0) + 1 + Math.floor(rand() * rand() * 3));
      }
      const customer = rand() < 0.55 ? pick(customers) : null;
      const methodRoll = rand();
      let method = methodRoll < 0.46 ? 'cash' : methodRoll < 0.84 ? 'upi' : methodRoll < 0.95 ? 'card' : 'bank';
      let credit = false;
      if (customer?.creditOk && rand() < 0.28) { method = 'credit'; credit = true; }
      events.push({ kind: 'sale', at, lines: [...lines], customer, method, credit, discount: rand() < 0.08 ? 5 + Math.floor(rand() * 4) * 5 : 0, offset });
    }
  }

  // --- orders (recent) ------------------------------------------------------
  const orderStatuses = ['pending', 'pending', 'processing', 'processing', 'ready', 'ready', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'cancelled', 'cancelled'];
  orderStatuses.forEach((status, i) => {
    const offset = status === 'completed' ? 3 + Math.floor(rand() * 40) : status === 'cancelled' ? 2 + Math.floor(rand() * 20) : Math.floor(rand() * 4);
    const day = dayStart(offset);
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10 + Math.floor(rand() * 8), Math.floor(rand() * 60), 0);
    if (at > now) at.setTime(now.getTime() - 600000);
    const lines = new Map();
    for (let l = 0; l < 1 + Math.floor(rand() * 3); l++) { const p = pick(sellable.filter(x => x.state === 'ok' || x.state === 'expiring')); lines.set(p, (lines.get(p) || 0) + 2 + Math.floor(rand() * 8)); }
    const customer = pick(customers);
    events.push({ kind: 'order', at, lines: [...lines], customer, status, credit: status === 'completed' && customer.creditOk && rand() < 0.4, expected: dateOnly(dayStart(offset - 2)), notes: i % 4 === 0 ? 'Deliver before noon' : null, offset });
  });

  // --- purchases (restocks of healthy items) ---------------------------------
  const restockable = products.filter(p => p.state === 'ok' || p.state === 'expiring');
  for (let i = 0; i < 9; i++) {
    const offset = 6 + Math.floor((days - 12) * (i / 9)) + Math.floor(rand() * 4);
    const day = dayStart(offset);
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 8, 30 + i, 0);
    const lines = [];
    const chosen = new Set();
    while (lines.length < 3 + Math.floor(rand() * 3)) { const p = pick(restockable); if (chosen.has(p)) continue; chosen.add(p); lines.push([p, 20 + Math.floor(rand() * 40), Math.round(p.cost * (0.97 + rand() * 0.06) * 100) / 100]); }
    events.push({ kind: 'purchase', at, lines, supplier: supplierIds[i % supplierIds.length], offset });
  }
  events.sort((a, b) => a.at - b.at);
  const voidTarget = events.find(e => e.kind === 'sale' && !e.credit && e.offset >= 9 && e.offset <= 19);
  if (voidTarget) voidTarget.voided = true;

  // --- derive opening stock so the ledger ends at the designed final quantities
  const flow = new Map(products.map(p => [p, []]));
  for (const e of events) {
    if (e.kind === 'purchase') for (const [p, qty] of e.lines) flow.get(p).push({ e, change: qty });
    else if (e.kind === 'sale' || (e.kind === 'order' && e.status === 'completed')) {
      for (const [p, qty] of e.lines) flow.get(p).push({ e, change: -qty });
      if (e.voided) for (const [p, qty] of e.lines) flow.get(p).push({ e, change: qty });
    }
  }
  for (const p of products) {
    const target = p.state === 'out' ? 0 : p.state === 'low' ? Math.max(1, Math.floor(p.threshold * (0.2 + rand() * 0.6))) : p.state === 'dead' ? 18 + Math.floor(rand() * 30) : p.state === 'expiring' ? 14 + Math.floor(rand() * 10) : 30 + Math.floor(rand() * 60);
    const changes = flow.get(p);
    const net = changes.reduce((s, c) => s + c.change, 0);
    let opening = target - net;
    let running = 0, minRun = 0;
    for (const c of changes) { running += c.change; minRun = Math.min(minRun, running); }
    if (opening + minRun < 0) opening = -minRun + Math.floor(rand() * 6);
    p.opening = opening; p.final = opening + net; p.running = opening;
  }
  for (const p of products) {
    await connection.execute('UPDATE products SET quantity = ? WHERE id = ?', [p.final, p.id]);
    if (p.opening > 0) await logMovement(connection, { ownerId, productId: p.id, type: 'opening', change: p.opening, after: p.opening, note: 'Opening stock', at: stamp(dayStart(days)) });
  }

  // --- write events chronologically -----------------------------------------
  let saleSeq = 0, orderSeq = 0, purchaseSeq = 0;
  const creditSales = [];
  for (const e of events) {
    const when = stamp(e.at);
    if (e.kind === 'purchase') {
      purchaseSeq++;
      const total = e.lines.reduce((s, [, q, c]) => s + cents(q * c), 0);
      const [pr] = await connection.execute('INSERT INTO purchases (owner_id, purchase_number, supplier_id, total_amount, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?)', [ownerId, `PUR-${String(purchaseSeq).padStart(4, '0')}`, e.supplier, total / 100, when, purchaseSeq % 3 === 0 ? 'Bulk discount applied' : null]);
      for (const [p, qty, unitCost] of e.lines) {
        await connection.execute('INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, line_total) VALUES (?, ?, ?, ?, ?)', [pr.insertId, p.id, qty, unitCost, cents(qty * unitCost) / 100]);
        p.running += qty;
        await logMovement(connection, { ownerId, productId: p.id, type: 'purchase', change: qty, after: p.running, refType: 'purchase', refId: Number(pr.insertId), note: `PUR-${String(purchaseSeq).padStart(4, '0')}`, at: when });
      }
      continue;
    }
    if (e.kind === 'order') {
      orderSeq++;
      const subtotal = e.lines.reduce((s, [p, q]) => s + cents(p.price * q), 0);
      const completed = e.status === 'completed';
      const [or] = await connection.execute('INSERT INTO orders (owner_id, order_number, customer_id, status, total_amount, stock_deducted, order_date, notes, expected_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [ownerId, `ORD-${String(orderSeq).padStart(4, '0')}`, e.customer.id, e.status, subtotal / 100, completed ? 1 : 0, when, e.notes, e.expected]);
      for (const [p, q] of e.lines) await connection.execute('INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)', [or.insertId, p.id, q, p.price, cents(p.price * q) / 100]);
      if (completed) {
        const taxRaw = e.lines.reduce((s, [p, q]) => s + cents(p.price * q) * p.tax / (100 + p.tax), 0);
        const paid = e.credit ? 0 : subtotal;
        const [sr] = await connection.execute("INSERT INTO sales (owner_id, sale_number, customer_id, subtotal, discount_amount, tax_amount, total_amount, sale_date, status, payment_method, amount_paid, source_order_id) VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'completed', ?, ?, ?)", [ownerId, `ORDSALE-${or.insertId}`, e.customer.id, subtotal / 100, Math.round(taxRaw) / 100, subtotal / 100, when, e.credit ? 'credit' : 'upi', paid / 100, or.insertId]);
        for (const [p, q] of e.lines) {
          await connection.execute('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total, unit_cost, tax_rate) VALUES (?, ?, ?, ?, ?, ?, ?)', [sr.insertId, p.id, q, p.price, cents(p.price * q) / 100, p.cost, p.tax]);
          p.running -= q;
          await logMovement(connection, { ownerId, productId: p.id, type: 'order', change: -q, after: p.running, refType: 'order', refId: Number(or.insertId), note: `ORD-${String(orderSeq).padStart(4, '0')}`, at: when });
        }
        if (e.credit) creditSales.push({ id: Number(sr.insertId), customerId: e.customer.id, total: subtotal, at: e.at, offset: e.offset });
      }
      continue;
    }
    // direct sale
    saleSeq++;
    const subtotal = e.lines.reduce((s, [p, q]) => s + cents(p.price * q), 0);
    const discount = Math.min(cents(e.discount), Math.floor(subtotal / 10));
    const total = subtotal - discount;
    const taxRaw = e.lines.reduce((s, [p, q]) => s + cents(p.price * q) * p.tax / (100 + p.tax), 0) * (subtotal ? total / subtotal : 0);
    // Credit sales stay (partly) unpaid; the oldest are settled further below.
    const paid = e.credit ? (rand() < 0.3 ? Math.floor(total / 2 / 100) * 100 : 0) : total;
    const voided = Boolean(e.voided);
    const number = `INV-${String(saleSeq).padStart(4, '0')}`;
    const [sr] = await connection.execute('INSERT INTO sales (owner_id, sale_number, customer_id, subtotal, discount_amount, tax_amount, total_amount, sale_date, status, payment_method, amount_paid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [ownerId, number, e.customer?.id ?? null, subtotal / 100, discount / 100, Math.round(taxRaw) / 100, total / 100, when, voided ? 'voided' : 'completed', e.method, voided ? 0 : paid / 100]);
    for (const [p, q] of e.lines) {
      await connection.execute('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total, unit_cost, tax_rate) VALUES (?, ?, ?, ?, ?, ?, ?)', [sr.insertId, p.id, q, p.price, cents(p.price * q) / 100, p.cost, p.tax]);
      p.running -= q;
      await logMovement(connection, { ownerId, productId: p.id, type: 'sale', change: -q, after: p.running, refType: 'sale', refId: Number(sr.insertId), note: number, at: when });
      if (voided) { p.running += q; await logMovement(connection, { ownerId, productId: p.id, type: 'sale_void', change: q, after: p.running, refType: 'sale', refId: Number(sr.insertId), note: `Void ${number}`, at: when }); }
    }
    if (e.credit && !voided) creditSales.push({ id: Number(sr.insertId), customerId: e.customer.id, total, paid, at: e.at, offset: e.offset });
  }

  // Settle most older credit so only recent dues (and a few overdue ones) remain outstanding.
  for (const sale of creditSales) {
    if (sale.offset < 12 && rand() < 0.75) continue;       // recent: leave due
    if (sale.offset >= 12 && sale.offset < 35 && rand() < 0.25) continue; // a few overdue
    const [[row]] = await connection.execute('SELECT amount_paid AS paid FROM sales WHERE id = ?', [sale.id]);
    const remaining = cents(sale.total / 100) - cents(Number(row.paid));
    if (remaining <= 0) continue;
    const payAt = new Date(sale.at.getTime() + (2 + Math.floor(rand() * 9)) * 86400000);
    const settleAt = payAt > now ? now : payAt;
    await connection.execute('UPDATE sales SET amount_paid = total_amount WHERE id = ?', [sale.id]);
    await connection.execute('INSERT INTO customer_payments (owner_id, customer_id, sale_id, amount, method, note, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [ownerId, sale.customerId, sale.id, remaining / 100, pick(['cash', 'upi', 'upi']), 'Settled', stamp(settleAt)]);
  }

  const [[counts]] = await connection.execute("SELECT (SELECT COUNT(*) FROM sales WHERE owner_id = ?) AS sales, (SELECT COUNT(*) FROM orders WHERE owner_id = ?) AS orders", [ownerId, ownerId]);
  return { products: products.length, customers: customers.length, suppliers: supplierIds.length, sales: Number(counts.sales), orders: Number(counts.orders) };
}
