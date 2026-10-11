import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, Mail, MapPin, Pencil, Phone, Truck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAction, useApi, useDocumentTitle } from '../../lib/hooks.js';
import { dateLabel, money } from '../../lib/format.js';
import { useConfirm } from '../../context/Toast.jsx';
import { Button, ErrorState, Kpi, LinkButton, PageHeader, PageLoader, Panel } from '../../components/ui.jsx';
import { SupplierModal } from './Suppliers.jsx';

export default function SupplierDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const supplier = useApi(['suppliers', id], `/suppliers/${id}`);
  const [editing, setEditing] = useState(false);
  useDocumentTitle(supplier.data?.name || 'Supplier');
  const archive = useAction(() => api.del(`/suppliers/${id}`), { invalidate: ['suppliers'], success: 'Supplier archived.', onSuccess: () => navigate('/app/suppliers') });
  if (supplier.isPending) return <PageLoader />;
  if (supplier.error) return <ErrorState error={supplier.error} onRetry={supplier.refetch} title={supplier.error.status === 404 ? 'Supplier not found' : undefined} />;
  const s = supplier.data;
  return (
    <>
      <PageHeader back="/app/suppliers" title={s.name} subtitle={s.isActive ? 'Supplier' : 'Archived supplier'}
        actions={<><LinkButton to="/app/purchases/new" variant="secondary" icon={Truck}>Receive stock</LinkButton><Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>{s.isActive && <Button variant="danger" icon={Archive} onClick={async () => { if (await confirm({ title: `Archive ${s.name}?`, message: 'Past purchases keep their supplier name.', confirmLabel: 'Archive', tone: 'danger' })) archive.mutate(); }}>Archive</Button>}</>} />
      <div className="kpi-grid"><Kpi label="Total bought" value={money(s.totalPurchased)} hint={`${s.purchaseCount} deliveries`} icon={Truck} /><Kpi label="Last delivery" value={s.lastPurchase ? dateLabel(s.lastPurchase) : '—'} tone="blue" icon={Truck} /></div>
      <div className="grid-main">
        <Panel title="Purchases" flush>
          {s.purchases.length === 0 ? <p className="muted" style={{ padding: 20 }}>Nothing received from this supplier yet.</p> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Purchase</th><th>Date</th><th className="right">Total</th></tr></thead>
              <tbody>{s.purchases.map(p => <tr key={p.id} className="row-link" onClick={() => navigate(`/app/purchases/${p.id}`)}><td className="cell-main">{p.purchaseNumber}</td><td>{dateLabel(p.purchaseDate)}</td><td className="right num">{money(p.totalAmount)}</td></tr>)}</tbody></table></div>
          )}
        </Panel>
        <Panel title="Contact">
          <div className="list">
            <div className="list-row"><Phone size={16} /><div><strong>{s.phone || '—'}</strong><small>Phone</small></div></div>
            <div className="list-row"><Mail size={16} /><div><strong>{s.email || '—'}</strong><small>Email</small></div></div>
            <div className="list-row"><MapPin size={16} /><div><strong style={{ whiteSpace: 'normal' }}>{s.address || '—'}</strong><small>Address</small></div></div>
          </div>
          {s.notes && <p className="inline-note" style={{ marginTop: 12 }}>{s.notes}</p>}
        </Panel>
      </div>
      <SupplierModal open={editing} onClose={() => setEditing(false)} supplier={s} />
    </>
  );
}
