import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Plus, Receipt } from 'lucide-react';
import { api } from '../../lib/api.js';
import { downloadCsv } from '../../lib/csv.js';
import { useDebounced, useDocumentTitle, useList, useQueryState } from '../../lib/hooks.js';
import { dateTimeLabel, money, PAYMENT_LABELS } from '../../lib/format.js';
import { useToast } from '../../context/Toast.jsx';
import { Badge, Button, EmptyState, ErrorState, LinkButton, PageHeader, Pagination, Panel, SearchInput, Select, SkeletonRows, StatusBadge, Tabs } from '../../components/ui.jsx';

const PAY_TABS = [['all', 'All'], ['due', 'Payment due'], ['paid', 'Paid'], ['voided', 'Voided']];

export default function Sales() {
  useDocumentTitle('Sales');
  const navigate = useNavigate();
  const toast = useToast();
  const [f, setF] = useQueryState({ q: '', tab: 'all', method: 'all', type: 'all', from: '', to: '', page: '1' });
  const [search, setSearch] = useState(f.q);
  const debounced = useDebounced(search);
  useEffect(() => { if (debounced !== f.q) setF({ q: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const params = { q: f.q, method: f.method, type: f.type, from: f.from, to: f.to, page: f.page, pageSize: 25, ...(f.tab === 'voided' ? { status: 'voided' } : f.tab === 'all' ? {} : { payment: f.tab, status: 'completed' }) };
  const list = useList('sales', params);

  const exportCsv = async () => {
    try {
      const out = await api.page(`/reports/sales-export?${new URLSearchParams({ ...(f.from && f.to ? { from: f.from, to: f.to } : { range: '90d' }) })}`);
      downloadCsv('opsmitra-sales.csv', [['Invoice', 'Date', 'Customer', 'Payment', 'Subtotal', 'Discount', 'GST included', 'Total', 'Paid', 'Status'], ...out.rows.map(r => [r.invoice, r.date, r.customer, r.paymentMethod, r.subtotal, r.discount, r.tax, r.total, r.paid, r.status])]);
    } catch (e) { toast.error(e.message); }
  };
  const filtered = f.q || f.method !== 'all' || f.type !== 'all' || f.from || f.to || f.tab !== 'all';

  return (
    <>
      <PageHeader title="Sales" subtitle="Every invoice, from direct sales and completed orders."
        actions={<><Button variant="secondary" icon={Download} onClick={exportCsv}>Export CSV</Button><LinkButton to="/app/sales/new" icon={Plus}>New sale</LinkButton></>} />
      <div className="toolbar">
        <Tabs tabs={PAY_TABS} value={f.tab} onChange={tab => setF({ tab })} />
        <div className="spacer" />
        <SearchInput value={search} onChange={setSearch} placeholder="Search invoice or customer…" />
      </div>
      <div className="toolbar">
        <Select label="Payment" value={f.method} onChange={method => setF({ method })} options={[['all', 'Any method'], ...Object.entries(PAYMENT_LABELS)]} />
        <Select label="Source" value={f.type} onChange={type => setF({ type })} options={[['all', 'All'], ['direct', 'Direct sales'], ['order', 'From orders']]} />
        <label className="select-inline"><span>From</span><input type="date" value={f.from} max={f.to || undefined} onChange={e => setF({ from: e.target.value })} style={{ width: 'auto' }} /></label>
        <label className="select-inline"><span>To</span><input type="date" value={f.to} min={f.from || undefined} onChange={e => setF({ to: e.target.value })} style={{ width: 'auto' }} /></label>
        {filtered && <button className="link" onClick={() => { setSearch(''); setF({ q: '', tab: 'all', method: 'all', type: 'all', from: '', to: '' }); }}>Clear filters</button>}
      </div>
      <Panel flush>
        {list.isPending ? <SkeletonRows /> : list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : list.rows.length === 0 ? (
          <EmptyState icon={Receipt} title={filtered ? 'No sales match these filters' : 'No sales yet'} text={filtered ? 'Try widening the dates or clearing filters.' : 'Record your first sale to see it here.'} action={!filtered && <LinkButton to="/app/sales/new" icon={Plus}>New sale</LinkButton>} />
        ) : (
          <>
            <div className="table-wrap" style={{ opacity: list.isFetching ? .65 : 1 }}><table className="table">
              <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Payment</th><th className="right">Total</th><th>Status</th></tr></thead>
              <tbody>{list.rows.map(s => (
                <tr key={s.id} className="row-link" onClick={() => navigate(`/app/sales/${s.id}`)}>
                  <td><span className="cell-main">{s.saleNumber}</span><span className="cell-sub">{s.lineCount} item{s.lineCount === 1 ? '' : 's'}{s.sourceOrderId ? ' · from order' : ''}</span></td>
                  <td className="nowrap">{dateTimeLabel(s.saleDate)}</td>
                  <td>{s.customerName || <span className="muted">Walk-in</span>}</td>
                  <td>{PAYMENT_LABELS[s.paymentMethod]?.replace(' (pay later)', '') || s.paymentMethod}</td>
                  <td className="right num"><b>{money(s.totalAmount)}</b>{s.discountAmount > 0 && <span className="cell-sub">−{money(s.discountAmount)} discount</span>}</td>
                  <td>{s.saleStatus === 'voided' ? <StatusBadge status="voided" /> : s.paymentStatus === 'paid' ? <StatusBadge status="paid" /> : <><StatusBadge status={s.paymentStatus} /><span className="cell-sub">{money(s.balanceDue)} due</span></>}</td>
                </tr>))}</tbody>
            </table></div>
            <Pagination meta={list.meta} onPage={page => setF({ page })} />
          </>
        )}
      </Panel>
    </>
  );
}
