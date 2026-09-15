import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart3, Box, CalendarDays, CircleDollarSign, Clock, Coins, Grid3x3, Layers, Lightbulb, PiggyBank, Printer, Receipt,
  ShoppingBag, Sparkles, Table2, TrendingUp, Users, Wallet, Warehouse,
} from 'lucide-react';
import { api } from '../api/client';
import { useDataChanged } from '../hooks/useDataChanged';
import { useTheme } from '../hooks/useTheme';
import { useSettings } from '../lib/settings';
import { Button, Card, CardHeader, ErrorNote, ExportMenu, PageHeader, SegmentedControl, Table } from '../components/ui';
import { AreaChart, ColumnChart, Heatmap, HorizontalBars, ShareBar, StatTile } from '../components/charts';
import { Reveal, RevealGroup, RevealItem } from '../components/motion/Reveal';
import CountUp from '../components/motion/CountUp';
import Scene3D from '../components/three/Scene3D';
import { formatDate, formatNumber, formatPercent } from '../lib/format';
import { cn } from '../lib/cn';

const loadBusyHours = () => import('../components/three/BusyHours3D');

const RANGES = [['7', '7D'], ['30', '30D'], ['90', '90D'], ['365', '1Y'], ['custom', 'Custom']];
const METHOD_NAMES = { cash: 'Cash', card: 'Card', upi: 'UPI', bank: 'Bank transfer', other: 'Other' };
const DAY_NAMES = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };

function isoDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hourName(h) {
  const hr = h % 24;
  if (hr === 0) return '12am';
  if (hr === 12) return '12pm';
  return hr < 12 ? `${hr}am` : `${hr - 12}pm`;
}

function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Optional.
  }
}

export default function ReportsPage() {
  const [range, setRange] = useState(() => readPref('docdesk.reports.range', '30'));
  const [custom, setCustom] = useState({ from: isoDay(-29), to: isoDay(0) });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const params = useMemo(() => (range === 'custom' ? { from: custom.from, to: custom.to } : { days: range }), [range, custom]);
  const paramKey = JSON.stringify(params);

  const load = useCallback(async () => {
    const p = JSON.parse(paramKey);
    if (p.from && p.to && p.from > p.to) {
      setError('The start date is after the end date.');
      return;
    }
    setLoading(true);
    try {
      const [summary, byDay, products, customers, categories, payments, stock, heatmap, weekdays] = await Promise.all([
        api.reports.summary(p),
        api.reports.salesByDay(p),
        api.reports.topProducts({ ...p, limit: 8 }),
        api.reports.topCustomers({ ...p, limit: 8 }),
        api.reports.byCategory(p),
        api.reports.byPaymentMethod(p),
        api.reports.stockByCategory(),
        api.reports.heatmap(p),
        api.reports.byWeekday(p),
      ]);
      setData({ summary, series: byDay.series, products, customers, categories, payments, stock, cells: heatmap.cells, weekdays });
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [paramKey]);

  useEffect(() => {
    load();
  }, [load]);

  useDataChanged(() => load());

  function changeRange(next) {
    setRange(next);
    if (next !== 'custom') writePref('docdesk.reports.range', next);
  }

  const s = data?.summary;
  const period = s ? `${formatDate(s.from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${formatDate(s.to, { day: 'numeric', month: 'short', year: 'numeric' })}` : '';

  return (
    <div className="report-print">
      <PageHeader title="Reports" subtitle={s ? period : 'What sold, what it earned, who bought it.'} eyebrow="Insights" icon={BarChart3}>
        <SegmentedControl value={range} onChange={changeRange} options={RANGES} ariaLabel="Period" />
        <ExportMenu table="sales" params={s ? { from: s.from, to: s.to } : {}} label="Export sales" />
        <Button variant="secondary" icon={Printer} onClick={() => window.print()} className="print:hidden">Print</Button>
      </PageHeader>

      <AnimatePresence initial={false}>
        {range === 'custom' && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mb-6 flex flex-wrap items-center gap-3 rounded-[20px] p-3 pl-4" style={{ background: 'rgb(var(--c-surface))', boxShadow: '0 0 0 1px var(--line), var(--shadow-sm)' }}>
              <CalendarDays size={16} className="text-ink-3" />
              <label className="flex items-center gap-2 text-[13px] text-ink-2">From <input type="date" className="input-field h-9 w-auto" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
              <label className="flex items-center gap-2 text-[13px] text-ink-2">to <input type="date" className="input-field h-9 w-auto" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
              <div className="flex flex-wrap gap-1.5">
                {[['This month', () => { const d = new Date(); return { from: isoDay(-(d.getDate() - 1)), to: isoDay(0) }; }], ['Last 14 days', () => ({ from: isoDay(-13), to: isoDay(0) })], ['Year to date', () => { const d = new Date(); return { from: `${d.getFullYear()}-01-01`, to: isoDay(0) }; }]].map(([label, make]) => (
                  <button key={label} type="button" className="btn-ghost btn-sm" onClick={() => setCustom(make())}>{label}</button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ErrorNote error={error} onDismiss={() => setError(null)} />

      {!data ? (
        <ReportsSkeleton />
      ) : (
        <div className={cn('transition-opacity duration-300', loading && 'opacity-60')}>
          <Kpis summary={s} series={data.series} />
          <Insights data={data} />
          <TrendCard series={data.series} period={period} />

          <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
            <BusyHoursCard cells={data.cells} />
            <WeekdayCard weekdays={data.weekdays} />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <MoneyFlowCard summary={s} />
            <PaymentsCard payments={data.payments} />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CategoriesCard categories={data.categories} />
            <BestSellersCard products={data.products} />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
            <TopCustomersCard customers={data.customers} />
            <StockValueCard stock={data.stock} />
          </div>

          <p className="mt-2 text-[12px] text-ink-3">
            Profit uses the cost price recorded on each sale line at the time of sale. Days and hours are counted in {s.timezone}.
          </p>
        </div>
      )}
    </div>
  );
}

function ReportsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-[132px] rounded-[22px]" />)}
      </div>
      <div className="skeleton h-[380px] rounded-[24px]" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="skeleton h-[320px] rounded-[24px]" />
        <div className="skeleton h-[320px] rounded-[24px]" />
      </div>
    </div>
  );
}

function Kpis({ summary: s, series }) {
  const { money, compactMoney } = useSettings();
  const navigate = useNavigate();
  const spark = (key) => {
    // Keep sparklines readable on long ranges by folding days into up to 30 points.
    const values = series.map((d) => d[key]);
    if (values.length <= 30) return values;
    const size = Math.ceil(values.length / 30);
    const folded = [];
    for (let i = 0; i < values.length; i += size) folded.push(values.slice(i, i + size).reduce((a, b) => a + b, 0));
    return folded;
  };
  const salesDelta = s.previous.saleCount ? Math.round(((s.saleCount - s.previous.saleCount) / s.previous.saleCount) * 100) : null;

  return (
    <RevealGroup className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <RevealItem>
        <StatTile label="Revenue" icon={CircleDollarSign} value={s.revenue} format={(n) => compactMoney(n)} delta={s.revenueChangePercent} deltaLabel="vs previous period" spark={spark('revenue')} />
      </RevealItem>
      <RevealItem>
        <StatTile label="Gross profit" icon={PiggyBank} value={s.estimatedProfit} format={(n) => compactMoney(n)} tone={s.estimatedProfit < 0 ? 'red' : 'green'} footnote={`${formatPercent(s.marginPercent, 1)} margin before tax`} spark={spark('profit')} sparkColor="var(--series-3)" />
      </RevealItem>
      <RevealItem>
        <StatTile label="Sales" icon={Receipt} value={s.saleCount} format={(n) => formatNumber(Math.round(n))} delta={salesDelta} deltaLabel="vs previous period" footnote={salesDelta === null ? `Average ${money(s.averageSale)}` : undefined} spark={spark('saleCount')} sparkColor="var(--series-2)" />
      </RevealItem>
      <RevealItem>
        <StatTile label="Owed to you" icon={Wallet} value={s.outstanding.amount} format={(n) => compactMoney(n)} tone={s.outstanding.count ? 'amber' : undefined} footnote={`${s.outstanding.count} unpaid or part paid · all time`} onClick={() => navigate('/sales?status=unpaid')} />
      </RevealItem>
    </RevealGroup>
  );
}

/** Plain-language findings, worked out from the numbers already on the page. */
function Insights({ data }) {
  const { money, compactMoney } = useSettings();
  const items = useMemo(() => {
    const out = [];
    const s = data.summary;
    if (s.saleCount === 0) {
      out.push({ icon: Sparkles, text: 'No sales in this period yet - pick a longer range to see trends.' });
      return out;
    }
    if (s.previous.revenue > 0) {
      const up = s.revenueChangePercent >= 0;
      out.push({ icon: TrendingUp, tone: up ? 'good' : 'bad', text: <>Revenue is <b>{up ? 'up' : 'down'} {Math.abs(s.revenueChangePercent)}%</b> on the period before ({compactMoney(s.previous.revenue)}).</> });
    }
    const days = data.weekdays.filter((d) => d.averageRevenue > 0);
    if (days.length >= 3) {
      const best = days.reduce((a, b) => (b.averageRevenue > a.averageRevenue ? b : a));
      const worst = days.reduce((a, b) => (b.averageRevenue < a.averageRevenue ? b : a));
      out.push({ icon: CalendarDays, text: <><b>{DAY_NAMES[best.isodow % 7]}</b> is the strongest day, averaging {compactMoney(best.averageRevenue)} - {worst.averageRevenue > 0 ? `${(best.averageRevenue / worst.averageRevenue).toFixed(1)}×` : 'well above'} a {DAY_NAMES[worst.isodow % 7]}.</> });
    }
    if (data.cells.length) {
      const busiest = data.cells.reduce((a, b) => (b.count > a.count ? b : a));
      if (busiest.count > 0) out.push({ icon: Clock, text: <>The busiest hour is <b>{DAY_NAMES[busiest.dow]} {hourName(busiest.hour)}–{hourName(busiest.hour + 1)}</b>, with {busiest.count} sales.</> });
    }
    const totalCat = data.categories.reduce((sum, c) => sum + c.revenue, 0);
    if (data.categories.length > 1 && totalCat > 0) {
      const top = data.categories[0];
      const bestMargin = data.categories.filter((c) => c.revenue > 0).reduce((a, b) => (b.profit / b.revenue > a.profit / a.revenue ? b : a));
      out.push({ icon: Layers, text: <><b>{top.category}</b> brings in {Math.round((top.revenue / totalCat) * 100)}% of sales; <b>{bestMargin.category}</b> keeps the most of each sale ({Math.round((bestMargin.profit / bestMargin.revenue) * 100)}% margin).</> });
    }
    if (data.customers.length) {
      const c = data.customers[0];
      out.push({ icon: Users, text: <><b>{c.name}</b> is your top customer this period: {c.saleCount} visit{c.saleCount === 1 ? '' : 's'}, {money(c.revenue)}.</> });
    }
    if (s.discount > 0) out.push({ icon: Coins, text: <>Discounts given: <b>{money(s.discount)}</b>, about {((s.discount / (s.revenue + s.discount)) * 100).toFixed(1)}% of list value.</> });
    return out.slice(0, 5);
  }, [data, money, compactMoney]);

  return (
    <Reveal className="mb-6">
      <div className="relative overflow-hidden rounded-[24px] p-5 sm:p-6" style={{ background: 'linear-gradient(135deg, rgb(var(--c-surface)) 30%, var(--accent-soft))', boxShadow: '0 0 0 1px var(--line), var(--shadow-sm), var(--edge-highlight)' }}>
        <div className="mb-4 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-[10px]" style={{ background: 'linear-gradient(145deg, #ffcc4d, #ff9f0a)', boxShadow: '0 6px 16px -6px rgb(255 159 10 / 0.7)' }}>
            <Lightbulb size={16} color="#fff" />
          </span>
          <h2 className="text-[16px] font-semibold tracking-[-0.018em]">What stands out</h2>
        </div>
        <RevealGroup as="ul" gap={0.07} className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
          {items.map((item, i) => {
            const Icon = item.icon;
            return (
              <RevealItem as="li" key={i} className="flex gap-3 text-[14px] leading-relaxed text-ink-2 [&_b]:font-semibold [&_b]:text-ink">
                <Icon size={16} className={cn('mt-[3px] shrink-0', item.tone === 'good' ? 'text-success' : item.tone === 'bad' ? 'text-danger' : 'text-ink-3')} />
                <span>{item.text}</span>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </div>
    </Reveal>
  );
}

const TREND_METRICS = {
  revenue: { label: 'Revenue', color: 'var(--series-1)' },
  profit: { label: 'Profit', color: 'var(--series-3)' },
  saleCount: { label: 'Sales', color: 'var(--series-2)' },
};

function TrendCard({ series, period }) {
  const { money, compactMoney } = useSettings();
  const [metric, setMetric] = useState('revenue');
  const [view, setView] = useState('chart');
  const isCount = metric === 'saleCount';
  const total = series.reduce((sum, d) => sum + d[metric], 0);
  const peak = series.reduce((a, b) => (b[metric] > (a?.[metric] ?? -Infinity) ? b : a), null);

  return (
    <Reveal className="mb-6">
      <Card>
        <CardHeader
          title={`${TREND_METRICS[metric].label} per day`}
          subtitle={period}
          icon={TrendingUp}
          action={
            <div className="flex flex-wrap justify-end gap-2">
              <SegmentedControl size="sm" value={metric} onChange={setMetric} options={Object.entries(TREND_METRICS).map(([k, v]) => [k, v.label])} ariaLabel="Measure" />
              <SegmentedControl size="sm" value={view} onChange={setView} options={[['chart', 'Chart', BarChart3], ['table', 'Table', Table2]]} ariaLabel="View" />
            </div>
          }
        />
        <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-[32px] font-semibold tracking-[-0.035em] tabular">
            <CountUp value={total} format={(n) => (isCount ? formatNumber(Math.round(n)) : compactMoney(n))} />
          </p>
          {peak && peak[metric] > 0 && (
            <p className="text-[13px] text-ink-2">Best day <span className="font-medium text-ink">{formatDate(peak.day, { weekday: 'short', day: 'numeric', month: 'short' })}</span> · {isCount ? peak[metric] : money(peak[metric])}</p>
          )}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {view === 'chart' ? (
            <motion.div key={`chart-${metric}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <AreaChart
                data={series}
                valueKey={metric}
                labelKey="day"
                height={280}
                color={TREND_METRICS[metric].color}
                title={TREND_METRICS[metric].label}
                formatValue={(v) => (isCount ? `${formatNumber(v)} sales` : money(v))}
                formatAxis={(v) => (isCount ? formatNumber(v) : compactMoney(v))}
                extraRows={isCount ? (d) => [{ value: money(d.revenue), label: 'revenue' }] : (d) => [{ value: `${d.saleCount}`, label: d.saleCount === 1 ? 'sale' : 'sales' }]}
              />
            </motion.div>
          ) : (
            <motion.div key="table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="max-h-[340px] overflow-y-auto" data-lenis-prevent>
              <Table
                columns={[
                  { key: 'day', label: 'Day', sortable: false, render: (r) => formatDate(r.day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) },
                  { key: 'saleCount', label: 'Sales', align: 'right', sortable: false, render: (r) => <span className="tabular">{r.saleCount}</span> },
                  { key: 'revenue', label: 'Revenue', align: 'right', sortable: false, render: (r) => <span className="tabular">{money(r.revenue)}</span> },
                  { key: 'profit', label: 'Profit', align: 'right', sortable: false, render: (r) => <span className="tabular">{money(r.profit)}</span> },
                ]}
                rows={[...series].reverse().map((r) => ({ ...r, id: r.day }))}
                empty="Nothing in this period."
              />
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </Reveal>
  );
}

function BusyHoursCard({ cells }) {
  const { money } = useSettings();
  const { isDark } = useTheme();
  const [metric, setMetric] = useState('count');
  const [mode, setMode] = useState(() => readPref('docdesk.reports.busy', '2d'));
  const changeMode = (next) => {
    setMode(next);
    writePref('docdesk.reports.busy', next);
  };
  const formatValue = metric === 'count' ? formatNumber : (v) => money(v);
  const unit = metric === 'count' ? 'sales' : 'taken';
  const flat = <Heatmap cells={cells} metric={metric} formatValue={formatValue} unit={unit} />;

  return (
    <Reveal className="h-full">
      <Card className="h-full">
        <CardHeader
          title="Busy hours"
          subtitle="When customers buy, by weekday and hour."
          icon={Grid3x3}
          action={
            <div className="flex flex-wrap justify-end gap-2">
              <SegmentedControl size="sm" value={metric} onChange={setMetric} options={[['count', 'Sales'], ['revenue', 'Revenue']]} ariaLabel="Measure" />
              <SegmentedControl size="sm" value={mode} onChange={changeMode} options={[['2d', '2D', Grid3x3], ['3d', '3D', Box]]} ariaLabel="View" />
            </div>
          }
        />
        <AnimatePresence mode="wait" initial={false}>
          {mode === '3d' ? (
            <motion.div key="3d" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="-mx-2">
              <Scene3D load={loadBusyHours} height={330} cells={cells} metric={metric} dark={isDark} formatValue={formatValue} unit="sales" fallback={flat} />
              <p className="px-2 text-center text-[12px] text-ink-3">Drag to turn · hover a column to read it</p>
            </motion.div>
          ) : (
            <motion.div key="2d" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{flat}</motion.div>
          )}
        </AnimatePresence>
      </Card>
    </Reveal>
  );
}

function WeekdayCard({ weekdays }) {
  const { money, compactMoney } = useSettings();
  const best = weekdays.reduce((a, b) => (b.averageRevenue > (a?.averageRevenue ?? -1) ? b : a), null);
  return (
    <Reveal className="h-full" delay={0.05}>
      <Card className="flex h-full flex-col">
        <CardHeader title="A typical week" subtitle="Average takings on each weekday." icon={CalendarDays} />
        {best && best.averageRevenue > 0 && (
          <p className="mb-2 text-[13px] text-ink-2">
            <span className="font-semibold text-ink">{DAY_NAMES[best.isodow % 7]}s</span> average {money(best.averageRevenue)} from {best.averageSales} sales.
          </p>
        )}
        <div className="mt-auto">
          <ColumnChart
            data={weekdays}
            valueKey="averageRevenue"
            labelKey="day"
            height={250}
            highlight={best && best.averageRevenue > 0 ? (row) => row.isodow === best.isodow : undefined}
            formatValue={(v) => money(v)}
            formatTitle={(l) => `Average ${l}`}
            extraRows={(d) => [{ value: `${d.averageSales}`, label: 'sales on average' }, { value: compactMoney(d.revenue), label: 'in total' }]}
          />
        </div>
      </Card>
    </Reveal>
  );
}

function MoneyFlowCard({ summary: s }) {
  const { money, currency } = useSettings();
  const cost = Math.max(s.estimatedCost, 0);
  const rows = [
    { label: 'Cost of goods', value: cost },
    { label: 'Gross profit', value: Math.max(s.estimatedProfit, 0) },
    { label: 'Tax collected', value: s.tax },
  ].filter((r) => r.value > 0);
  const per100 = (v) => (s.revenue > 0 ? Math.round((v / s.revenue) * 100) : 0);

  return (
    <Reveal className="h-full">
      <Card className="h-full">
        <CardHeader title="Where the money goes" subtitle={`Of every ${currency || ''}100 taken in this period.`} icon={Coins} />
        {s.revenue > 0 ? (
          <>
            <div className="mb-6 grid grid-cols-3 gap-3">
              {[['Cost', cost, 'var(--series-1)'], ['Profit', s.estimatedProfit, 'var(--series-2)'], ['Tax', s.tax, 'var(--series-3)']].map(([label, value, color], i) => (
                <motion.div key={label} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08, type: 'spring', stiffness: 260, damping: 24 }} className="rounded-[18px] p-3.5" style={{ background: 'var(--wash)' }}>
                  <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {label}
                  </div>
                  <p className="text-[26px] font-semibold tracking-[-0.035em] tabular">
                    <span className="mr-0.5 text-[15px] font-medium text-ink-3">{currency}</span>
                    <CountUp value={per100(value)} format={(n) => Math.round(n)} />
                  </p>
                  <p className="truncate text-[11.5px] text-ink-3 tabular">{money(value)}</p>
                </motion.div>
              ))}
            </div>
            <ShareBar rows={rows} labelKey="label" valueKey="value" formatValue={(v) => money(v)} />
            {s.discount > 0 && <p className="mt-4 text-[12.5px] text-ink-3">Discounts of {money(s.discount)} were already taken off before these figures.</p>}
          </>
        ) : (
          <p className="py-10 text-center text-[13.5px] text-ink-3">No sales in this period.</p>
        )}
      </Card>
    </Reveal>
  );
}

function PaymentsCard({ payments }) {
  const { money, compactMoney } = useSettings();
  const total = payments.reduce((sum, p) => sum + p.revenue, 0);
  return (
    <Reveal className="h-full" delay={0.05}>
      <Card className="h-full">
        <CardHeader title="How people paid" subtitle="Money received in this period, net of refunds." icon={Wallet} />
        <p className="mb-5 text-[30px] font-semibold tracking-[-0.035em] tabular"><CountUp value={total} format={(n) => compactMoney(n)} /></p>
        {payments.length ? (
          <>
            <ShareBar rows={payments.map((p) => ({ ...p, method: METHOD_NAMES[p.method] || p.method }))} labelKey="method" valueKey="revenue" formatValue={(v) => money(v)} />
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {payments.slice(0, 4).map((p) => (
                <div key={p.method} className="rounded-[14px] px-3 py-2.5" style={{ background: 'var(--wash)' }}>
                  <p className="text-[11.5px] text-ink-3">{METHOD_NAMES[p.method] || p.method}</p>
                  <p className="text-[14px] font-semibold tabular">{p.saleCount} <span className="text-[11.5px] font-normal text-ink-3">sales</span></p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="py-10 text-center text-[13.5px] text-ink-3">No payments in this period.</p>
        )}
      </Card>
    </Reveal>
  );
}

function CategoriesCard({ categories }) {
  const { compactMoney } = useSettings();
  const [measure, setMeasure] = useState('revenue');
  const rows = [...categories].sort((a, b) => b[measure] - a[measure]);
  return (
    <Reveal className="h-full">
      <Card className="h-full">
        <CardHeader
          title="By category"
          subtitle="Where the money actually comes from."
          icon={Layers}
          action={<SegmentedControl size="sm" value={measure} onChange={setMeasure} options={[['revenue', 'Revenue'], ['profit', 'Profit']]} ariaLabel="Measure" />}
        />
        {rows.length ? (
          <HorizontalBars
            key={measure}
            rows={rows}
            labelKey="category"
            valueKey={measure}
            color={measure === 'profit' ? 'var(--series-3)' : 'var(--series-1)'}
            formatValue={(v) => compactMoney(v)}
            meta={(r) => `${formatNumber(r.quantity)} units · ${r.revenue > 0 ? Math.round((r.profit / r.revenue) * 100) : 0}% margin`}
          />
        ) : (
          <p className="py-10 text-center text-[13.5px] text-ink-3">No sales in this period.</p>
        )}
      </Card>
    </Reveal>
  );
}

function BestSellersCard({ products }) {
  const { compactMoney } = useSettings();
  const navigate = useNavigate();
  return (
    <Reveal className="h-full" delay={0.05}>
      <Card className="h-full">
        <CardHeader title="Best sellers" subtitle="Products by revenue. Click one to open it." icon={ShoppingBag} />
        {products.length ? (
          <HorizontalBars
            rows={products}
            labelKey="name"
            valueKey="revenue"
            formatValue={(v) => compactMoney(v)}
            meta={(r) => `${formatNumber(r.quantity)} sold · ${compactMoney(r.profit)} profit`}
            onSelect={(r) => r.productId && navigate(`/inventory?view=${r.productId}`)}
          />
        ) : (
          <p className="py-10 text-center text-[13.5px] text-ink-3">No sales in this period.</p>
        )}
      </Card>
    </Reveal>
  );
}

function TopCustomersCard({ customers }) {
  const { money } = useSettings();
  const navigate = useNavigate();
  const max = Math.max(...customers.map((c) => c.revenue), 1);
  return (
    <Reveal className="h-full">
      <Card className="h-full">
        <CardHeader title="Top customers" subtitle="Named customers who spent the most." icon={Users} />
        {customers.length ? (
          <ol className="space-y-1">
            {customers.map((c, i) => (
              <motion.li key={c.id} initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.04 }}>
                <button type="button" onClick={() => navigate(`/customers?history=${c.id}`)} className="group flex w-full items-center gap-3 rounded-[14px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--wash)]">
                  <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold tabular', i < 3 ? 'text-white' : 'text-ink-2')} style={{ background: i === 0 ? 'linear-gradient(145deg,#ffd60a,#ff9f0a)' : i === 1 ? 'linear-gradient(145deg,#c7c7cc,#8e8e93)' : i === 2 ? 'linear-gradient(145deg,#e0a96d,#b87333)' : 'var(--wash-strong)' }}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[14px] font-medium">{c.name}</span>
                      <span className="shrink-0 text-[13.5px] font-semibold tabular">{money(c.revenue)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--chart-track)' }}>
                        <motion.div className="h-full rounded-full" style={{ background: 'var(--series-1)' }} initial={{ width: 0 }} whileInView={{ width: `${(c.revenue / max) * 100}%` }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 70, damping: 18, delay: 0.1 + i * 0.04 }} />
                      </div>
                      <span className="w-14 shrink-0 text-right text-[11.5px] text-ink-3">{c.saleCount} visit{c.saleCount === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                </button>
              </motion.li>
            ))}
          </ol>
        ) : (
          <p className="py-10 text-center text-[13.5px] text-ink-3">No named customers bought in this period.</p>
        )}
      </Card>
    </Reveal>
  );
}

function StockValueCard({ stock }) {
  const { money, compactMoney } = useSettings();
  const cost = stock.reduce((sum, r) => sum + r.value, 0);
  const retail = stock.reduce((sum, r) => sum + r.retailValue, 0);
  return (
    <Reveal className="h-full" delay={0.05}>
      <Card className="h-full">
        <CardHeader title="What your stock is worth" subtitle="On the shelves right now - not limited to the period." icon={Warehouse} />
        <div className="mb-5 flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <p className="text-[12px] text-ink-3">At cost</p>
            <p className="text-[26px] font-semibold tracking-[-0.035em] tabular"><CountUp value={cost} format={(n) => compactMoney(n)} /></p>
          </div>
          <div>
            <p className="text-[12px] text-ink-3">At selling price</p>
            <p className="text-[26px] font-semibold tracking-[-0.035em] tabular"><CountUp value={retail} format={(n) => compactMoney(n)} /></p>
          </div>
          <div>
            <p className="text-[12px] text-ink-3">Potential profit</p>
            <p className="text-[26px] font-semibold tracking-[-0.035em] text-success tabular"><CountUp value={retail - cost} format={(n) => compactMoney(n)} /></p>
          </div>
        </div>
        <Table
          columns={[
            { key: 'category', label: 'Category', sortable: false, render: (r) => <span className="font-medium">{r.category}</span> },
            { key: 'products', label: 'Products', align: 'right', sortable: false, render: (r) => <span className="tabular">{r.products}{r.out ? <span className="ml-1.5 text-danger">· {r.out} out</span> : r.low ? <span className="ml-1.5 text-warning">· {r.low} low</span> : null}</span> },
            { key: 'units', label: 'Units', align: 'right', sortable: false, render: (r) => <span className="tabular">{formatNumber(r.units)}</span> },
            { key: 'value', label: 'At cost', align: 'right', sortable: false, render: (r) => <span className="tabular">{money(r.value)}</span> },
          ]}
          rows={stock.map((r) => ({ ...r, id: r.category }))}
          empty="No products yet."
        />
      </Card>
    </Reveal>
  );
}
