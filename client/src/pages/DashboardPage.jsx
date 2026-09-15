import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowRight, ArrowUpRight, Bot, CircleDollarSign, Database, FileSpreadsheet, History, Package, PackagePlus,
  Receipt, RefreshCw, Sparkles, TrendingUp, Truck, Upload, UserRound, Wallet,
} from 'lucide-react';
import { api } from '../api/client';
import { useDataChanged } from '../hooks/useDataChanged';
import { useTheme } from '../hooks/useTheme';
import { useSettings } from '../lib/settings';
import { useAssistant } from '../assistant/AssistantProvider';
import { Avatar, Badge, Button, Card, CardHeader, ErrorNote, SegmentedControl, useToast } from '../components/ui';
import { AreaChart, ColumnChart, HorizontalBars, Meter, Rings, RingsLegend, ShareBar, StatTile } from '../components/charts';
import { Reveal, RevealGroup, RevealItem } from '../components/motion/Reveal';
import CountUp from '../components/motion/CountUp';
import Scene3D from '../components/three/Scene3D';
import AppIcon from '../components/shell/AppIcon';
import { formatDate, formatRelative, greeting } from '../lib/format';
import { EASE_OUT } from '../lib/motion';

const loadSkyline = () => import('../components/three/RevenueSkyline3D');

const STATUS_TONE = { paid: 'green', unpaid: 'red', partial: 'amber', refunded: 'slate' };
const STATUS_LABEL = { paid: 'Paid', unpaid: 'Unpaid', partial: 'Part paid', refunded: 'Refunded' };

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('30');
  const [series, setSeries] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summary, pulse, byDay, sales, topProducts, payments, report, activity] = await Promise.all([
        api.products.summary(),
        api.reports.pulse(),
        api.reports.salesByDay({ days: 30 }),
        api.sales.list({ pageSize: 6, sort: 'created_at', dir: 'desc' }),
        api.reports.topProducts({ days: 30, limit: 6 }),
        api.reports.byPaymentMethod({ days: 30 }),
        api.reports.summary({ days: 7 }),
        api.db.activity({ pageSize: 7 }).catch(() => ({ rows: [] })),
      ]);
      setData({ summary, pulse, byDay: byDay.series, sales: sales.rows, salesTotal: sales.total, topProducts, payments, report, activity: activity.rows });
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (range === '30') {
      setSeries(null);
      return;
    }
    api.reports.salesByDay({ days: range }).then((d) => setSeries(d.series)).catch(() => {});
  }, [range]);

  // Changes made through the assistant show up here without a reload.
  useDataChanged(() => load());

  const isEmpty = data && data.summary.total === 0 && data.salesTotal === 0;

  return (
    <div>
      <Hero data={data} loading={loading} onRefresh={load} />
      <ErrorNote error={error} onDismiss={() => setError(null)} />

      {!data && loading && <DashboardSkeleton />}
      {isEmpty && <Welcome onLoaded={load} />}

      {data && !isEmpty && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <SkylineCard data={data} className="xl:col-span-8" />
            <TodayCard data={data} className="xl:col-span-4" />
          </div>

          <KpiRow data={data} />

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <Reveal className="xl:col-span-8">
              <Card className="h-full">
                <CardHeader
                  title="Revenue"
                  subtitle="Takings per day. Hover or use the arrow keys to read a day."
                  icon={TrendingUp}
                  action={<SegmentedControl size="sm" value={range} onChange={setRange} options={[['7', '7 days'], ['30', '30 days'], ['90', '90 days']]} ariaLabel="Period" />}
                />
                <RevenueArea series={series || data.byDay} />
              </Card>
            </Reveal>
            <Reveal className="xl:col-span-4" delay={0.05}>
              <PaymentsCard payments={data.payments} />
            </Reveal>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Reveal>
              <BestSellers rows={data.topProducts} />
            </Reveal>
            <Reveal delay={0.05}>
              <LatestSales sales={data.sales} />
            </Reveal>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Reveal>
              <RestockCard summary={data.summary} />
            </Reveal>
            <Reveal delay={0.05}>
              <ActivityCard activity={data.activity} />
            </Reveal>
          </div>
        </div>
      )}
    </div>
  );
}

function Hero({ data, loading, onRefresh }) {
  const { businessName, compactMoney } = useSettings();
  const assistant = useAssistant();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const sentence = useMemo(() => {
    if (!data) return 'Pulling together how the shop is doing…';
    const parts = [];
    const week = data.pulse.weekChangePercent;
    if (data.pulse.thisWeek.saleCount === 0) parts.push('No sales in the last seven days yet.');
    else if (week > 0) parts.push(`Sales are up ${week}% on the week before.`);
    else if (week < 0) parts.push(`Sales are down ${Math.abs(week)}% on the week before.`);
    else parts.push('Sales are level with the week before.');
    const restock = data.summary.lowStock + data.summary.outOfStock;
    if (restock) parts.push(`${restock} item${restock === 1 ? ' needs' : 's need'} restocking`);
    if (data.report.outstanding.count) {
      parts.push(`${restock ? 'and ' : ''}${compactMoney(data.report.outstanding.amount)} is still owed.`);
    } else if (restock) {
      parts[parts.length - 1] += '.';
    }
    return parts.join(' ');
  }, [data, compactMoney]);

  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-6 pt-2">
      <div className="min-w-0">
        <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE_OUT }} className="mb-2 text-[13px] font-medium text-accent-ink">
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 12, filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.8, ease: EASE_OUT }}
          className="text-[32px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[42px]"
        >
          {greeting(now)},{' '}
          <span className="bg-gradient-to-r from-[#0a84ff] via-[#5e5ce6] to-[#bf5af2] bg-clip-text text-transparent">{businessName}</span>
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1, ease: EASE_OUT }} className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-ink-2">
          {sentence}
        </motion.p>
      </div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15, ease: EASE_OUT }} className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" icon={RefreshCw} onClick={onRefresh} loading={loading} aria-label="Refresh" />
        <Button variant="secondary" icon={Sparkles} onClick={() => assistant.setOpen(true)}>Ask DocDesk</Button>
        <Link to="/sales?new=1" className="btn-primary">
          <Receipt size={16} /> New sale
        </Link>
      </motion.div>
    </header>
  );
}

function SkylineCard({ data, className }) {
  const { isDark } = useTheme();
  const { money, compactMoney } = useSettings();
  const days = data.byDay.slice(-21);
  const sceneData = days.map((d) => ({ key: d.day, value: d.revenue, sales: d.saleCount }));
  const week = data.pulse.thisWeek;

  return (
    <Reveal className={className}>
      <div
        className="relative h-full overflow-hidden rounded-[26px]"
        style={{
          background: isDark
            ? 'radial-gradient(120% 90% at 20% 0%, rgb(10 132 255 / 0.18), transparent 60%), radial-gradient(90% 80% at 100% 100%, rgb(191 90 242 / 0.14), transparent 60%), rgb(var(--c-surface))'
            : 'radial-gradient(120% 90% at 15% 0%, rgb(10 132 255 / 0.1), transparent 60%), radial-gradient(90% 80% at 100% 100%, rgb(191 90 242 / 0.08), transparent 60%), rgb(var(--c-surface))',
          boxShadow: '0 0 0 1px var(--line), var(--shadow-md), var(--edge-highlight)',
        }}
      >
        <div className="pointer-events-none absolute left-6 top-6 z-10 sm:left-7 sm:top-7">
          <p className="text-[13px] font-medium text-ink-2">Last 7 days</p>
          <p className="mt-1 text-[40px] font-semibold leading-none tracking-[-0.04em] text-ink">
            <CountUp value={week.revenue} format={(n) => money(n)} />
          </p>
          <div className="mt-2.5 flex items-center gap-2 text-[12.5px]">
            <DeltaChip value={data.pulse.weekChangePercent} />
            <span className="text-ink-3">vs the week before · {week.saleCount} sales</span>
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-5 left-7 z-10 hidden text-[12px] text-ink-3 sm:block">Each column is a day - drag to turn, hover to read</div>
        <Scene3D
          load={loadSkyline}
          height={360}
          data={sceneData}
          dark={isDark}
          formatValue={(v) => compactMoney(v)}
          formatLabel={(d) => `${formatDate(d.key, { weekday: 'short', day: 'numeric', month: 'short' })} · ${d.sales} sales`}
          fallback={
            <div className="absolute inset-x-6 bottom-6 top-36">
              <ColumnChart data={days} valueKey="revenue" labelKey="day" height={180} formatLabel={(l) => formatDate(l, { day: 'numeric' })} formatTitle={(l) => formatDate(l, { weekday: 'short', day: 'numeric', month: 'short' })} formatValue={(v) => money(v)} />
            </div>
          }
        />
      </div>
    </Reveal>
  );
}

function DeltaChip({ value }) {
  const up = value > 0;
  const flat = value === 0;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold tabular"
      style={{
        background: flat ? 'var(--wash-strong)' : up ? 'var(--success-soft)' : 'var(--danger-soft)',
        color: flat ? 'rgb(var(--c-text-2))' : up ? 'rgb(var(--c-success))' : 'rgb(var(--c-danger))',
      }}
    >
      <ArrowUpRight size={13} strokeWidth={2.6} style={{ transform: flat ? 'rotate(45deg)' : up ? 'none' : 'rotate(90deg)' }} />
      {Math.abs(value)}%
    </span>
  );
}

function TodayCard({ data, className }) {
  const { money, compactMoney } = useSettings();
  const { today, averageDay } = data.pulse;
  const inStock = data.summary.total ? Math.round((data.summary.inStock / data.summary.total) * 100) : 0;
  const rings = [
    { key: 'revenue', label: 'Takings vs a usual day', value: today.revenue, target: Math.max(averageDay.revenue, 1), color: 'var(--series-1)', display: compactMoney(today.revenue), targetDisplay: `of ${compactMoney(averageDay.revenue)}` },
    { key: 'sales', label: 'Sales vs a usual day', value: today.saleCount, target: Math.max(averageDay.saleCount, 1), color: 'var(--series-2)', display: today.saleCount, targetDisplay: `of ${averageDay.saleCount}` },
    { key: 'stock', label: 'Products in stock', value: data.summary.inStock, target: Math.max(data.summary.total, 1), color: 'var(--series-3)', display: `${inStock}%`, targetDisplay: `${data.summary.inStock} of ${data.summary.total}` },
  ];

  return (
    <Reveal className={className} delay={0.06}>
      <Card className="flex h-full flex-col">
        <CardHeader title="Today" subtitle="Against the average of the last 28 days." />
        <div className="flex flex-1 flex-col items-center gap-6 sm:flex-row xl:flex-col 2xl:flex-row">
          <Rings rings={rings} size={176}>
            <div>
              <p className="text-[11px] font-medium text-ink-3">Today</p>
              <p className="text-[19px] font-semibold tracking-[-0.03em] text-ink tabular">{money(today.revenue)}</p>
            </div>
          </Rings>
          <RingsLegend rings={rings} />
        </div>
      </Card>
    </Reveal>
  );
}

function KpiRow({ data }) {
  const navigate = useNavigate();
  const { money, compactMoney } = useSettings();
  const { pulse, summary, byDay, report } = data;
  const restock = summary.lowStock + summary.outOfStock;
  const last14 = byDay.slice(-14).map((d) => d.revenue);

  return (
    <RevealGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" gap={0.07}>
      <RevealItem>
        <StatTile label="Today" icon={CircleDollarSign} value={pulse.today.revenue} format={(n) => money(n)} delta={pulse.dayChangePercent} deltaLabel="vs yesterday" spark={byDay.slice(-7).map((d) => d.revenue)} onClick={() => navigate('/sales')} />
      </RevealItem>
      <RevealItem>
        <StatTile label="Last 7 days" icon={TrendingUp} value={pulse.thisWeek.revenue} format={(n) => compactMoney(n)} delta={pulse.weekChangePercent} deltaLabel="vs week before" spark={last14} sparkColor="var(--series-3)" onClick={() => navigate('/reports')} />
      </RevealItem>
      <RevealItem>
        <StatTile label="Needs restocking" icon={Package} value={restock} tone={summary.outOfStock ? 'red' : restock ? 'amber' : undefined} footnote={`${summary.outOfStock} out of stock`} onClick={() => navigate('/inventory')} />
      </RevealItem>
      <RevealItem>
        <StatTile label="Owed to you" icon={Wallet} value={report.outstanding.amount} format={(n) => compactMoney(n)} tone={report.outstanding.count ? 'amber' : undefined} footnote={`${report.outstanding.count} unpaid sale${report.outstanding.count === 1 ? '' : 's'}`} onClick={() => navigate('/sales?status=unpaid')} />
      </RevealItem>
    </RevealGroup>
  );
}

function RevenueArea({ series }) {
  const { money, compactMoney } = useSettings();
  return (
    <AreaChart
      data={series}
      valueKey="revenue"
      labelKey="day"
      height={270}
      title="Revenue per day"
      formatValue={(v) => money(v)}
      formatAxis={(v) => compactMoney(v)}
      extraRows={(d) => [{ value: `${d.saleCount}`, label: d.saleCount === 1 ? 'sale' : 'sales' }]}
    />
  );
}

const METHOD_NAMES = { cash: 'Cash', card: 'Card', upi: 'UPI', bank: 'Bank transfer', other: 'Other' };

function PaymentsCard({ payments }) {
  const { compactMoney } = useSettings();
  const total = payments.reduce((s, p) => s + p.revenue, 0);
  return (
    <Card className="h-full">
      <CardHeader title="How money came in" subtitle="Payments received, last 30 days." icon={Wallet} />
      <p className="mb-5 text-[30px] font-semibold tracking-[-0.035em]">
        <CountUp value={total} format={(n) => compactMoney(n)} />
      </p>
      <ShareBar rows={payments.map((p) => ({ ...p, method: METHOD_NAMES[p.method] || p.method }))} labelKey="method" valueKey="revenue" formatValue={(v) => compactMoney(v)} />
    </Card>
  );
}

function BestSellers({ rows }) {
  const { compactMoney } = useSettings();
  const navigate = useNavigate();
  return (
    <Card className="h-full">
      <CardHeader title="Best sellers" subtitle="By revenue, last 30 days." icon={TrendingUp} action={<Link to="/reports" className="text-[13px] font-medium text-accent-ink hover:underline">Reports</Link>} />
      <HorizontalBars
        rows={rows}
        labelKey="name"
        valueKey="revenue"
        formatValue={(v) => compactMoney(v)}
        meta={(r) => `${r.quantity} sold`}
        onSelect={(r) => r.productId && navigate(`/inventory?view=${r.productId}`)}
      />
    </Card>
  );
}

function LatestSales({ sales }) {
  const { money } = useSettings();
  return (
    <Card className="h-full" padded={false}>
      <div className="p-6 pb-3">
        <CardHeader className="mb-0" title="Latest sales" icon={Receipt} action={<Link to="/sales" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-ink hover:underline">All sales <ArrowRight size={13} /></Link>} />
      </div>
      <ul className="px-3 pb-3">
        {sales.length === 0 && <li className="px-3 py-8 text-center text-[13.5px] text-ink-3">No sales yet.</li>}
        {sales.map((s, i) => (
          <motion.li key={s.id} initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05, duration: 0.45, ease: EASE_OUT }}>
            <Link to={`/sales?receipt=${s.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-[var(--wash)]">
              {s.customer_name ? <Avatar name={s.customer_name} size={36} /> : (
                <span className="grid h-9 w-9 place-items-center rounded-full" style={{ background: 'var(--wash-strong)' }}>
                  <UserRound size={16} className="text-ink-3" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{s.customer_name || 'Walk-in customer'}</p>
                <p className="text-[12px] text-ink-3">{s.reference} · {formatRelative(s.created_at)}</p>
              </div>
              <div className="text-right">
                <p className="text-[14px] font-semibold tabular">{money(s.total)}</p>
                {s.payment_status !== 'paid' && <Badge tone={STATUS_TONE[s.payment_status]} dot className="mt-0.5">{STATUS_LABEL[s.payment_status]}</Badge>}
              </div>
            </Link>
          </motion.li>
        ))}
      </ul>
    </Card>
  );
}

function RestockCard({ summary }) {
  const items = summary.needsAttention.slice(0, 6);
  return (
    <Card className="h-full" padded={false}>
      <div className="p-6 pb-3">
        <CardHeader className="mb-0" title="Needs restocking" subtitle={`${summary.lowStock} running low · ${summary.outOfStock} out of stock`} icon={Package} action={<Link to="/orders?restock=1" className="btn-secondary btn-sm"><Truck size={14} /> Order stock</Link>} />
      </div>
      {items.length === 0 ? (
        <p className="px-6 pb-8 pt-2 text-[13.5px] text-ink-3">Everything is above its reorder level.</p>
      ) : (
        <ul className="px-3 pb-3">
          {items.map((p) => (
            <li key={p.id}>
              <Link to={`/inventory?view=${p.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-[var(--wash)]">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{p.name}</p>
                  <p className="text-[12px] text-ink-3">{p.category || 'No category'} · reorder at {Number(p.reorder_level)}</p>
                </div>
                <Meter value={Number(p.stock_quantity)} max={Number(p.reorder_level) * 2} marker={Number(p.reorder_level)} width={64} />
                <Badge tone={p.stock_status === 'out' ? 'red' : 'amber'} icon>{p.stock_status === 'out' ? 'Out' : `${Number(p.stock_quantity)} left`}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const ACTOR = {
  web: { label: 'You', icon: UserRound },
  assistant: { label: 'Assistant', icon: Bot },
  'sql-console': { label: 'SQL console', icon: Database },
  import: { label: 'Import', icon: Upload },
  restore: { label: 'Restore', icon: History },
};
const TABLE_NAMES = { products: 'product', customers: 'customer', suppliers: 'supplier', sales: 'sale', payments: 'payment', purchase_orders: 'order', settings: 'setting', files: 'file', categories: 'category' };

function describeActivity(entry) {
  const record = entry.new_data || entry.old_data || {};
  const name = record.name || record.reference || record.original_name || record.key || (entry.table_name === 'payments' ? `${record.amount}` : `#${entry.record_id}`);
  const noun = TABLE_NAMES[entry.table_name] || entry.table_name;
  if (entry.action === 'INSERT') return `Added ${noun} ${name}`;
  if (entry.action === 'DELETE') return `Deleted ${noun} ${name}`;
  const fields = (entry.changed_fields || []).map((f) => f.replace(/_/g, ' ')).slice(0, 3).join(', ');
  return `Changed ${fields || 'details'} on ${name}`;
}

function ActivityCard({ activity }) {
  return (
    <Card className="h-full" padded={false}>
      <div className="p-6 pb-3">
        <CardHeader className="mb-0" title="Recent activity" subtitle="Every change is recorded by the database." icon={History} action={<Link to="/database?tab=activity" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-ink hover:underline">Activity log <ArrowRight size={13} /></Link>} />
      </div>
      {activity.length === 0 ? (
        <p className="px-6 pb-8 pt-2 text-[13.5px] text-ink-3">Changes you and the assistant make will appear here.</p>
      ) : (
        <ol className="relative px-6 pb-5">
          <span className="absolute bottom-7 left-[39px] top-3 w-px" style={{ background: 'var(--line)' }} aria-hidden="true" />
          {activity.map((entry, i) => {
            const actor = ACTOR[entry.actor] || { label: entry.actor, icon: Sparkles };
            const Icon = actor.icon;
            return (
              <motion.li key={entry.id} initial={{ opacity: 0, y: 6 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }} className="relative flex gap-3 py-2">
                <span className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: 'rgb(var(--c-surface))', boxShadow: '0 0 0 1px var(--line)' }}>
                  <Icon size={13} className="text-ink-2" />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="truncate text-[13.5px]">{describeActivity(entry)}</p>
                  <p className="text-[11.5px] text-ink-3">{actor.label} · {formatRelative(entry.created_at)}</p>
                </div>
              </motion.li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function Welcome({ onLoaded }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function addSampleData() {
    setBusy(true);
    try {
      const result = await api.seed();
      toast.success('Sample data loaded', { description: `${result.inserted.sales} sales across five months` });
      await onLoaded();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Reveal>
      <div className="relative overflow-hidden rounded-[32px] px-6 py-14 text-center sm:px-12" style={{ background: 'radial-gradient(80% 70% at 50% 0%, rgb(10 132 255 / 0.12), transparent 70%), rgb(var(--c-surface))', boxShadow: '0 0 0 1px var(--line), var(--shadow-md)' }}>
        <motion.div className="mx-auto mb-7 w-fit" animate={{ y: [0, -10, 0], rotate: [0, -3, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}>
          <AppIcon size={96} />
        </motion.div>
        <h2 className="text-[30px] font-semibold tracking-[-0.03em]">Welcome to DocDesk</h2>
        <p className="mx-auto mt-2 max-w-lg text-[15px] leading-relaxed text-ink-2">
          Your products, sales, customers and stock in one calm place. Add your own, bring over a spreadsheet, or load five months of sample trading to look around first.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Button size="lg" icon={Sparkles} onClick={addSampleData} loading={busy}>{busy ? 'Building sample data…' : 'Use sample data'}</Button>
          <Link to="/inventory?new=1" className="btn-secondary btn-lg"><PackagePlus size={18} /> Add a product</Link>
          <Link to="/inventory?import=1" className="btn-secondary btn-lg"><FileSpreadsheet size={18} /> Import a spreadsheet</Link>
        </div>
      </div>
    </Reveal>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="skeleton h-[360px] rounded-[26px] xl:col-span-8" />
        <div className="skeleton h-[360px] rounded-[26px] xl:col-span-4" />
      </div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[132px] rounded-[22px]" />)}
      </div>
      <div className="skeleton h-[340px] rounded-[26px]" />
    </div>
  );
}
