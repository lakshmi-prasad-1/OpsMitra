import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Bell, BrainCircuit, CheckCircle2, ClipboardList, FileSpreadsheet, IndianRupee, Package, PackagePlus, Plus, Sparkles, TrendingUp, Users, Wallet } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAction, useApi, useDocumentTitle, useList } from '../../lib/hooks.js';
import { compactMoney, dateLabel, delta, money, moneyRound, relativeDay } from '../../lib/format.js';
import { useAuth } from '../../context/Auth.jsx';
import { Badge, Button, ErrorState, Kpi, LinkButton, PageHeader, PageLoader, Panel, StatusBadge } from '../../components/ui.jsx';
import { SalesChart } from '../../components/Charts.jsx';

function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

export default function Dashboard() {
  useDocumentTitle('Dashboard');
  const { user } = useAuth();
  const summary = useApi(['dashboard'], '/dashboard/summary');
  const lowStock = useList('products', { status: 'attention', pageSize: 6, sort: 'stock', dir: 'asc' });
  const openOrders = useList('orders', { status: 'open', pageSize: 5 });
  const recentSales = useList('sales', { pageSize: 6 });
  const insights = useApi(['insights'], '/insights', { staleTime: 60000 });

  if (summary.isPending) return <PageLoader />;
  if (summary.error) return <ErrorState error={summary.error} onRetry={summary.refetch} />;
  const s = summary.data;
  const isEmpty = s.totalProducts === 0;
  const trend = s.trend;
  const topMax = Math.max(1, ...s.topProducts.map(p => p.revenue));

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        title={`${greeting()}, ${user.name.split(' ')[0]}`}
        subtitle={isEmpty ? "Let's get your business set up." : "Here's how your business is doing."}
        actions={<><LinkButton to="/app/inventory?new=1" variant="secondary" icon={PackagePlus}>Add product</LinkButton><LinkButton to="/app/sales/new" icon={Plus}>New sale</LinkButton></>}
      />

      {isEmpty && <GettingStarted />}

      <div className="kpi-grid">
        <Kpi label="Sales today" value={moneyRound(s.salesToday)} icon={IndianRupee} change={delta(s.salesToday, s.salesYesterday)} hint={`${s.salesCount} sale${s.salesCount === 1 ? '' : 's'} · yesterday ${moneyRound(s.salesYesterday)}`} to="/app/sales" />
        <Kpi label="This month" value={moneyRound(s.salesThisMonth)} icon={TrendingUp} tone="blue" hint={`Profit ${moneyRound(s.profitThisMonth)} (${s.marginThisMonth}%)`} to="/app/reports?range=mtd" />
        <Kpi label="Needs restocking" value={s.lowStockItems} icon={Package} tone={s.lowStockItems ? 'amber' : 'green'} hint={s.outOfStockItems ? `${s.outOfStockItems} out of stock` : s.lowStockItems ? 'At or below threshold' : 'Stock looks healthy'} to="/app/inventory?status=attention" />
        <Kpi label="Customers owe you" value={moneyRound(s.outstandingCredit)} icon={Wallet} tone={s.outstandingCredit ? 'purple' : 'green'} hint={s.creditCustomers ? `${s.creditCustomers} customer${s.creditCustomers === 1 ? '' : 's'}` : 'All settled'} to="/app/customers?status=owing" />
        <Kpi label="Open orders" value={s.pendingOrders} icon={ClipboardList} tone="blue" hint="Pending, processing or ready" to="/app/orders?status=open" />
      </div>

      <div className="grid-main">
        <div className="stack">
          <Panel title="Sales, last 30 days" subtitle="Daily sales and gross profit" actions={<Link to="/app/reports" className="link">Full report <ArrowRight size={14} style={{ verticalAlign: -2 }} /></Link>}>
            <div className="chart-box"><SalesChart data={trend} showProfit /></div>
            <div className="legend" style={{ marginTop: 8 }}><span><i style={{ background: 'var(--chart-1)' }} />Sales</span><span><i style={{ background: 'var(--chart-3)' }} />Gross profit</span></div>
          </Panel>

          <div className="grid-2">
            <Panel title="Top products" subtitle="By revenue, last 30 days">
              {s.topProducts.length === 0 ? <p className="muted">Sales will appear here once you record some.</p> : s.topProducts.map(p => (
                <div className="bar-row" key={p.id}>
                  <Link to={`/app/inventory/${p.id}`} className="cell-main" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</Link>
                  <div className="bar-track"><i style={{ width: `${(p.revenue / topMax) * 100}%` }} /></div>
                  <span className="num">{compactMoney(p.revenue)}</span>
                </div>
              ))}
            </Panel>
            <Panel title="Recent sales" actions={<Link to="/app/sales" className="link">All sales</Link>}>
              {recentSales.rows.length === 0 ? <p className="muted">No sales yet.</p> : (
                <div className="list">
                  {recentSales.rows.map(sale => (
                    <Link key={sale.id} to={`/app/sales/${sale.id}`} className="list-row">
                      <div><strong>{sale.customerName || 'Walk-in customer'}</strong><small>{sale.saleNumber} · {relativeDay(sale.saleDate)}</small></div>
                      <div className="right"><strong className="num">{money(sale.totalAmount)}</strong>{sale.balanceDue > 0 && <small style={{ color: 'var(--amber-fg)' }}>{money(sale.balanceDue)} due</small>}</div>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>

        <div className="stack">
          <Panel title="Needs your attention" subtitle="Rule-based, from your own records" actions={<Link to="/app/insights" className="link">All insights</Link>}>
            {insights.isPending ? <PageLoader label="Analysing…" /> : insights.data?.insights?.length ? (
              <div className="list">
                {insights.data.insights.filter(i => i.severity !== 'positive').slice(0, 4).map(i => (
                  <Link key={i.id} to={i.href || '/app/insights'} className="list-row" style={{ alignItems: 'flex-start' }}>
                    <i className={`kpi-icon ${i.severity === 'critical' ? 'tone-red' : i.severity === 'warning' ? 'tone-amber' : 'tone-blue'}`} style={{ width: 34, height: 34 }}>{i.severity === 'critical' || i.severity === 'warning' ? <AlertTriangle size={16} /> : <BrainCircuit size={16} />}</i>
                    <div><strong style={{ whiteSpace: 'normal' }}>{i.title}</strong><small style={{ whiteSpace: 'normal' }}>{i.recommendation}</small></div>
                  </Link>
                ))}
                {insights.data.insights.every(i => i.severity === 'positive') && <p className="muted">Nothing urgent right now. 🎉</p>}
              </div>
            ) : <p className="muted">Insights appear once you have products and sales.</p>}
          </Panel>

          <Panel title="Stock alerts" subtitle="At or below the low-stock threshold" actions={<Link to="/app/inventory?status=attention" className="link">View all</Link>}>
            {lowStock.rows.length === 0 ? <p className="muted"><CheckCircle2 size={16} style={{ verticalAlign: -3, color: 'var(--brand)' }} /> Nothing is running low.</p> : (
              <div className="list">
                {lowStock.rows.map(p => (
                  <Link key={p.id} to={`/app/inventory/${p.id}`} className="list-row">
                    <div><strong>{p.name}</strong><small>{p.sku}</small></div>
                    <div className="right"><Badge tone={p.quantity === 0 ? 'red' : 'amber'} dot>{p.quantity === 0 ? 'Out of stock' : `${p.quantity} left`}</Badge></div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Open orders" actions={<Link to="/app/orders?status=open" className="link">View all</Link>}>
            {openOrders.rows.length === 0 ? <p className="muted">No orders waiting.</p> : (
              <div className="list">
                {openOrders.rows.map(o => (
                  <Link key={o.id} to={`/app/orders/${o.id}`} className="list-row">
                    <div><strong>{o.customerName || 'Walk-in customer'}</strong><small>{o.orderNumber} · {dateLabel(o.orderDate)}</small></div>
                    <div className="right"><strong className="num">{money(o.totalAmount)}</strong><br /><StatusBadge status={o.status} /></div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function GettingStarted() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const seed = useAction(() => api.post('/demo/seed'), { success: r => `Sample business loaded: ${r.products} products, ${r.sales} sales.`, onSuccess: () => client.invalidateQueries() });
  const steps = [
    [PackagePlus, 'Add your products', 'Enter them one by one with price, cost and stock.', 'Add a product', () => navigate('/app/inventory?new=1')],
    [FileSpreadsheet, 'Or import from a spreadsheet', 'Upload a CSV with name, SKU, price and stock.', 'Import CSV', () => navigate('/app/inventory?import=1')],
    [Users, 'Add a few customers', 'Needed for credit sales and purchase history.', 'Add customers', () => navigate('/app/customers?new=1')],
    [Sparkles, 'Just exploring?', 'Fill this workspace with 90 days of realistic sample data.', 'Load sample data', () => seed.mutate()]
  ];
  return (
    <Panel title="Let's get you started" subtitle="Four quick ways to bring this workspace to life" className="getting-started" >
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {steps.map(([Icon, title, text, label, action], i) => (
          <div className="panel" key={title} style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
            <i className="kpi-icon tone-green" style={{ marginBottom: 12 }}><Icon size={18} /></i>
            <h3 style={{ fontSize: 15, marginBottom: 4 }}>{title}</h3>
            <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>{text}</p>
            <Button size="sm" variant={i === 3 ? 'primary' : 'secondary'} loading={i === 3 && seed.isPending} onClick={action}>{label}</Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
