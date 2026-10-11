import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, HandCoins, IndianRupee, Mail, MapPin, Pencil, Phone, Plus, ShoppingBag, Wallet } from 'lucide-react';
import { api } from '../../lib/api.js';
import { AFTER_TRANSACTION, useAction, useApi, useDocumentTitle } from '../../lib/hooks.js';
import { dateLabel, dateTimeLabel, money, PAYMENT_LABELS, relativeDay } from '../../lib/format.js';
import { useConfirm } from '../../context/Toast.jsx';
import { Badge, Button, ErrorState, Field, Kpi, LinkButton, Modal, PageHeader, PageLoader, Panel, StatusBadge } from '../../components/ui.jsx';
import { CustomerModal } from './Customers.jsx';

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const customer = useApi(['customers', id], `/customers/${id}`);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  useDocumentTitle(customer.data?.name || 'Customer');
  const archive = useAction(() => api.del(`/customers/${id}`), { invalidate: ['customers'], success: 'Customer archived. Their history is kept.', onSuccess: () => navigate('/app/customers') });
  const restore = useAction(() => api.patch(`/customers/${id}`, { isActive: true }), { invalidate: ['customers'], success: 'Customer restored.' });

  if (customer.isPending) return <PageLoader />;
  if (customer.error) return <ErrorState error={customer.error} onRetry={customer.refetch} title={customer.error.status === 404 ? 'Customer not found' : undefined} />;
  const c = customer.data;

  return (
    <>
      <PageHeader back="/app/customers" title={c.name} subtitle={c.isActive ? `Customer since ${dateLabel(c.createdAt)}` : 'Archived customer'}
        actions={<>
          {c.balance > 0 && <Button icon={HandCoins} onClick={() => setPaying(true)}>Record payment</Button>}
          <LinkButton to="/app/sales/new" variant="secondary" icon={Plus}>New sale</LinkButton>
          <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>
          {c.isActive ? <Button variant="danger" icon={Archive} onClick={async () => { if (await confirm({ title: `Archive ${c.name}?`, message: 'They will no longer appear when billing, but all past sales stay in your records.', confirmLabel: 'Archive', tone: 'danger' })) archive.mutate(); }}>Archive</Button>
            : <Button variant="secondary" onClick={() => restore.mutate()}>Restore</Button>}
        </>} />

      <div className="kpi-grid">
        <Kpi label="Total spent" value={money(c.totalSpent)} icon={IndianRupee} hint={`${c.saleCount} purchase${c.saleCount === 1 ? '' : 's'}`} />
        <Kpi label="Balance due" value={money(c.balance)} icon={Wallet} tone={c.balance > 0 ? 'amber' : 'green'} hint={c.balance > 0 ? 'Unpaid credit' : 'Nothing owed'} />
        <Kpi label="Last purchase" value={c.lastPurchase ? relativeDay(c.lastPurchase) : 'Never'} icon={ShoppingBag} tone="blue" hint={c.lastPurchase ? dateLabel(c.lastPurchase) : ''} />
      </div>

      <div className="grid-main">
        <div className="stack">
          <Panel title="Purchases" flush>
            {c.sales.length === 0 ? <p className="muted" style={{ padding: 20 }}>No purchases yet.</p> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Invoice</th><th>Date</th><th>Payment</th><th className="right">Total</th><th>Status</th></tr></thead>
                <tbody>{c.sales.map(s => {
                  const due = s.status === 'completed' ? Math.max(0, s.totalAmount - s.amountPaid) : 0;
                  return (
                    <tr key={s.id} className="row-link" onClick={() => navigate(`/app/sales/${s.id}`)}>
                      <td className="cell-main">{s.saleNumber}</td><td className="nowrap">{dateTimeLabel(s.saleDate)}</td><td>{PAYMENT_LABELS[s.paymentMethod]?.replace(' (pay later)', '')}</td>
                      <td className="right num">{money(s.totalAmount)}</td>
                      <td>{s.status === 'voided' ? <StatusBadge status="voided" /> : due > 0 ? <Badge tone="amber" dot>{money(due)} due</Badge> : <StatusBadge status="paid" />}</td>
                    </tr>);
                })}</tbody>
              </table></div>
            )}
          </Panel>
          {c.orders.length > 0 && (
            <Panel title="Orders">
              <div className="list">{c.orders.map(o => <Link key={o.id} to={`/app/orders/${o.id}`} className="list-row"><div><strong>{o.orderNumber}</strong><small>{dateLabel(o.orderDate)}</small></div><div className="right"><strong className="num">{money(o.totalAmount)}</strong><br /><StatusBadge status={o.status} /></div></Link>)}</div>
            </Panel>
          )}
        </div>
        <div className="stack">
          <Panel title="Contact">
            <div className="list">
              <div className="list-row"><Phone size={16} /><div><strong>{c.phone || '—'}</strong><small>Phone</small></div></div>
              <div className="list-row"><Mail size={16} /><div><strong>{c.email || '—'}</strong><small>Email</small></div></div>
              <div className="list-row"><MapPin size={16} /><div><strong style={{ whiteSpace: 'normal' }}>{c.address || '—'}</strong><small>Address</small></div></div>
            </div>
            {c.notes && <p className="inline-note" style={{ marginTop: 12 }}>{c.notes}</p>}
          </Panel>
          {c.topItems.length > 0 && <Panel title="Usually buys"><div className="list">{c.topItems.map(t => <div className="list-row" key={t.name}><div><strong>{t.name}</strong></div><span className="num muted">×{t.quantity}</span></div>)}</div></Panel>}
          <Panel title="Payments received">
            {c.payments.length === 0 ? <p className="muted">None recorded.</p> : <div className="list">{c.payments.map(p => <div className="list-row" key={p.id}><div><strong>{money(p.amount)}</strong><small>{PAYMENT_LABELS[p.method]} · {dateLabel(p.paidAt)}{p.saleNumber ? ` · ${p.saleNumber}` : ''}</small></div></div>)}</div>}
          </Panel>
        </div>
      </div>
      <CustomerModal open={editing} onClose={() => setEditing(false)} customer={c} />
      <PaymentModal open={paying} onClose={() => setPaying(false)} customerId={c.id} due={c.balance} />
    </>
  );
}

/** Record money received from a customer; allocates to one invoice or oldest dues first. */
export function PaymentModal({ open, onClose, customerId, saleId, due }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('upi');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setAmount(String(due || '')); setMethod('upi'); setNote(''); } }, [open, due]);
  const save = useAction(() => api.post(`/customers/${customerId}/payments`, { amount: Number(amount), method, note, saleId }), { invalidate: AFTER_TRANSACTION, success: `${money(Number(amount))} payment recorded.`, onSuccess: onClose });
  const invalid = !(Number(amount) > 0) || Number(amount) > due + 0.001;
  return (
    <Modal open={open} onClose={onClose} title="Record a payment" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>Record {amount ? money(Number(amount)) : 'payment'}</Button></>}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="inline-note">{saleId ? 'Outstanding on this invoice' : 'Total outstanding'}: <b>{money(due)}</b>{!saleId && ' — applied to the oldest invoices first.'}</div>
        <Field label="Amount received (₹)" error={Number(amount) > due + 0.001 ? `That is more than the ${money(due)} due.` : undefined}>{p => <input {...p} type="number" min="0.01" step="0.01" max={due} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} autoFocus />}</Field>
        <Field label="Method">{p => <select {...p} value={method} onChange={e => setMethod(e.target.value)}>{['cash', 'upi', 'card', 'bank'].map(m => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</select>}</Field>
        <Field label="Note">{p => <input {...p} maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" />}</Field>
      </div>
    </Modal>
  );
}
