import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Plus, Users } from 'lucide-react';
import { api, newRequestKey } from '../../lib/api.js';
import { downloadCsv } from '../../lib/csv.js';
import { useAction, useDebounced, useDocumentTitle, useList, useQueryState } from '../../lib/hooks.js';
import { initials, money, moneyRound, relativeDay } from '../../lib/format.js';
import { useToast } from '../../context/Toast.jsx';
import { Badge, Button, EmptyState, ErrorState, Field, Modal, PageHeader, Pagination, Panel, SearchInput, Select, SkeletonRows, Tabs } from '../../components/ui.jsx';

const TABS = [['all', 'All'], ['owing', 'Owes money'], ['archived', 'Archived']];

export default function Customers() {
  useDocumentTitle('Customers');
  const navigate = useNavigate();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [f, setF] = useQueryState({ q: '', status: 'all', sort: 'created', page: '1' });
  const [search, setSearch] = useState(f.q);
  const debounced = useDebounced(search);
  useEffect(() => { if (debounced !== f.q) setF({ q: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (sp.get('new') === '1') { setAdding(true); setSp(p => { p.delete('new'); return p; }, { replace: true }); } }, [sp, setSp]);
  const list = useList('customers', { q: f.q, status: f.status, sort: f.sort, page: f.page, pageSize: 25 });

  const exportCsv = async () => {
    try {
      const all = await api.page('/customers?pageSize=500');
      downloadCsv('opsmitra-customers.csv', [['Name', 'Phone', 'Email', 'Address', 'Total spent', 'Purchases', 'Balance due', 'Last purchase'], ...all.rows.map(c => [c.name, c.phone || '', c.email || '', c.address || '', c.totalSpent, c.saleCount, c.balance, c.lastPurchase || ''])]);
    } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <PageHeader title="Customers" subtitle="Who buys from you, what they spend and who owes you."
        actions={<><Button variant="secondary" icon={Download} onClick={exportCsv}>Export</Button><Button icon={Plus} onClick={() => setAdding(true)}>Add customer</Button></>} />
      <div className="toolbar">
        <Tabs tabs={TABS} value={f.status} onChange={status => setF({ status })} />
        <div className="spacer" />
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone, email…" />
        <Select label="Sort" value={f.sort} onChange={sort => setF({ sort })} options={[['created', 'Newest'], ['name', 'Name'], ['spent', 'Top spenders'], ['balance', 'Highest balance'], ['recent', 'Recent buyers']]} />
      </div>
      <Panel flush>
        {list.isPending ? <SkeletonRows /> : list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? (
          <EmptyState icon={Users} title={f.q || f.status !== 'all' ? 'No customers match' : 'No customers yet'} text={f.q || f.status !== 'all' ? 'Try another search or filter.' : 'Add customers to track their purchases and credit balances.'} action={!f.q && f.status === 'all' && <Button icon={Plus} onClick={() => setAdding(true)}>Add customer</Button>} />
        ) : (
          <>
            <div className="table-wrap" style={{ opacity: list.isFetching ? .65 : 1 }}><table className="table">
              <thead><tr><th>Customer</th><th>Contact</th><th className="right">Total spent</th><th className="right">Purchases</th><th>Last purchase</th><th className="right">Balance due</th></tr></thead>
              <tbody>{list.rows.map(c => (
                <tr key={c.id} className="row-link" onClick={() => navigate(`/app/customers/${c.id}`)}>
                  <td><div className="cell-person"><span className="avatar">{initials(c.name)}</span><span className="cell-main">{c.name}</span></div></td>
                  <td>{c.phone || '—'}<span className="cell-sub">{c.email || ''}</span></td>
                  <td className="right num">{money(c.totalSpent)}</td>
                  <td className="right num">{c.saleCount}</td>
                  <td>{c.lastPurchase ? relativeDay(c.lastPurchase) : <span className="muted">Never</span>}</td>
                  <td className="right num">{c.balance > 0 ? <Badge tone="amber" dot>{moneyRound(c.balance)}</Badge> : <span className="muted">—</span>}</td>
                </tr>))}</tbody>
            </table></div>
            <Pagination meta={list.meta} onPage={page => setF({ page })} />
          </>
        )}
      </Panel>
      <CustomerModal open={adding} onClose={() => setAdding(false)} onSaved={c => navigate(`/app/customers/${c.id}`)} />
    </>
  );
}

/** Create (no `customer`) or edit a customer. Reused by the POS for quick-add. */
export function CustomerModal({ open, onClose, customer, onSaved }) {
  const editing = Boolean(customer);
  const blank = { name: '', phone: '', email: '', address: '', notes: '' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState(null);
  const key = useRef(newRequestKey());
  useEffect(() => {
    if (!open) return;
    setError(null); key.current = newRequestKey();
    setForm(editing ? { name: customer.name, phone: customer.phone || '', email: customer.email || '', address: customer.address || '', notes: customer.notes || '' } : blank);
  }, [open, customer]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(() => (editing ? api.patch(`/customers/${customer.id}`, form) : api.post('/customers', { ...form, requestKey: key.current })),
    { invalidate: ['customers'], success: editing ? 'Customer updated.' : 'Customer added.', silentError: true, onSuccess: saved => { onSaved?.(saved); onClose(); } });
  const set = k => e => { setForm(f => ({ ...f, [k]: e.target.value })); key.current = newRequestKey(); };
  const err = field => (error?.field === field ? error.message : undefined);
  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit customer' : 'Add a customer'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="customer-form" loading={save.isPending}>{editing ? 'Save changes' : 'Add customer'}</Button></>}>
      <form id="customer-form" onSubmit={e => { e.preventDefault(); setError(null); save.mutate(undefined, { onError: setError }); }}>
        <div className="form-grid">
          <Field label="Name" required error={err('name')} className="span-2">{p => <input {...p} required minLength={2} maxLength={160} value={form.name} onChange={set('name')} placeholder="e.g. Priya Stores" />}</Field>
          <Field label="Phone" error={err('phone')}>{p => <input {...p} type="tel" maxLength={32} value={form.phone} onChange={set('phone')} placeholder="98765 43210" />}</Field>
          <Field label="Email" error={err('email')}>{p => <input {...p} type="email" maxLength={190} value={form.email} onChange={set('email')} placeholder="optional" />}</Field>
          <Field label="Address" className="span-2">{p => <input {...p} maxLength={300} value={form.address} onChange={set('address')} placeholder="optional — shown on invoices" />}</Field>
          <Field label="Notes" className="span-2">{p => <textarea {...p} maxLength={500} value={form.notes} onChange={set('notes')} rows={2} placeholder="e.g. Prefers morning delivery" />}</Field>
        </div>
        {error && !error.field && <div className="inline-error" role="alert" style={{ marginTop: 16 }}>{error.message}</div>}
      </form>
    </Modal>
  );
}
