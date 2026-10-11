import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compactMoney, money, shortDate } from '../lib/format.js';

export const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const axis = { fontSize: 12, fill: 'var(--muted)' };

function Tip({ active, payload, label, labelFormatter = shortDate, formatter = money }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <strong>{labelFormatter(label)}</strong>
      {payload.filter(p => p.value != null).map(p => <div key={p.dataKey}><span style={{ color: p.color || p.stroke }}>●</span> {p.name}: {formatter(p.value, p.dataKey)}</div>)}
    </div>
  );
}

/** Daily sales as an area, optionally with profit line and a dashed forecast series. */
export function SalesChart({ data, showProfit, height = '100%' }) {
  const thin = data.length > 45 ? Math.ceil(data.length / 8) - 1 : data.length > 14 ? 4 : 0;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity=".28" /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" /></linearGradient></defs>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={axis} tickLine={false} axisLine={false} interval={thin} />
        <YAxis tickFormatter={compactMoney} tick={axis} tickLine={false} axisLine={false} width={58} />
        <Tooltip content={<Tip />} />
        <Area type="monotone" dataKey="sales" name="Sales" stroke="var(--chart-1)" strokeWidth={2.5} fill="url(#salesFill)" />
        {showProfit && <Line type="monotone" dataKey="profit" name="Profit" stroke="var(--chart-3)" strokeWidth={2} dot={false} />}
        {data.some(d => d.predicted != null) && <Line type="monotone" dataKey="predicted" name="Estimate" stroke="var(--chart-2)" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function BarsChart({ data, xKey, bars, height = '100%', formatter = money, horizontal }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 8, left: horizontal ? 24 : 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={horizontal} horizontal={!horizontal} />
        {horizontal
          ? <><XAxis type="number" tickFormatter={compactMoney} tick={axis} tickLine={false} axisLine={false} /><YAxis type="category" dataKey={xKey} tick={axis} tickLine={false} axisLine={false} width={110} /></>
          : <><XAxis dataKey={xKey} tick={axis} tickLine={false} axisLine={false} /><YAxis tickFormatter={compactMoney} tick={axis} tickLine={false} axisLine={false} width={58} /></>}
        <Tooltip content={<Tip labelFormatter={l => l} formatter={formatter} />} cursor={{ fill: 'var(--surface-3)' }} />
        {bars.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} />}
        {bars.map((b, i) => <Bar key={b.key} dataKey={b.key} name={b.name} fill={CHART_COLORS[i]} radius={[5, 5, 0, 0]} maxBarSize={36} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, nameKey, valueKey, height = '100%' }) {
  const total = data.reduce((s, d) => s + d[valueKey], 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius="58%" outerRadius="85%" paddingAngle={2} stroke="var(--surface)" strokeWidth={2}>
          {data.map((d, i) => <Cell key={d[nameKey]} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Pie>
        <Tooltip content={({ active, payload }) => active && payload?.length ? <div className="chart-tip"><strong>{payload[0].name}</strong>{money(payload[0].value)} · {total ? Math.round(payload[0].value / total * 100) : 0}%</div> : null} />
      </PieChart>
    </ResponsiveContainer>
  );
}
