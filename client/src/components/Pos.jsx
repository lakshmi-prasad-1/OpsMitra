import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Minus, Package, Plus, Search, ShoppingCart, Trash2, UserPlus, X } from 'lucide-react';
import { api, newRequestKey } from '../lib/api.js';
import { AFTER_TRANSACTION, useAction, useList } from '../lib/hooks.js';
import { money, number, PAYMENT_LABELS } from '../lib/format.js';
import { Button, EmptyState, Field, Panel, SkeletonRows } from './ui.jsx';
import { CustomerModal } from '../pages/app/Customers.jsx';

const METHODS = ['cash', 'upi', 'card', 'bank', 'credit'];

/** Shared point-of-sale builder used for direct sales (mode="sale") and orders (mode="order"). */
export default function Pos({ mode }) {
  const isSale = mode === 'sale';
  const navigate = useNavigate();
  const products = useList('products', { pageSize: 500, sort: 'name', dir: 'asc' });
  const customers = useList('customers', { pageSize: 500, sort: 'name' });
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('All');
  const [cart, setCart] = useState([]); // [{ id, qty }]
  const [customerId, setCustomerId] = useState('');
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [discountMode, setDiscountMode] = useState('amount');
  const [discountInput, setDiscountInput] = useState('');
  const [method, setMethod] = useState('cash');
  const [paidNow, setPaidNow] = useState('');
  const [notes, setNotes] = useState('');
  const [expected, setExpected] = useState('');
  const [problem, setProblem] = useState('');
  const requestKey = useRef(newRequestKey());
  const searchRef = useRef(null);
  const touch = () => { requestKey.current = newRequestKey(); setProblem(''); };

  const byId = useMemo(() => new Map(products.rows.map(p => [p.id, p])), [products.rows]);
  const categories = useMemo(() => ['All', ...new Set(products.rows.map(p => p.category).filter(Boolean))], [products.rows]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.rows.filter(p => (category === 'All' || p.category === category) && (!needle || p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle) || (p.barcode || '').toLowerCase() === needle));
  }, [products.rows, q, category]);

  const lines = cart.map(l => ({ ...l, product: byId.get(l.id) })).filter(l => l.product);
  const subtotal = lines.reduce((s, l) => s + Math.round(l.product.sellingPrice * 100) * l.qty, 0) / 100;
  const discountValue = Math.max(0, Number(discountInput) || 0);
  const discount = Math.min(subtotal, Math.round((discountMode === 'percent' ? subtotal * Math.min(100, discountValue) / 100 : discountValue) * 100) / 100);
  const total = Math.round((subtotal - discount) * 100) / 100;
  const gst = Math.round(lines.reduce((s, l) => s + l.product.sellingPrice * l.qty * l.product.taxRate / (100 + l.product.taxRate), 0) * (subtotal ? total / subtotal : 0) * 100) / 100;
  const paid = method === 'credit' ? Math.min(total, Math.max(0, Number(paidNow) || 0)) : total;
  const due = Math.round((total - paid) * 100) / 100;
  const overStock = lines.filter(l => l.qty > l.product.quantity);

  const add = p => {
    if (isSale && p.quantity <= 0) return;
    touch();
    setCart(c => {
      const existing = c.find(l => l.id === p.id);
      if (!existing) return [...c, { id: p.id, qty: 1 }];
      if (isSale && existing.qty >= p.quantity) return c;
      return c.map(l => (l.id === p.id ? { ...l, qty: l.qty + 1 } : l));
    });
  };
  const setQty = (id, qty) => { touch(); setCart(c => c.map(l => (l.id === id ? { ...l, qty: Math.max(1, Math.floor(qty) || 1) } : l))); };
  const remove = id => { touch(); setCart(c => c.filter(l => l.id !== id)); };
  const onSearchKey = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const needle = q.trim().toLowerCase();
    const exact = products.rows.find(p => p.sku.toLowerCase() === needle || (p.barcode || '').toLowerCase() === needle);
    const pick = exact || (visible.length === 1 ? visible[0] : null);
    if (pick) { add(pick); setQ(''); }
  };

  const submit = useAction(async () => {
    const items = lines.map(l => ({ productId: l.id, quantity: l.qty }));
    if (isSale) return api.post('/sales', { requestKey: requestKey.current, items, customerId: customerId ? Number(customerId) : null, discountAmount: discount, paymentMethod: method, amountPaid: paid, notes });
    return api.post('/orders', { requestKey: requestKey.current, items, customerId: customerId ? Number(customerId) : null, notes, expectedDate: expected || undefined });
  }, {
    invalidate: AFTER_TRANSACTION, silentError: true,
    success: r => (isSale ? `Sale ${r.saleNumber} recorded for ${money(r.totalAmount)}.` : `Order ${r.orderNumber} created.`),
    onSuccess: r => navigate(isSale ? `/app/sales/${r.id}` : `/app/orders/${r.id}`)
  });
  const complete = () => {
    if (!lines.length) { setProblem('Add at least one product.'); return; }
    if (isSale && due > 0 && !customerId) { setProblem('Choose a customer to sell on credit or take a partial payment.'); return; }
    if (isSale && method === 'credit' && !customerId) { setProblem('Choose a customer to sell on credit.'); return; }
    submit.mutate(undefined, { onError: e => setProblem(e.message) });
  };

  return (
    <div className="pos">
      <Panel title="Products" subtitle={isSale ? 'Tap to add. Scan or type a SKU/barcode and press Enter.' : 'Tap to add products to this order.'}>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <label className="search" style={{ maxWidth: 'none' }}>
            <Search size={16} />
            <input ref={searchRef} type="search" autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder="Search or scan…" aria-label="Search products" />
            {q && <button type="button" onClick={() => { setQ(''); searchRef.current?.focus(); }} aria-label="Clear search"><X size={14} /></button>}
          </label>
        </div>
        {categories.length > 2 && (
          <div className="suggestions" style={{ marginTop: 12, marginBottom: 0 }}>
            {categories.map(c => <button key={c} onClick={() => setCategory(c)} style={category === c ? { borderColor: 'var(--brand)', color: 'var(--brand-strong)', background: 'var(--brand-soft)' } : undefined}>{c}</button>)}
          </div>
        )}
        {products.isPending ? <SkeletonRows rows={4} /> : products.rows.length === 0 ? (
          <EmptyState icon={Package} title="No products yet" text="Add products in Inventory first." action={<Button onClick={() => navigate('/app/inventory?new=1')}>Add a product</Button>} />
        ) : visible.length === 0 ? <p className="muted" style={{ padding: '24px 4px' }}>No products match “{q}”.</p> : (
          <div className="product-grid">
            {visible.map(p => {
              const inCart = cart.find(l => l.id === p.id)?.qty || 0;
              const out = isSale && p.quantity <= 0;
              return (
                <button key={p.id} className="product-tile" disabled={out} onClick={() => add(p)} style={inCart ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)' } : undefined}>
                  <strong>{p.name}</strong>
                  <span className="price num">{money(p.sellingPrice)}</span>
                  <small style={{ color: out ? 'var(--danger)' : p.quantity <= p.lowStockThreshold ? 'var(--amber-fg)' : undefined }}>{out ? 'Out of stock' : `${number(p.quantity)} ${p.unit} left`}{inCart ? ` · ${inCart} in cart` : ''}</small>
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title={isSale ? 'Current sale' : 'New order'} className="cart" actions={lines.length > 0 && <button className="link" onClick={() => { touch(); setCart([]); }}>Clear</button>}>
        {lines.length === 0 ? (
          <div className="state" style={{ padding: '28px 0' }}><span className="state-icon"><ShoppingCart size={22} /></span><p>Your cart is empty.<br />Pick products on the left.</p></div>
        ) : (
          <div>
            {lines.map(l => (
              <div className="cart-line" key={l.id}>
                <div><div className="name">{l.product.name}</div><small>{money(l.product.sellingPrice)} each{l.product.taxRate ? ` · GST ${l.product.taxRate}%` : ''}</small></div>
                <strong className="num right">{money(l.product.sellingPrice * l.qty)}</strong>
                <div className="qty-stepper">
                  <button onClick={() => setQty(l.id, l.qty - 1)} disabled={l.qty <= 1} aria-label={`Decrease ${l.product.name}`}><Minus size={14} /></button>
                  <input aria-label={`Quantity of ${l.product.name}`} type="number" min="1" value={l.qty} onChange={e => setQty(l.id, Number(e.target.value))} style={{ width: 58, minHeight: 30, padding: '2px 6px', textAlign: 'center' }} />
                  <button onClick={() => setQty(l.id, l.qty + 1)} disabled={isSale && l.qty >= l.product.quantity} aria-label={`Increase ${l.product.name}`}><Plus size={14} /></button>
                </div>
                <button className="icon-btn" style={{ justifySelf: 'end' }} onClick={() => remove(l.id)} aria-label={`Remove ${l.product.name}`}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
        {!isSale && overStock.length > 0 && <div className="inline-note" style={{ marginTop: 12 }}><AlertTriangle size={15} style={{ verticalAlign: -3 }} /> {overStock.map(l => l.product.name).join(', ')} exceed{overStock.length === 1 ? 's' : ''} current stock. Stock is only checked when you complete the order.</div>}

        <div className="stack" style={{ gap: 14, marginTop: 16 }}>
          <Field label={`Customer ${isSale && method !== 'credit' ? '(optional)' : ''}`}>
            {p => (
              <div style={{ display: 'flex', gap: 8 }}>
                <select {...p} value={customerId} onChange={e => { touch(); setCustomerId(e.target.value); }}>
                  <option value="">Walk-in customer</option>
                  {customers.rows.map(c => <option key={c.id} value={c.id}>{c.name}{c.balance > 0 ? ` — owes ${money(c.balance)}` : ''}</option>)}
                </select>
                <Button variant="secondary" icon={UserPlus} onClick={() => setAddingCustomer(true)} aria-label="Add customer" title="Add customer" />
              </div>
            )}
          </Field>

          {isSale && (
            <>
              <Field label="Discount">
                {p => (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input {...p} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0" value={discountInput} onChange={e => { touch(); setDiscountInput(e.target.value); }} />
                    <select aria-label="Discount type" style={{ width: 84 }} value={discountMode} onChange={e => { touch(); setDiscountMode(e.target.value); }}><option value="amount">₹</option><option value="percent">%</option></select>
                  </div>
                )}
              </Field>
              <div className="field">
                <label>Payment</label>
                <div className="pay-methods" role="group" aria-label="Payment method">
                  {METHODS.map(m => <button key={m} className={method === m ? 'active' : ''} aria-pressed={method === m} onClick={() => { touch(); setMethod(m); }}>{m === 'credit' ? 'Credit' : PAYMENT_LABELS[m].replace(' transfer', '')}</button>)}
                </div>
                {method === 'credit' && <small className="field-hint">Customer pays later. The balance is added to their account.</small>}
              </div>
              {method === 'credit' && <Field label="Paid now (optional)" hint={`Balance due: ${money(due)}`}>{p => <input {...p} type="number" min="0" step="0.01" inputMode="decimal" max={total} placeholder="0" value={paidNow} onChange={e => { touch(); setPaidNow(e.target.value); }} />}</Field>}
            </>
          )}
          {!isSale && <Field label="Expected delivery / pickup">{p => <input {...p} type="date" value={expected} onChange={e => { touch(); setExpected(e.target.value); }} />}</Field>}
          <Field label="Notes">{p => <input {...p} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />}</Field>
        </div>

        <div className="totals">
          <div><span>Subtotal</span><span className="num">{money(subtotal)}</span></div>
          {isSale && discount > 0 && <div><span>Discount</span><span className="num">−{money(discount)}</span></div>}
          {gst > 0 && <div className="muted"><span>incl. GST</span><span className="num">{money(gst)}</span></div>}
          <div className="grand"><span>{isSale ? 'Total' : 'Order total'}</span><span className="num">{money(total)}</span></div>
          {isSale && due > 0 && <div style={{ color: 'var(--amber-fg)' }}><span>Balance due</span><span className="num">{money(due)}</span></div>}
        </div>
        {problem && <div className="inline-error" role="alert" style={{ marginBottom: 12 }}>{problem}</div>}
        <Button size="lg" className="btn-block" loading={submit.isPending} disabled={!lines.length} onClick={complete}>{isSale ? `Complete sale · ${money(total)}` : 'Create order'}</Button>
        {!isSale && <small className="muted" style={{ display: 'block', marginTop: 10 }}>Stock is deducted and a sale is created when the order is marked completed.</small>}
      </Panel>
      <CustomerModal open={addingCustomer} onClose={() => setAddingCustomer(false)} onSaved={c => { touch(); setCustomerId(String(c.id)); }} />
    </div>
  );
}
