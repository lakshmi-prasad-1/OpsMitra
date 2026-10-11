import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Plus } from 'lucide-react';
import { useDebounced, useDocumentTitle, useList, useQueryState } from '../../lib/hooks.js';
import { dateLabel, money } from '../../lib/format.js';
import { Badge, EmptyState, ErrorState, LinkButton, PageHeader, Pagination, Panel, SearchInput, SkeletonRows, StatusBadge, Tabs } from '../../components/ui.jsx';

const TABS = [['all', 'All'], ['open', 'Open'], ['pending', 'Pending'], ['processing', 'Processing'], ['ready', 'Ready'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];

export default function Orders() {
  useDocumentTitle('Orders');
  const navigate = useNavigate();
  const [f, setF] = useQueryState({ q: '', status: 'all', page: '1' });
  const [search, setSearch] = useState(f.q);
  const debounced = useDebounced(search);
  useEffect(() => { if (debounced !== f.q) setF({ q: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useList('orders', { q: f.q, status: f.status, page: f.page, pageSize: 25 });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Orders" subtitle="Follow every customer order from pending to delivered."
        actions={<LinkButton to="/app/orders/new" icon={Plus}>New order</LinkButton>} />
      <div className="toolbar">
        <Tabs tabs={TABS} value={f.status} onChange={status => setF({ status })} />
        <div className="spacer" />
        <SearchInput value={search} onChange={setSearch} placeholder="Search order or customer…" />
      </div>
      <Panel flush>
        {list.isPending ? <SkeletonRows /> : list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title={f.q || f.status !== 'all' ? 'No orders match' : 'No orders yet'} text={f.q || f.status !== 'all' ? 'Try another tab or search.' : 'Create an order to track a customer request.'} action={!f.q && f.status === 'all' && <LinkButton to="/app/orders/new" icon={Plus}>New order</LinkButton>} />
        ) : (
          <>
            <div className="table-wrap" style={{ opacity: list.isFetching ? .65 : 1 }}><table className="table">
              <thead><tr><th>Order</th><th>Customer</th><th>Placed</th><th>Expected</th><th className="right">Total</th><th>Status</th></tr></thead>
              <tbody>{list.rows.map(o => {
                const late = o.expectedDate && o.expectedDate < today && ['pending', 'processing', 'ready'].includes(o.status);
                return (
                  <tr key={o.id} className="row-link" onClick={() => navigate(`/app/orders/${o.id}`)}>
                    <td><span className="cell-main">{o.orderNumber}</span><span className="cell-sub">{o.lineCount} item{o.lineCount === 1 ? '' : 's'}</span></td>
                    <td>{o.customerName || <span className="muted">Walk-in</span>}</td>
                    <td className="nowrap">{dateLabel(o.orderDate)}</td>
                    <td className="nowrap">{o.expectedDate ? <>{dateLabel(o.expectedDate)} {late && <Badge tone="red">Late</Badge>}</> : <span className="muted">—</span>}</td>
                    <td className="right num"><b>{money(o.totalAmount)}</b></td>
                    <td><StatusBadge status={o.status} /></td>
                  </tr>);
              })}</tbody>
            </table></div>
            <Pagination meta={list.meta} onPage={page => setF({ page })} />
          </>
        )}
      </Panel>
    </>
  );
}
