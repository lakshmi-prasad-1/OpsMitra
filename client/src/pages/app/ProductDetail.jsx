import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, Boxes, Calendar, IndianRupee, Pencil, Truck, TrendingUp } from 'lucide-react';
import { useApi, useDocumentTitle, useList } from '../../lib/hooks.js';
import { dateLabel, dateTimeLabel, money, number } from '../../lib/format.js';
import { Button, DefinitionList, ErrorState, Kpi, LinkButton, PageHeader, PageLoader, Pagination, Panel, SkeletonRows, StatusBadge, Badge } from '../../components/ui.jsx';
import { AdjustModal, ProductModal, stockState } from './Inventory.jsx';

const MOVE_LABEL = { opening: 'Opening stock', sale: 'Sale', sale_void: 'Sale voided', order: 'Order completed', order_cancel: 'Order cancelled', purchase: 'Stock received', adjustment: 'Manual adjustment' };

export default function ProductDetail() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') || 1);
  const product = useApi(['products', id], `/products/${id}`);
  const moves = useList(`products/${id}/movements`, { page, pageSize: 15 });
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  useDocumentTitle(product.data?.name || 'Product');

  if (product.isPending) return <PageLoader />;
  if (product.error) return <ErrorState error={product.error} onRetry={product.refetch} title={product.error.status === 404 ? 'Product not found' : undefined} />;
  const p = product.data; const st = p.stats;
  const [label] = stockState(p);
  const margin = p.sellingPrice > 0 && p.costPrice > 0 ? ((p.sellingPrice / (1 + p.taxRate / 100) - p.costPrice) / p.sellingPrice) * 100 : null;

  return (
    <>
      <PageHeader back="/app/inventory" title={p.name} subtitle={`${p.sku}${p.category ? ` · ${p.category}` : ''}`}
        actions={p.isActive ? <><Button variant="secondary" icon={ArrowDownUp} onClick={() => setAdjusting(true)}>Adjust stock</Button><LinkButton to="/app/purchases/new" variant="secondary" icon={Truck}>Receive stock</LinkButton><Button icon={Pencil} onClick={() => setEditing(true)}>Edit</Button></> : <StatusBadge status="archived" label="Inactive" />} />

      <div className="kpi-grid">
        <Kpi label="In stock" value={`${number(p.quantity)} ${p.unit}`} icon={Boxes} tone={label === 'in stock' ? 'green' : label === 'low stock' ? 'amber' : 'red'} hint={<StatusBadge status={label} />} />
        <Kpi label="Sold, last 30 days" value={number(st.sold30)} icon={TrendingUp} tone="blue" hint={st.lastSold ? `Last sale ${dateLabel(st.lastSold)}` : 'No sales yet'} />
        <Kpi label="Revenue, 30 days" value={money(st.revenue30)} icon={IndianRupee} hint={`Profit ${money(st.profit30)}`} />
        <Kpi label="Days of stock left" value={st.daysOfStockLeft == null ? '—' : st.daysOfStockLeft} icon={Calendar} tone={st.daysOfStockLeft != null && st.daysOfStockLeft <= 7 ? 'amber' : 'green'} hint={st.avgDailySales ? `Selling ~${st.avgDailySales}/day` : 'Not selling recently'} />
      </div>

      <div className="grid-main">
        <Panel title="Stock history" subtitle="Every change to this product's quantity" flush>
          {moves.isPending ? <SkeletonRows rows={5} /> : moves.rows.length === 0 ? <p className="muted" style={{ padding: 20 }}>No stock movements recorded yet.</p> : (
            <>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>When</th><th>Type</th><th>Note</th><th className="right">Change</th><th className="right">Balance</th></tr></thead>
                <tbody>{moves.rows.map(m => (
                  <tr key={m.id}>
                    <td className="nowrap">{dateTimeLabel(m.createdAt)}</td>
                    <td>{MOVE_LABEL[m.type] || m.type}</td>
                    <td className="muted">{m.refType === 'sale' && m.refId ? <Link className="link" to={`/app/sales/${m.refId}`}>{m.note || 'View sale'}</Link> : m.refType === 'order' && m.refId ? <Link className="link" to={`/app/orders/${m.refId}`}>{m.note || 'View order'}</Link> : m.refType === 'purchase' && m.refId ? <Link className="link" to={`/app/purchases/${m.refId}`}>{m.note || 'View purchase'}</Link> : (m.note || '—')}</td>
                    <td className="right num"><b style={{ color: m.change > 0 ? 'var(--green-fg)' : 'var(--red-fg)' }}>{m.change > 0 ? '+' : ''}{m.change}</b></td>
                    <td className="right num">{m.quantityAfter}</td>
                  </tr>))}</tbody>
              </table></div>
              <Pagination meta={moves.meta} onPage={n => setSp(prev => { prev.set('page', n); return prev; })} />
            </>
          )}
        </Panel>

        <Panel title="Details">
          <DefinitionList items={[
            ['Selling price', `${money(p.sellingPrice)} per ${p.unit}`],
            ['Cost price', p.costPrice ? money(p.costPrice) : 'Not set'],
            ['Margin (after GST)', margin == null ? '—' : `${margin.toFixed(1)}%`],
            ['GST rate', `${p.taxRate}%`],
            ['Low-stock alert at', `${p.lowStockThreshold} ${p.unit}`],
            ['Barcode', p.barcode],
            ['Expiry', p.expiryDate ? <>{dateLabel(p.expiryDate)} {new Date(`${p.expiryDate}T12:00:00`) < new Date() && <Badge tone="red">Expired</Badge>}</> : '—'],
            ['Added', dateLabel(p.createdAt)]
          ]} />
        </Panel>
      </div>
      <ProductModal product={editing ? p : null} onClose={() => setEditing(false)} />
      <AdjustModal product={adjusting ? p : null} onClose={() => setAdjusting(false)} />
    </>
  );
}
