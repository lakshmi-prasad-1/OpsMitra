import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp, Download, FileUp, MoreHorizontal, Package, PackagePlus, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api } from '../../lib/api.js';
import { downloadCsv, parseCsv } from '../../lib/csv.js';
import { useAction, useDebounced, useDocumentTitle, useList, useQueryState } from '../../lib/hooks.js';
import { dateLabel, money, number } from '../../lib/format.js';
import { useConfirm, useToast } from '../../context/Toast.jsx';
import { Badge, Button, EmptyState, ErrorState, Field, Modal, PageHeader, Pagination, Panel, Select, SearchInput, SkeletonRows, StatusBadge, Tabs } from '../../components/ui.jsx';

const STATUS_TABS = [['all', 'All'], ['attention', 'Needs restock'], ['out', 'Out of stock'], ['expiring', 'Expiring'], ['inactive', 'Inactive']];
const GST_SLABS = [0, 5, 12, 18, 28];

export function stockState(p) {
  if (p.quantity === 0) return ['out of stock', 'red'];
  if (p.quantity <= p.lowStockThreshold) return ['low stock', 'amber'];
  return ['in stock', 'green'];
}

export default function Inventory() {
  useDocumentTitle('Inventory');
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [filters, setFilters] = useQueryState({ q: '', status: 'all', category: 'all', sort: 'created', dir: 'desc', page: '1' });
  const [search, setSearch] = useState(filters.q);
  const debounced = useDebounced(search);
  useEffect(() => { if (debounced !== filters.q) setFilters({ q: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const [editing, setEditing] = useState(null); // null | 'new' | product
  const [adjusting, setAdjusting] = useState(null);
  const importing = sp.get('import') === '1';
  useEffect(() => { if (sp.get('new') === '1') { setEditing('new'); setSp(p => { p.delete('new'); return p; }, { replace: true }); } }, [sp, setSp]);

  const params = { q: filters.q, status: filters.status, category: filters.category, sort: filters.sort, dir: filters.dir, page: filters.page, pageSize: 25 };
  const list = useList('products', params);
  const categories = useQuery({ queryKey: ['products', 'categories'], queryFn: () => api.get('/products/categories') });
  const toast = useToast();
  const confirm = useConfirm();
  const remove = useAction(p => api.del(`/products/${p.id}`), { invalidate: ['products', 'dashboard', 'insights', 'notifications'], success: 'Product deactivated. Its history is kept.' });
  const restore = useAction(p => api.patch(`/products/${p.id}`, { isActive: true }), { invalidate: ['products'], success: 'Product restored.' });

  const toggleSort = key => setFilters({ sort: key, dir: filters.sort === key && filters.dir === 'asc' ? 'desc' : 'asc' });
  const exportCsv = async () => {
    try {
      const all = await api.page('/products?pageSize=500');
      downloadCsv('opsmitra-products.csv', [['Name', 'SKU', 'Category', 'Unit', 'Selling price', 'Cost price', 'GST %', 'Stock', 'Low-stock threshold', 'Expiry'], ...all.rows.map(p => [p.name, p.sku, p.category || '', p.unit, p.sellingPrice, p.costPrice, p.taxRate, p.quantity, p.lowStockThreshold, p.expiryDate || ''])]);
    } catch (e) { toast.error(e.message); }
  };
  const th = (label, key) => <th><button className="link" style={{ color: 'inherit', font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit' }} onClick={() => toggleSort(key)}>{label}{filters.sort === key ? (filters.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>;

  return (
    <>
      <PageHeader title="Inventory" subtitle="Everything you stock, with live quantities and alerts."
        actions={<><Button variant="secondary" icon={Upload} onClick={() => setSp(p => { p.set('import', '1'); return p; })}>Import CSV</Button><Button variant="secondary" icon={Download} onClick={exportCsv}>Export</Button><Button icon={Plus} onClick={() => setEditing('new')}>Add product</Button></>} />

      <div className="toolbar">
        <Tabs tabs={STATUS_TABS} value={filters.status} onChange={status => setFilters({ status })} />
        <div className="spacer" />
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, SKU, barcode…" />
        <Select label="Category" value={filters.category} onChange={category => setFilters({ category })} options={[['all', 'All'], ...(categories.data || []).map(c => [c.name, `${c.name} (${c.count})`])]} />
      </div>

      <Panel flush>
        {list.isPending ? <SkeletonRows /> : list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? (
          <EmptyState icon={Package} title={filters.q || filters.status !== 'all' || filters.category !== 'all' ? 'No products match these filters' : 'No products yet'}
            text={filters.q || filters.status !== 'all' || filters.category !== 'all' ? 'Try a different search or clear the filters.' : 'Add your first product, or import many at once from a spreadsheet.'}
            action={<div style={{ display: 'flex', gap: 8 }}><Button icon={Plus} onClick={() => setEditing('new')}>Add product</Button><Button variant="secondary" icon={FileUp} onClick={() => setSp(p => { p.set('import', '1'); return p; })}>Import CSV</Button></div>} />
        ) : (
          <>
            <div className="table-wrap" style={{ opacity: list.isFetching && !list.isPending ? .65 : 1 }}>
              <table className="table">
                <thead><tr>{th('Product', 'name')}{th('Category', 'category')}{th('Price', 'price')}<th className="right">Margin</th>{th('Stock', 'stock')}<th>Status</th><th className="right">Actions</th></tr></thead>
                <tbody>
                  {list.rows.map(p => {
                    const [label] = stockState(p);
                    const margin = p.sellingPrice > 0 && p.costPrice > 0 ? ((p.sellingPrice / (1 + p.taxRate / 100) - p.costPrice) / p.sellingPrice) * 100 : null;
                    const days = p.expiryDate ? Math.round((new Date(`${p.expiryDate}T12:00:00`) - Date.now()) / 86400000) : null;
                    return (
                      <tr key={p.id} className="row-link" onClick={() => navigate(`/app/inventory/${p.id}`)}>
                        <td><span className="cell-main">{p.name}</span><span className="cell-sub">{p.sku}{p.barcode ? ` · ${p.barcode}` : ''}</span></td>
                        <td>{p.category || <span className="muted">—</span>}</td>
                        <td className="num">{money(p.sellingPrice)}<span className="cell-sub">per {p.unit}</span></td>
                        <td className="right num">{margin == null ? <span className="muted">—</span> : <span style={{ color: margin < 8 ? 'var(--amber-fg)' : undefined }}>{margin.toFixed(0)}%</span>}</td>
                        <td className="num"><span className={`stock-bar ${p.quantity === 0 ? 'out' : p.quantity <= p.lowStockThreshold ? 'low' : ''}`}><i style={{ width: `${Math.min(100, p.quantity / Math.max(1, p.lowStockThreshold * 3) * 100)}%` }} /></span>{number(p.quantity)}</td>
                        <td>
                          {!p.isActive ? <StatusBadge status="archived" label="Inactive" /> : <StatusBadge status={label} />}
                          {p.isActive && days != null && days <= 30 && <><br /><Badge tone={days < 0 ? 'red' : 'amber'}>{days < 0 ? 'Expired' : `Expires ${dateLabel(p.expiryDate)}`}</Badge></>}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <div className="table-actions">
                            {p.isActive ? <>
                              <button className="icon-btn" title="Adjust stock" aria-label={`Adjust stock for ${p.name}`} onClick={() => setAdjusting(p)}><ArrowDownUp size={17} /></button>
                              <button className="icon-btn" title="Edit" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}><Pencil size={17} /></button>
                              <button className="icon-btn" title="Deactivate" aria-label={`Deactivate ${p.name}`} onClick={async () => { if (await confirm({ title: `Deactivate ${p.name}?`, message: 'It will disappear from sales and active inventory. Past sales and stock history are kept, and you can restore it later.', confirmLabel: 'Deactivate', tone: 'danger' })) remove.mutate(p); }}><Trash2 size={17} /></button>
                            </> : <Button size="sm" variant="secondary" onClick={() => restore.mutate(p)}>Restore</Button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination meta={list.meta} onPage={page => setFilters({ page })} />
          </>
        )}
      </Panel>

      <ProductModal product={editing} onClose={() => setEditing(null)} categories={categories.data || []} />
      <AdjustModal product={adjusting} onClose={() => setAdjusting(null)} />
      <ImportModal open={importing} onClose={() => setSp(p => { p.delete('import'); return p; })} />
    </>
  );
}

export function ProductModal({ product, onClose, categories = [], onSaved }) {
  const isNew = product === 'new';
  const open = Boolean(product);
  const blank = { name: '', sku: '', category: '', unit: 'pcs', sellingPrice: '', costPrice: '', taxRate: '0', quantity: '0', lowStockThreshold: '5', barcode: '', expiryDate: '' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(isNew ? blank : { name: product.name, sku: product.sku, category: product.category || '', unit: product.unit, sellingPrice: String(product.sellingPrice), costPrice: String(product.costPrice), taxRate: String(product.taxRate), quantity: String(product.quantity), lowStockThreshold: String(product.lowStockThreshold), barcode: product.barcode || '', expiryDate: product.expiryDate || '' });
  }, [product]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(async () => {
    const body = { name: form.name, sku: form.sku, category: form.category, unit: form.unit, sellingPrice: Number(form.sellingPrice), costPrice: Number(form.costPrice || 0), taxRate: Number(form.taxRate || 0), lowStockThreshold: Number(form.lowStockThreshold), barcode: form.barcode, expiryDate: form.expiryDate || null };
    return isNew ? api.post('/products', { ...body, quantity: Number(form.quantity || 0) }) : api.patch(`/products/${product.id}`, body);
  }, { invalidate: ['products', 'dashboard', 'insights', 'notifications'], success: isNew ? 'Product added.' : 'Product updated.', silentError: true, onSuccess: saved => { onSaved?.(saved); onClose(); } });
  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));
  const margin = Number(form.sellingPrice) > 0 && Number(form.costPrice) > 0 ? ((Number(form.sellingPrice) / (1 + Number(form.taxRate || 0) / 100) - Number(form.costPrice)) / Number(form.sellingPrice)) * 100 : null;
  const submit = e => { e.preventDefault(); setError(null); save.mutate(undefined, { onError: err => setError(err) }); };
  const err = field => (error?.field === field ? error.message : undefined);

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Add a product' : 'Edit product'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="product-form" loading={save.isPending}>{isNew ? 'Add product' : 'Save changes'}</Button></>}>
      <form id="product-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Product name" required error={err('name')} className="span-2">{p => <input {...p} required minLength={2} maxLength={180} value={form.name} onChange={set('name')} placeholder="e.g. Premium Basmati Rice 5kg" />}</Field>
          <Field label="SKU" required error={err('sku')} hint="Your own code; must be unique">{p => <input {...p} required maxLength={64} value={form.sku} onChange={set('sku')} placeholder="e.g. GRC-102" style={{ textTransform: 'uppercase' }} />}</Field>
          <Field label="Category" error={err('category')}>{p => <><input {...p} list="category-list" maxLength={100} value={form.category} onChange={set('category')} placeholder="e.g. Groceries" /><datalist id="category-list">{categories.map(c => <option key={c.name} value={c.name} />)}</datalist></>}</Field>
          <Field label="Selling price (₹)" required error={err('sellingPrice')} hint="Including GST">{p => <input {...p} required type="number" min="0" step="0.01" inputMode="decimal" value={form.sellingPrice} onChange={set('sellingPrice')} placeholder="0.00" />}</Field>
          <Field label="Cost price (₹)" error={err('costPrice')} hint={margin == null ? 'What you pay for it — enables profit reports' : `Margin after GST: ${margin.toFixed(1)}%`}>{p => <input {...p} type="number" min="0" step="0.01" inputMode="decimal" value={form.costPrice} onChange={set('costPrice')} placeholder="0.00" />}</Field>
          <Field label="GST rate (%)" error={err('taxRate')} hint="Included in the selling price">{p => <><input {...p} list="gst-list" type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={set('taxRate')} /><datalist id="gst-list">{GST_SLABS.map(s => <option key={s} value={s} />)}</datalist></>}</Field>
          <Field label="Unit" error={err('unit')}>{p => <input {...p} list="unit-list" maxLength={20} value={form.unit} onChange={set('unit')} /> }</Field>
          <datalist id="unit-list">{['pcs', 'kg', 'g', 'L', 'ml', 'pack', 'box', 'bottle', 'dozen'].map(u => <option key={u} value={u} />)}</datalist>
          {isNew
            ? <Field label="Opening stock" error={err('quantity')}>{p => <input {...p} type="number" min="0" step="1" value={form.quantity} onChange={set('quantity')} />}</Field>
            : <Field label="Current stock" hint="Use “Adjust stock” to change it so the history stays accurate">{p => <input {...p} value={form.quantity} disabled />}</Field>}
          <Field label="Low-stock alert at" error={err('lowStockThreshold')} hint="Alert when stock falls to this level">{p => <input {...p} required type="number" min="0" step="1" value={form.lowStockThreshold} onChange={set('lowStockThreshold')} />}</Field>
          <Field label="Barcode" error={err('barcode')}>{p => <input {...p} maxLength={64} value={form.barcode} onChange={set('barcode')} placeholder="Optional" />}</Field>
          <Field label="Expiry date" error={err('expiryDate')} hint="Optional — for perishables">{p => <input {...p} type="date" value={form.expiryDate} onChange={set('expiryDate')} />}</Field>
        </div>
        {error && !error.field && <div className="inline-error" role="alert" style={{ marginTop: 16 }}>{error.message}{error.code === 'SKU_INACTIVE' ? ' You can restore it from the Inactive tab.' : ''}</div>}
      </form>
    </Modal>
  );
}

const REASONS = ['Stock count correction', 'Damaged', 'Expired', 'Returned by customer', 'Lost or stolen', 'Received without a purchase entry', 'Other'];
export function AdjustModal({ product, onClose }) {
  const [mode, setMode] = useState('add');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState(REASONS[0]);
  useEffect(() => { if (product) { setMode('add'); setQty('1'); setReason(REASONS[0]); } }, [product]);
  const delta = (mode === 'add' ? 1 : -1) * Math.floor(Number(qty) || 0);
  const after = product ? product.quantity + delta : 0;
  const save = useAction(() => api.patch(`/products/${product.id}/stock`, { delta, note: reason }), { invalidate: ['products', 'dashboard', 'insights', 'notifications'], success: () => `${product.name}: stock is now ${after}.`, onSuccess: onClose });
  return (
    <Modal open={Boolean(product)} onClose={onClose} title={product ? `Adjust stock: ${product.name}` : ''} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!delta || after < 0} loading={save.isPending} onClick={() => save.mutate()}>Update stock</Button></>}>
      {product && <div className="stack" style={{ gap: 16 }}>
        <Tabs tabs={[['add', 'Add stock'], ['remove', 'Remove stock']]} value={mode} onChange={setMode} />
        <Field label="Quantity">{p => <input {...p} type="number" min="1" step="1" value={qty} onChange={e => setQty(e.target.value)} autoFocus />}</Field>
        <Field label="Reason">{p => <select {...p} value={reason} onChange={e => setReason(e.target.value)}>{REASONS.map(r => <option key={r}>{r}</option>)}</select>}</Field>
        <div className="inline-note">Current stock <b>{product.quantity}</b> → new stock <b style={{ color: after < 0 ? 'var(--danger)' : undefined }}>{after}</b> {product.unit}</div>
        {after < 0 && <div className="inline-error">You can&apos;t remove more than the {product.quantity} in stock.</div>}
        <small className="muted">To record stock you bought from a supplier, use “Receive stock” so the cost price is updated too.</small>
      </div>}
    </Modal>
  );
}

const HEADER_MAP = { name: ['name', 'product', 'product name', 'item', 'item name'], sku: ['sku', 'code', 'item code'], category: ['category', 'group'], sellingPrice: ['price', 'selling price', 'mrp', 'sale price', 'rate'], costPrice: ['cost', 'cost price', 'purchase price'], quantity: ['stock', 'quantity', 'qty', 'opening stock'], lowStockThreshold: ['threshold', 'low stock', 'low-stock threshold', 'reorder level', 'min stock'], unit: ['unit', 'uom'], taxRate: ['gst', 'gst %', 'tax', 'tax %', 'gst rate'] };
function mapRows(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { rows: [], missing: ['name', 'sku'] };
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const index = {};
  for (const [field, aliases] of Object.entries(HEADER_MAP)) index[field] = headers.findIndex(h => aliases.includes(h));
  const missing = ['name', 'sku'].filter(f => index[f] < 0);
  const out = rows.slice(1).map(r => {
    const get = f => (index[f] >= 0 ? (r[index[f]] ?? '').trim() : undefined);
    const o = {};
    for (const f of Object.keys(HEADER_MAP)) { const v = get(f); if (v !== undefined && v !== '') o[f] = ['sellingPrice', 'costPrice', 'quantity', 'lowStockThreshold', 'taxRate'].includes(f) ? Number(v.replace(/[₹,\s]/g, '')) : v; }
    return o;
  });
  return { rows: out, missing };
}
function ImportModal({ open, onClose }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  useEffect(() => { if (open) { setText(''); setResult(null); } }, [open]);
  const parsed = useMemo(() => (text ? mapRows(text) : null), [text]);
  const run = useAction(() => api.post('/products/bulk', { rows: parsed.rows.slice(0, 500) }), { invalidate: ['products', 'dashboard', 'insights'], onSuccess: r => setResult(r) });
  const onFile = async e => { const file = e.target.files?.[0]; if (file) setText(await file.text()); };
  const template = () => downloadCsv('opsmitra-product-template.csv', [['Name', 'SKU', 'Category', 'Price', 'Cost', 'Stock', 'Threshold', 'Unit', 'GST %'], ['Basmati Rice 5kg', 'RICE-5', 'Groceries', 540, 455, 40, 10, 'pack', 5]]);
  return (
    <Modal open={open} onClose={onClose} title="Import products from CSV" size="lg"
      footer={result ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Upload} disabled={!parsed || parsed.missing.length > 0 || parsed.rows.length === 0} loading={run.isPending} onClick={() => run.mutate()}>Import {parsed?.rows.length ? `${Math.min(parsed.rows.length, 500)} rows` : ''}</Button></>}>
      {result ? (
        <div className="stack" style={{ gap: 14 }}>
          <div className="inline-note"><b>{result.created}</b> product{result.created === 1 ? '' : 's'} imported{result.failed ? `, ${result.failed} skipped` : ''}.</div>
          {result.results.filter(r => r.status === 'error').length > 0 && (
            <div className="table-wrap"><table className="table"><thead><tr><th>Row</th><th>SKU</th><th>Problem</th></tr></thead><tbody>{result.results.filter(r => r.status === 'error').slice(0, 20).map(r => <tr key={r.row}><td>{r.row + 1}</td><td>{r.sku || '—'}</td><td>{r.message}</td></tr>)}</tbody></table></div>
          )}
        </div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <p className="muted">Upload a CSV with a header row. Required columns: <b>Name</b> and <b>SKU</b>. Optional: Category, Price, Cost, Stock, Threshold, Unit, GST %. Existing SKUs are skipped, never overwritten.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="file" accept=".csv,text/csv" onChange={onFile} aria-label="Choose CSV file" style={{ width: 'auto', minHeight: 0, border: 0, padding: 0 }} />
            <button className="link" onClick={template}>Download template</button>
          </div>
          <Field label="…or paste CSV text">{p => <textarea {...p} value={text} onChange={e => setText(e.target.value)} rows={5} placeholder={'Name,SKU,Price,Stock\nBasmati Rice 5kg,RICE-5,540,40'} />}</Field>
          {parsed && parsed.missing.length > 0 && <div className="inline-error">Missing required column{parsed.missing.length > 1 ? 's' : ''}: {parsed.missing.join(', ')}.</div>}
          {parsed && parsed.missing.length === 0 && (
            <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>SKU</th><th>Category</th><th className="right">Price</th><th className="right">Stock</th></tr></thead>
              <tbody>{parsed.rows.slice(0, 5).map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.sku}</td><td>{r.category || '—'}</td><td className="right">{r.sellingPrice ?? '—'}</td><td className="right">{r.quantity ?? 0}</td></tr>)}</tbody></table>
              <p className="muted" style={{ padding: '8px 16px' }}>{parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} found{parsed.rows.length > 500 ? ' (only the first 500 will be imported)' : ''}. Preview of the first 5.</p></div>
          )}
        </div>
      )}
    </Modal>
  );
}
