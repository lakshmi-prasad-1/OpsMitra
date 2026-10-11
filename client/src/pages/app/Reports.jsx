import { Link } from 'react-router-dom';
import { Download, IndianRupee, Percent, Printer, Receipt, ShoppingBag, TrendingUp, Wallet } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { downloadCsv } from '../../lib/csv.js';
import { useApi, useDocumentTitle, useQueryState } from '../../lib/hooks.js';
import { compactMoney, dateLabel, delta, money, moneyRound, number, percent, PAYMENT_LABELS } from '../../lib/format.js';
import { useToast } from '../../context/Toast.jsx';
import { Button, EmptyState, ErrorState, Kpi, PageHeader, PageLoader, Panel, Select, Tabs, StatusBadge } from '../../components/ui.jsx';
import { BarsChart, DonutChart, SalesChart, CHART_COLORS } from '../../components/Charts.jsx';

const RANGES = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['mtd', 'This month'], ['ytd', 'This year'], ['custom', 'Custom range']];

export default function Reports() {
  useDocumentTitle('Reports');
  const toast = useToast();
  const [f, setF] = useQueryState({ view: 'sales', range: '30d', from: '', to: '' });
  const custom = f.range === 'custom' && f.from && f.to;
  const rangeParams = custom ? { from: f.from, to: f.to } : { range: f.range === 'custom' ? '30d' : f.range };
  const report = useApi(['reports', 'sales', rangeParams], `/reports${qs(rangeParams)}`, { enabled: f.view === 'sales' });
  const inventory = useApi(['reports', 'inventory'], '/reports/inventory', { enabled: f.view === 'inventory' });
  const tax = useApi(['reports', 'tax', rangeParams], `/reports/tax${qs(rangeParams)}`, { enabled: f.view === 'tax' });

  const exportSales = async () => {
    try {
      const out = await api.page(`/reports/sales-export${qs(rangeParams)}`);
      downloadCsv(`opsmitra-sales-${out.meta.from}-to-${out.meta.to}.csv`, [['Invoice', 'Date', 'Customer', 'Payment', 'Subtotal', 'Discount', 'GST included', 'Total', 'Paid', 'Status'], ...out.rows.map(r => [r.invoice, r.date, r.customer, r.paymentMethod, r.subtotal, r.discount, r.tax, r.total, r.paid, r.status])]);
    } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <PageHeader title="Reports" subtitle="Revenue, profit, GST and stock value from your recorded transactions."
        actions={<><Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print</Button>{f.view === 'sales' && <Button variant="secondary" icon={Download} onClick={exportSales}>Export sales CSV</Button>}</>} />
      <div className="toolbar no-print">
        <Tabs tabs={[['sales', 'Sales & profit'], ['tax', 'GST summary'], ['inventory', 'Stock value']]} value={f.view} onChange={view => setF({ view })} />
        <div className="spacer" />
        {f.view !== 'inventory' && <>
          <Select label="Period" value={f.range} onChange={range => setF({ range, ...(range !== 'custom' ? { from: '', to: '' } : {}) })} options={RANGES} />
          {f.range === 'custom' && <>
            <label className="select-inline"><span>From</span><input type="date" value={f.from} max={f.to || undefined} onChange={e => setF({ from: e.target.value })} style={{ width: 'auto' }} /></label>
            <label className="select-inline"><span>To</span><input type="date" value={f.to} min={f.from || undefined} onChange={e => setF({ to: e.target.value })} style={{ width: 'auto' }} /></label>
          </>}
        </>}
      </div>
      {f.range === 'custom' && !custom && f.view !== 'inventory' && <div className="inline-note" style={{ marginBottom: 16 }}>Choose both dates to see a custom range. Showing the last 30 days meanwhile.</div>}

      {f.view === 'sales' && <SalesView q={report} />}
      {f.view === 'tax' && <TaxView q={tax} />}
      {f.view === 'inventory' && <InventoryView q={inventory} />}
    </>
  );
}

function SalesView({ q }) {
  if (q.isPending) return <PageLoader label="Preparing report…" />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const t = r.totals; const p = r.previous;
  const periodLabel = `${dateLabel(r.range.from)} – ${dateLabel(r.range.to)}`;
  if (t.salesCount === 0) return <Panel><EmptyState icon={Receipt} title="No sales in this period" text={`Nothing recorded between ${periodLabel}. Try a longer range, or record a sale.`} action={<Button as={Link} to="/app/sales/new">New sale</Button>} /></Panel>;
  const catData = r.categories.map(c => ({ ...c, name: c.category }));
  const payData = r.paymentMethods.map(m => ({ ...m, name: PAYMENT_LABELS[m.method]?.replace(' (pay later)', '') || m.method }));
  const maxRev = Math.max(1, ...r.topProducts.map(x => x.revenue));
  return (
    <div className="stack">
      <p className="muted" style={{ marginTop: -8 }}>{periodLabel} · compared with the previous {r.range.days} day{r.range.days === 1 ? '' : 's'}</p>
      <div className="kpi-grid" style={{ marginBottom: 0 }}>
        <Kpi label="Revenue" value={moneyRound(t.revenue)} icon={IndianRupee} change={delta(t.revenue, p.revenue)} hint={`was ${compactMoney(p.revenue)}`} />
        <Kpi label="Gross profit" value={moneyRound(t.profit)} icon={TrendingUp} tone="blue" change={delta(t.profit, p.profit)} hint={`${percent(t.margin)} margin`} />
        <Kpi label="Sales" value={number(t.salesCount)} icon={ShoppingBag} tone="purple" change={delta(t.salesCount, p.salesCount)} hint={`avg ${moneyRound(t.averageSale)}`} />
        <Kpi label="Discounts given" value={moneyRound(t.discount)} icon={Percent} tone="amber" hint={t.revenue ? `${percent(t.discount / (t.revenue + t.discount) * 100)} of gross` : ''} />
        <Kpi label="Owed by customers" value={moneyRound(r.receivables.outstanding)} icon={Wallet} tone={r.receivables.outstanding ? 'amber' : 'green'} hint={`${r.receivables.invoices} open invoice${r.receivables.invoices === 1 ? '' : 's'} (all time)`} to="/app/customers?status=owing" />
      </div>
      <Panel title="Sales trend" subtitle="Daily sales and gross profit (revenue minus GST, cost and discounts)">
        <div className="chart-box tall"><SalesChart data={r.trend} showProfit /></div>
        <div className="legend" style={{ marginTop: 8 }}><span><i style={{ background: 'var(--chart-1)' }} />Sales</span><span><i style={{ background: 'var(--chart-3)' }} />Gross profit</span></div>
      </Panel>
      <div className="grid-2">
        <Panel title="Sales by category" subtitle="Revenue and profit">
          <div className="chart-box"><BarsChart data={catData} xKey="name" bars={[{ key: 'revenue', name: 'Revenue' }, { key: 'profit', name: 'Profit' }]} /></div>
        </Panel>
        <Panel title="Payment methods" subtitle="Share of revenue">
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 220px) 1fr', gap: 16, alignItems: 'center' }}>
            <div className="chart-box short"><DonutChart data={payData} nameKey="name" valueKey="amount" /></div>
            <div className="list">{payData.map((m, i) => <div className="list-row" key={m.method}><i style={{ width: 10, height: 10, borderRadius: 3, background: CHART_COLORS[i % 5], flexShrink: 0 }} /><div><strong>{m.name}</strong><small>{m.count} sale{m.count === 1 ? '' : 's'}</small></div><span className="num">{moneyRound(m.amount)}</span></div>)}</div>
          </div>
        </Panel>
      </div>
      <div className="grid-2">
        <Panel title="Top products" subtitle="By revenue" flush>
          <div className="table-wrap"><table className="table"><thead><tr><th>Product</th><th className="right">Units</th><th className="right">Revenue</th><th className="right">Profit</th></tr></thead>
            <tbody>{r.topProducts.map(x => <tr key={x.id}><td><Link className="cell-main" to={`/app/inventory/${x.id}`}>{x.name}</Link><div className="bar-track" style={{ height: 5, marginTop: 6 }}><i style={{ width: `${x.revenue / maxRev * 100}%` }} /></div></td><td className="right num">{number(x.quantitySold)}</td><td className="right num">{money(x.revenue)}</td><td className="right num" style={{ color: x.profit < 0 ? 'var(--danger)' : undefined }}>{money(x.profit)}</td></tr>)}</tbody></table></div>
        </Panel>
        <div className="stack">
          <Panel title="Top customers" flush>
            {r.topCustomers.length === 0 ? <p className="muted" style={{ padding: 20 }}>Sales to named customers will show here.</p> : (
              <div className="table-wrap"><table className="table"><thead><tr><th>Customer</th><th className="right">Purchases</th><th className="right">Spent</th></tr></thead>
                <tbody>{r.topCustomers.map(c => <tr key={c.id}><td><Link className="cell-main" to={`/app/customers/${c.id}`}>{c.name}</Link></td><td className="right num">{c.count}</td><td className="right num">{money(c.revenue)}</td></tr>)}</tbody></table></div>
            )}
          </Panel>
          <Panel title="Orders created in this period">
            {r.orderStatuses.length === 0 ? <p className="muted">No orders in this period.</p> : <div className="list">{r.orderStatuses.map(o => <div className="list-row" key={o.status}><StatusBadge status={o.status} /><div /><strong className="num">{o.count}</strong></div>)}</div>}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function TaxView({ q }) {
  if (q.isPending) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <div className="stack">
      <div className="kpi-grid" style={{ marginBottom: 0 }}>
        <Kpi label="Sales (incl. GST)" value={moneyRound(d.totals.gross)} icon={IndianRupee} hint={`${dateLabel(d.range.from)} – ${dateLabel(d.range.to)}`} />
        <Kpi label="Taxable value" value={moneyRound(d.totals.taxable)} icon={Receipt} tone="blue" />
        <Kpi label="GST collected" value={moneyRound(d.totals.tax)} icon={Percent} tone="purple" hint="Included in your prices" />
      </div>
      <Panel title="GST by rate" subtitle="Tax contained in your tax-inclusive selling prices, before invoice-level discounts" flush>
        {d.lines.length === 0 ? <p className="muted" style={{ padding: 20 }}>No sales in this period.</p> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>GST rate</th><th className="right">Taxable value</th><th className="right">GST</th><th className="right">Total sales</th></tr></thead>
            <tbody>{d.lines.map(l => <tr key={l.rate}><td className="cell-main">{l.rate}%</td><td className="right num">{money(l.taxable)}</td><td className="right num">{money(l.tax)}</td><td className="right num">{money(l.gross)}</td></tr>)}
              <tr><td><b>Total</b></td><td className="right num"><b>{money(d.totals.taxable)}</b></td><td className="right num"><b>{money(d.totals.tax)}</b></td><td className="right num"><b>{money(d.totals.gross)}</b></td></tr></tbody></table></div>
        )}
      </Panel>
      <p className="muted" style={{ fontSize: 13 }}>This is a management summary to help you prepare returns — it is not a filed GST return. Set each product&apos;s GST rate in Inventory.</p>
    </div>
  );
}

function InventoryView({ q }) {
  if (q.isPending) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <div className="stack">
      <div className="kpi-grid" style={{ marginBottom: 0 }}>
        <Kpi label="Stock value at cost" value={moneyRound(d.totals.costValue)} icon={Wallet} hint="What your stock cost you" />
        <Kpi label="Stock value at retail" value={moneyRound(d.totals.retailValue)} icon={IndianRupee} tone="blue" hint={`Potential margin ${moneyRound(d.totals.retailValue - d.totals.costValue)}`} />
        <Kpi label="Units in stock" value={number(d.totals.units)} icon={ShoppingBag} tone="purple" hint={`${d.totals.products} products`} />
      </div>
      <div className="grid-2">
        <Panel title="Value by category"><div className="chart-box"><BarsChart data={d.categories} xKey="category" bars={[{ key: 'costValue', name: 'At cost' }, { key: 'retailValue', name: 'At retail' }]} /></div></Panel>
        <Panel title="Most valuable items" flush>
          <div className="table-wrap"><table className="table"><thead><tr><th>Product</th><th className="right">Stock</th><th className="right">Value at cost</th></tr></thead>
            <tbody>{d.topValueItems.map(i => <tr key={i.id}><td><Link className="cell-main" to={`/app/inventory/${i.id}`}>{i.name}</Link></td><td className="right num">{i.quantity}</td><td className="right num">{money(i.costValue)}</td></tr>)}</tbody></table></div>
        </Panel>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Products without a cost price count as zero at cost — add cost prices in Inventory for an accurate valuation.</p>
    </div>
  );
}
