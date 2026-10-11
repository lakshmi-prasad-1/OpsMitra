import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Truck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAction, useDebounced, useDocumentTitle, useList, useQueryState } from '../../lib/hooks.js';
import { dateLabel, money, relativeDay } from '../../lib/format.js';
import { Button, EmptyState, ErrorState, Field, LinkButton, Modal, PageHeader, Pagination, Panel, SearchInput, SkeletonRows, Tabs } from '../../components/ui.jsx';

export default function Suppliers() {
  useDocumentTitle('Suppliers');
  const navigate = useNavigate();
  const [f, setF] = useQueryState({ tab: 'suppliers', q: '', page: '1' });
  const [search, setSearch] = useState(f.q);
  const debounced = useDebounced(search);
  useEffect(() => { if (debounced !== f.q) setF({ q: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const [adding, setAdding] = useState(false);
  const suppliers = useList('suppliers', { q: f.q, page: f.page, pageSize: 25 }, { enabled: f.tab === 'suppliers' });
  const purchases = useList('purchases', { q: f.q, page: f.page, pageSize: 25 }, { enabled: f.tab === 'purchases' });
  const list = f.tab === 'suppliers' ? suppliers : purchases;

  return (
    <>
      <PageHeader title="Suppliers & purchases" subtitle="Who you buy from, and every delivery of stock you receive."
        actions={<><Button variant="secondary" icon={Plus} onClick={() => setAdding(true)}>Add supplier</Button><LinkButton to="/app/purchases/new" icon={Truck}>Receive stock</LinkButton></>} />
      <div className="toolbar">
        <Tabs tabs={[['suppliers', 'Suppliers'], ['purchases', 'Purchases']]} value={f.tab} onChange={tab => { setSearch(''); setF({ tab, q: '' }); }} />
        <div className="spacer" />
        <SearchInput value={search} onChange={setSearch} placeholder={f.tab === 'suppliers' ? 'Search suppliers…' : 'Search purchase or supplier…'} />
      </div>
      <Panel flush>
        {list.isPending ? <SkeletonRows /> : list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? (
          <EmptyState icon={Truck} title={f.tab === 'suppliers' ? 'No suppliers yet' : 'No purchases yet'} text={f.tab === 'suppliers' ? 'Add the wholesalers and distributors you buy from.' : 'Record stock you receive so quantities and costs stay accurate.'}
            action={f.tab === 'suppliers' ? <Button icon={Plus} onClick={() => setAdding(true)}>Add supplier</Button> : <LinkButton to="/app/purchases/new" icon={Truck}>Receive stock</LinkButton>} />
        ) : (
          <>
            <div className="table-wrap" style={{ opacity: list.isFetching ? .65 : 1 }}>
              {f.tab === 'suppliers' ? (
                <table className="table"><thead><tr><th>Supplier</th><th>Contact</th><th className="right">Purchases</th><th className="right">Total bought</th><th>Last delivery</th></tr></thead>
                  <tbody>{suppliers.rows.map(s => (
                    <tr key={s.id} className="row-link" onClick={() => navigate(`/app/suppliers/${s.id}`)}>
                      <td className="cell-main">{s.name}</td><td>{s.phone || '—'}<span className="cell-sub">{s.email || ''}</span></td>
                      <td className="right num">{s.purchaseCount}</td><td className="right num">{money(s.totalPurchased)}</td><td>{s.lastPurchase ? relativeDay(s.lastPurchase) : <span className="muted">—</span>}</td>
                    </tr>))}</tbody></table>
              ) : (
                <table className="table"><thead><tr><th>Purchase</th><th>Date</th><th>Supplier</th><th className="right">Items</th><th className="right">Total</th></tr></thead>
                  <tbody>{purchases.rows.map(p => (
                    <tr key={p.id} className="row-link" onClick={() => navigate(`/app/purchases/${p.id}`)}>
                      <td className="cell-main">{p.purchaseNumber}</td><td className="nowrap">{dateLabel(p.purchaseDate)}</td><td>{p.supplierName || <span className="muted">No supplier</span>}</td>
                      <td className="right num">{p.lineCount}</td><td className="right num"><b>{money(p.totalAmount)}</b></td>
                    </tr>))}</tbody></table>
              )}
            </div>
            <Pagination meta={list.meta} onPage={page => setF({ page })} />
          </>
        )}
      </Panel>
      <SupplierModal open={adding} onClose={() => setAdding(false)} onSaved={s => navigate(`/app/suppliers/${s.id}`)} />
    </>
  );
}

export function SupplierModal({ open, onClose, supplier, onSaved }) {
  const editing = Boolean(supplier);
  const blank = { name: '', phone: '', email: '', address: '', notes: '' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setError(null); setForm(editing ? { name: supplier.name, phone: supplier.phone || '', email: supplier.email || '', address: supplier.address || '', notes: supplier.notes || '' } : blank); } }, [open, supplier]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(() => (editing ? api.patch(`/suppliers/${supplier.id}`, form) : api.post('/suppliers', form)), { invalidate: ['suppliers'], success: editing ? 'Supplier updated.' : 'Supplier added.', silentError: true, onSuccess: s => { onSaved?.(s); onClose(); } });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const err = field => (error?.field === field ? error.message : undefined);
  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit supplier' : 'Add a supplier'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="supplier-form" loading={save.isPending}>{editing ? 'Save changes' : 'Add supplier'}</Button></>}>
      <form id="supplier-form" onSubmit={e => { e.preventDefault(); setError(null); save.mutate(undefined, { onError: setError }); }}>
        <div className="form-grid">
          <Field label="Supplier name" required error={err('name')} className="span-2">{p => <input {...p} required minLength={2} maxLength={160} value={form.name} onChange={set('name')} placeholder="e.g. Annai Wholesale Traders" />}</Field>
          <Field label="Phone" error={err('phone')}>{p => <input {...p} type="tel" maxLength={32} value={form.phone} onChange={set('phone')} />}</Field>
          <Field label="Email" error={err('email')}>{p => <input {...p} type="email" maxLength={190} value={form.email} onChange={set('email')} />}</Field>
          <Field label="Address" className="span-2">{p => <input {...p} maxLength={300} value={form.address} onChange={set('address')} />}</Field>
          <Field label="Notes" className="span-2">{p => <textarea {...p} rows={2} maxLength={500} value={form.notes} onChange={set('notes')} placeholder="e.g. Delivers on Tuesdays, 30-day credit" />}</Field>
        </div>
        {error && !error.field && <div className="inline-error" role="alert" style={{ marginTop: 16 }}>{error.message}</div>}
      </form>
    </Modal>
  );
}
