import { Link, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { dateLabel, money } from '../../lib/format.js';
import { Button, DefinitionList, ErrorState, PageHeader, PageLoader, Panel } from '../../components/ui.jsx';

export default function PurchaseDetail() {
  const { id } = useParams();
  const purchase = useApi(['purchases', id], `/purchases/${id}`);
  useDocumentTitle(purchase.data?.purchaseNumber || 'Purchase');
  if (purchase.isPending) return <PageLoader />;
  if (purchase.error) return <ErrorState error={purchase.error} onRetry={purchase.refetch} title={purchase.error.status === 404 ? 'Purchase not found' : undefined} />;
  const p = purchase.data;
  return (
    <>
      <PageHeader back="/app/suppliers?tab=purchases" title={p.purchaseNumber} subtitle={`Received ${dateLabel(p.purchaseDate)}`} actions={<Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print</Button>} />
      <div className="grid-main">
        <Panel title="Items" flush>
          <div className="table-wrap"><table className="table"><thead><tr><th>Product</th><th className="right">Qty</th><th className="right">Cost each</th><th className="right">Total</th></tr></thead>
            <tbody>{p.items.map(i => <tr key={i.id}><td><Link className="cell-main" to={`/app/inventory/${i.productId}`}>{i.name}</Link><span className="cell-sub">{i.sku}</span></td><td className="right num">{i.quantity}</td><td className="right num">{money(i.unitCost)}</td><td className="right num">{money(i.lineTotal)}</td></tr>)}
              <tr><td colSpan={3} className="right"><b>Total</b></td><td className="right num"><b>{money(p.totalAmount)}</b></td></tr></tbody></table></div>
        </Panel>
        <Panel title="Details"><DefinitionList items={[['Supplier', p.supplierId ? <Link className="link" to={`/app/suppliers/${p.supplierId}`}>{p.supplierName}</Link> : 'None'], ['Date', dateLabel(p.purchaseDate)], ['Notes', p.notes]]} /></Panel>
      </div>
    </>
  );
}
