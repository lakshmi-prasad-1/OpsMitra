import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Ban, Check, CheckCircle2, Circle, Receipt } from 'lucide-react';
import { api } from '../../lib/api.js';
import { AFTER_TRANSACTION, useAction, useApi, useDocumentTitle } from '../../lib/hooks.js';
import { dateLabel, dateTimeLabel, money, PAYMENT_LABELS, titleCase } from '../../lib/format.js';
import { useConfirm } from '../../context/Toast.jsx';
import { Button, DefinitionList, ErrorState, Field, Modal, PageHeader, PageLoader, Panel, StatusBadge } from '../../components/ui.jsx';

const FLOW = ['pending', 'processing', 'ready', 'completed'];
const NEXT_LABEL = { pending: 'Start processing', processing: 'Mark ready', ready: 'Complete order' };

export default function OrderDetail() {
  const { id } = useParams();
  const confirm = useConfirm();
  const order = useApi(['orders', id], `/orders/${id}`);
  const [completing, setCompleting] = useState(false);
  const [notes, setNotes] = useState(null);
  useDocumentTitle(order.data?.orderNumber || 'Order');
  useEffect(() => { if (order.data) setNotes(order.data.notes || ''); }, [order.data?.notes]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = useAction(({ status, paymentMethod }) => api.patch(`/orders/${id}/status`, { status, paymentMethod }), { invalidate: AFTER_TRANSACTION, success: (_r, v) => `Order marked ${titleCase(v.status).toLowerCase()}.`, onSuccess: () => setCompleting(false) });
  const saveNotes = useAction(() => api.patch(`/orders/${id}`, { notes }), { invalidate: ['orders'], success: 'Notes saved.' });

  if (order.isPending) return <PageLoader />;
  if (order.error) return <ErrorState error={order.error} onRetry={order.refetch} title={order.error.status === 404 ? 'Order not found' : undefined} />;
  const o = order.data;
  const cancelled = o.status === 'cancelled';
  const stepIndex = FLOW.indexOf(o.status);
  const next = FLOW[stepIndex + 1];

  const advance = () => (next === 'completed' ? setCompleting(true) : move.mutate({ status: next }));
  const cancel = async () => {
    const wasCompleted = o.status === 'completed';
    if (await confirm({ title: `Cancel ${o.orderNumber}?`, message: wasCompleted ? 'Stock is returned and the linked sale is voided. A cancelled order cannot be reopened.' : 'A cancelled order cannot be reopened.', confirmLabel: 'Cancel order', cancelLabel: 'Keep order', tone: 'danger' })) move.mutate({ status: 'cancelled' });
  };

  return (
    <>
      <PageHeader back="/app/orders" title={o.orderNumber} subtitle={`Placed ${dateTimeLabel(o.orderDate)}`}
        actions={<>
          <StatusBadge status={o.status} />
          {!cancelled && next && <Button icon={Check} loading={move.isPending && !completing} onClick={advance}>{NEXT_LABEL[o.status]}</Button>}
          {!cancelled && <Button variant="danger" icon={Ban} onClick={cancel}>Cancel order</Button>}
        </>} />

      {!cancelled ? (
        <Panel className="no-print" >
          <ol style={{ display: 'flex', listStyle: 'none', margin: 0, padding: 0, gap: 8, flexWrap: 'wrap' }}>
            {FLOW.map((step, i) => {
              const done = i <= stepIndex;
              return (
                <li key={step} style={{ flex: '1 1 130px', display: 'flex', alignItems: 'center', gap: 10, color: done ? 'var(--brand-strong)' : 'var(--muted)', fontWeight: done ? 700 : 500 }}>
                  {done ? <CheckCircle2 size={22} /> : <Circle size={22} />}
                  <span>{titleCase(step)}</span>
                  {i < FLOW.length - 1 && <span style={{ flex: 1, height: 2, background: i < stepIndex ? 'var(--brand)' : 'var(--line)', minWidth: 14 }} />}
                </li>
              );
            })}
          </ol>
        </Panel>
      ) : <div className="inline-error" style={{ marginBottom: 16 }}>This order was cancelled and can&apos;t be reopened. Create a new order if the customer still wants it.</div>}

      <div className="grid-main" style={{ marginTop: 20 }}>
        <Panel title="Items" flush>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Product</th><th className="right">Qty</th><th className="right">Price</th><th className="right">Total</th></tr></thead>
            <tbody>
              {o.items.map(i => <tr key={i.id}><td><Link className="cell-main" to={`/app/inventory/${i.productId}`}>{i.name}</Link><span className="cell-sub">{i.sku}</span></td><td className="right num">{i.quantity} {i.unit}</td><td className="right num">{money(i.unitPrice)}</td><td className="right num">{money(i.lineTotal)}</td></tr>)}
              <tr><td colSpan={3} className="right"><b>Order total</b></td><td className="right num"><b>{money(o.totalAmount)}</b></td></tr>
            </tbody>
          </table></div>
        </Panel>
        <div className="stack">
          <Panel title="Details">
            <DefinitionList items={[
              ['Customer', o.customer ? <Link className="link" to={`/app/customers/${o.customerId}`}>{o.customerName}</Link> : 'Walk-in customer'],
              ['Phone', o.customer?.phone],
              ['Expected', o.expectedDate ? dateLabel(o.expectedDate) : '—'],
              ['Stock', o.stockDeducted ? 'Deducted' : 'Not deducted yet'],
              ['Invoice', o.saleId ? <Link className="link" to={`/app/sales/${o.saleId}`}><Receipt size={14} style={{ verticalAlign: -2 }} /> {o.saleNumber}</Link> : 'Created on completion']
            ]} />
          </Panel>
          <Panel title="Notes">
            <Field label="Order notes">{p => <textarea {...p} rows={3} maxLength={500} value={notes ?? ''} onChange={e => setNotes(e.target.value)} placeholder="e.g. Deliver before noon" />}</Field>
            <div className="form-actions" style={{ marginTop: 10 }}><Button size="sm" variant="secondary" disabled={(notes ?? '') === (o.notes || '')} loading={saveNotes.isPending} onClick={() => saveNotes.mutate()}>Save notes</Button></div>
          </Panel>
        </div>
      </div>
      <CompleteModal open={completing} onClose={() => setCompleting(false)} order={o} busy={move.isPending} onConfirm={paymentMethod => move.mutate({ status: 'completed', paymentMethod })} />
    </>
  );
}

function CompleteModal({ open, onClose, order, onConfirm, busy }) {
  const [method, setMethod] = useState('cash');
  useEffect(() => { if (open) setMethod('cash'); }, [open]);
  const needsCustomer = method === 'credit' && !order.customerId;
  return (
    <Modal open={open} onClose={onClose} title="Complete this order" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Not yet</Button><Button disabled={needsCustomer} loading={busy} onClick={() => onConfirm(method)}>Complete · {money(order.totalAmount)}</Button></>}>
      <div className="stack" style={{ gap: 14 }}>
        <p className="muted">Completing deducts stock and creates an invoice for {money(order.totalAmount)}.</p>
        <Field label="How was it paid?">{p => <select {...p} value={method} onChange={e => setMethod(e.target.value)}>{Object.entries(PAYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
        {needsCustomer && <div className="inline-error">Credit needs a customer on the order. Cancel and recreate it with a customer, or pick another method.</div>}
      </div>
    </Modal>
  );
}
