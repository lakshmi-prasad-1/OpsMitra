import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Ban, HandCoins, MessageCircle, Printer } from 'lucide-react';
import { api } from '../../lib/api.js';
import { AFTER_TRANSACTION, useAction, useApi, useDocumentTitle } from '../../lib/hooks.js';
import { dateTimeLabel, money, PAYMENT_LABELS } from '../../lib/format.js';
import { useConfirm } from '../../context/Toast.jsx';
import { Button, ErrorState, PageHeader, PageLoader, StatusBadge } from '../../components/ui.jsx';
import { PaymentModal } from './CustomerDetail.jsx';

export default function SaleDetail() {
  const { id } = useParams();
  const confirm = useConfirm();
  const sale = useApi(['sales', id], `/sales/${id}`);
  const [paying, setPaying] = useState(false);
  useDocumentTitle(sale.data ? sale.data.saleNumber : 'Invoice');
  const voidSale = useAction(() => api.post(`/sales/${id}/void`), { invalidate: AFTER_TRANSACTION, success: 'Sale voided and stock restored.' });

  if (sale.isPending) return <PageLoader />;
  if (sale.error) return <ErrorState error={sale.error} onRetry={sale.refetch} title={sale.error.status === 404 ? 'Sale not found' : undefined} />;
  const s = sale.data; const biz = s.business || {};
  const voided = s.saleStatus === 'voided';
  const phone = (s.customer?.phone || '').replace(/\D/g, '');
  const waText = encodeURIComponent(`Hello${s.customer?.name ? ` ${s.customer.name}` : ''}, thank you for shopping at ${biz.businessName || biz.ownerName}. Invoice ${s.saleNumber}: total ${money(s.totalAmount)}${s.balanceDue > 0 ? `, balance due ${money(s.balanceDue)}` : ', paid in full'}.`);
  const waLink = phone ? `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${waText}` : null;

  return (
    <>
      <PageHeader back="/app/sales" title={s.saleNumber} subtitle={dateTimeLabel(s.saleDate)}
        actions={<>
          {waLink && <Button as="a" href={waLink} target="_blank" rel="noreferrer" variant="secondary" icon={MessageCircle}>WhatsApp</Button>}
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print</Button>
          {!voided && s.balanceDue > 0 && s.customerId && <Button icon={HandCoins} onClick={() => setPaying(true)}>Record payment</Button>}
          {!voided && !s.sourceOrderId && <Button variant="danger" icon={Ban} loading={voidSale.isPending} onClick={async () => { if (await confirm({ title: `Void ${s.saleNumber}?`, message: 'The items go back into stock and this sale stops counting as revenue. This cannot be undone.', confirmLabel: 'Void sale', tone: 'danger' })) voidSale.mutate(); }}>Void</Button>}
        </>} />

      {s.sourceOrderId && <div className="callout no-print" style={{ marginBottom: 16 }}>This invoice was created when an order was completed. <Link className="link" to={`/app/orders/${s.sourceOrderId}`}>View the order</Link> — cancelling the order voids this sale.</div>}

      <article className="invoice">
        <div className="invoice-top">
          <div>
            <h2>{biz.businessName || biz.ownerName}</h2>
            {biz.businessAddress && <div>{biz.businessAddress}</div>}
            {biz.businessPhone && <div>{biz.businessPhone}</div>}
            {biz.gstin && <div>GSTIN: {biz.gstin}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, letterSpacing: '.1em', fontWeight: 700 }}>{voided ? 'VOIDED' : s.taxAmount > 0 ? 'TAX INVOICE' : 'INVOICE'}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{s.saleNumber}</div>
            <div>{dateTimeLabel(s.saleDate)}</div>
            {voided && <div style={{ marginTop: 8 }}><span className="stamp">VOID</span></div>}
          </div>
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', color: '#5b6a76' }}>Billed to</div>
          <strong>{s.customer?.name || 'Walk-in customer'}</strong>
          {s.customer?.phone && <div>{s.customer.phone}</div>}
          {s.customer?.address && <div>{s.customer.address}</div>}
        </div>
        <table>
          <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Price</th><th className="r">GST</th><th className="r">Amount</th></tr></thead>
          <tbody>{s.items.map(i => <tr key={i.id}><td>{i.name}<div style={{ color: '#5b6a76', fontSize: 12 }}>{i.sku}</div></td><td className="r">{i.quantity} {i.unit}</td><td className="r">{money(i.unitPrice)}</td><td className="r">{i.taxRate ? `${i.taxRate}%` : '—'}</td><td className="r">{money(i.lineTotal)}</td></tr>)}</tbody>
        </table>
        <div className="sum">
          <div><span>Subtotal</span><span>{money(s.subtotal)}</span></div>
          {s.discountAmount > 0 && <div><span>Discount</span><span>−{money(s.discountAmount)}</span></div>}
          <div className="total"><span>Total</span><span>{money(s.totalAmount)}</span></div>
          {s.taxAmount > 0 && <div style={{ color: '#5b6a76' }}><span>Includes GST</span><span>{money(s.taxAmount)}</span></div>}
          <div><span>Paid ({PAYMENT_LABELS[s.paymentMethod]?.replace(' (pay later)', '')})</span><span>{money(s.amountPaid)}</span></div>
          {s.balanceDue > 0 && !voided && <div style={{ fontWeight: 800, color: '#a42a22' }}><span>Balance due</span><span>{money(s.balanceDue)}</span></div>}
        </div>
        {s.notes && <p style={{ marginTop: 18 }}><b>Note:</b> {s.notes}</p>}
        <p style={{ marginTop: 28, color: '#5b6a76', fontSize: 13 }}>Thank you for your business.</p>
      </article>

      {s.payments.length > 0 && (
        <div className="panel no-print" style={{ maxWidth: 820, margin: '20px auto 0' }}>
          <div className="panel-head"><h2>Payments received later</h2></div>
          <div className="list">{s.payments.map(p => <div className="list-row" key={p.id}><div><strong>{money(p.amount)}</strong><small>{PAYMENT_LABELS[p.method]} · {dateTimeLabel(p.paidAt)}{p.note ? ` · ${p.note}` : ''}</small></div><StatusBadge status="paid" label="Received" /></div>)}</div>
        </div>
      )}
      {s.customerId && <PaymentModal open={paying} onClose={() => setPaying(false)} customerId={s.customerId} saleId={s.id} due={s.balanceDue} />}
    </>
  );
}
