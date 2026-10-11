import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Truck } from 'lucide-react';
import { api, newRequestKey } from '../../lib/api.js';
import { AFTER_TRANSACTION, useAction, useDocumentTitle, useList } from '../../lib/hooks.js';
import { isoDate, money } from '../../lib/format.js';
import { Button, Field, PageHeader, Panel } from '../../components/ui.jsx';
import { SupplierModal } from './Suppliers.jsx';

export default function NewPurchase() {
  useDocumentTitle('Receive stock');
  const navigate = useNavigate();
  const products = useList('products', { pageSize: 500, sort: 'name', dir: 'asc' });
  const suppliers = useList('suppliers', { pageSize: 500 });
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(isoDate());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ productId: '', quantity: '1', unitCost: '' }]);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [problem, setProblem] = useState('');
  const key = useRef(newRequestKey());
  const touch = () => { key.current = newRequestKey(); setProblem(''); };
  const byId = new Map(products.rows.map(p => [String(p.id), p]));
  const update = (i, patch) => { touch(); setLines(ls => ls.map((l, idx) => {
    if (idx !== i) return l;
    const next = { ...l, ...patch };
    if (patch.productId && !l.unitCost) next.unitCost = String(byId.get(patch.productId)?.costPrice || '');
    return next;
  })); };
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * Math.round((Number(l.unitCost) || 0) * 100), 0) / 100;
  const valid = lines.every(l => l.productId && Number(l.quantity) >= 1 && Number.isInteger(Number(l.quantity)) && l.unitCost !== '' && Number(l.unitCost) >= 0);
  const save = useAction(() => api.post('/purchases', { requestKey: key.current, supplierId: supplierId ? Number(supplierId) : null, purchaseDate: date, notes, items: lines.map(l => ({ productId: Number(l.productId), quantity: Number(l.quantity), unitCost: Number(l.unitCost) })) }),
    { invalidate: AFTER_TRANSACTION, silentError: true, success: r => `${r.purchaseNumber} recorded — stock updated.`, onSuccess: r => navigate(`/app/purchases/${r.id}`) });

  return (
    <>
      <PageHeader back="/app/suppliers?tab=purchases" title="Receive stock" subtitle="Record a delivery. Quantities go up and each product's cost price is updated." />
      <div className="grid-main">
        <Panel title="Items received">
          {lines.map((l, i) => {
            const p = byId.get(l.productId);
            return (
              <div className="line-editor" key={i}>
                <Field label={i === 0 ? 'Product' : <span className="sr-only">Product</span>}>{f => <select {...f} value={l.productId} onChange={e => update(i, { productId: e.target.value })}><option value="">Choose a product…</option>{products.rows.map(pr => <option key={pr.id} value={pr.id}>{pr.name} ({pr.quantity} in stock)</option>)}</select>}</Field>
                <Field label={i === 0 ? `Quantity${p ? ` (${p.unit})` : ''}` : <span className="sr-only">Quantity</span>}>{f => <input {...f} type="number" min="1" step="1" value={l.quantity} onChange={e => update(i, { quantity: e.target.value })} />}</Field>
                <Field label={i === 0 ? 'Cost each (₹)' : <span className="sr-only">Cost each</span>}>{f => <input {...f} type="number" min="0" step="0.01" inputMode="decimal" value={l.unitCost} onChange={e => update(i, { unitCost: e.target.value })} placeholder="0.00" />}</Field>
                <button className="icon-btn" onClick={() => { touch(); setLines(ls => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls)); }} disabled={lines.length === 1} aria-label={`Remove line ${i + 1}`} style={{ marginBottom: 3 }}><Trash2 size={17} /></button>
              </div>
            );
          })}
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => { touch(); setLines(ls => [...ls, { productId: '', quantity: '1', unitCost: '' }]); }}>Add another product</Button>
        </Panel>
        <Panel title="Delivery details" className="cart">
          <div className="stack" style={{ gap: 14 }}>
            <Field label="Supplier">{f => <div style={{ display: 'flex', gap: 8 }}><select {...f} value={supplierId} onChange={e => { touch(); setSupplierId(e.target.value); }}><option value="">No supplier</option>{suppliers.rows.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><Button variant="secondary" icon={Plus} onClick={() => setAddingSupplier(true)} aria-label="Add supplier" /></div>}</Field>
            <Field label="Received on">{f => <input {...f} type="date" max={isoDate()} value={date} onChange={e => { touch(); setDate(e.target.value); }} />}</Field>
            <Field label="Notes">{f => <input {...f} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Invoice no. 4471" />}</Field>
          </div>
          <div className="totals"><div className="grand"><span>Purchase total</span><span className="num">{money(total)}</span></div></div>
          {problem && <div className="inline-error" role="alert" style={{ marginBottom: 12 }}>{problem}</div>}
          <Button size="lg" className="btn-block" icon={Truck} disabled={!valid} loading={save.isPending} onClick={() => save.mutate(undefined, { onError: e => setProblem(e.message) })}>Record purchase</Button>
        </Panel>
      </div>
      <SupplierModal open={addingSupplier} onClose={() => setAddingSupplier(false)} onSaved={s => { touch(); setSupplierId(String(s.id)); }} />
    </>
  );
}
