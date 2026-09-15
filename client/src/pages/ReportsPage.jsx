import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, ErrorNote, Table, Money, Select } from '../components/ui';

const RANGES = [
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 3 months'],
  ['365', 'Last year'],
];

export default function ReportsPage() {
  const [days, setDays] = useState('30');
  const [summary, setSummary] = useState(null);
  const [series, setSeries] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, byDay, top, best] = await Promise.all([
        api.reports.summary({ days }),
        api.reports.salesByDay({ days }),
        api.reports.topProducts({ days, limit: 10 }),
        api.reports.topCustomers({ days, limit: 10 }),
      ]);
      setSummary(s);
      setSeries(byDay.series);
      setProducts(top);
      setCustomers(best);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader title="Reports" subtitle="What sold, what it earned, who bought it.">
        <Select value={days} onChange={setDays} options={RANGES} />
      </PageHeader>

      <ErrorNote error={error} onDismiss={() => setError(null)} />
      {loading && <p className="mb-4 text-sm text-slate-400">Loading…</p>}

      {summary && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Revenue" value={Number(summary.revenue).toFixed(2)} />
            <Stat label="Sales" value={summary.saleCount} />
            <Stat label="Average sale" value={Number(summary.averageSale).toFixed(2)} />
            <Stat
              label="Estimated profit"
              value={Number(summary.estimatedProfit).toFixed(2)}
              tone={summary.estimatedProfit >= 0 ? 'green' : 'red'}
            />
          </div>

          {summary.outstanding.count > 0 && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <strong>{summary.outstanding.count}</strong> sale
              {summary.outstanding.count === 1 ? '' : 's'} still unpaid, totalling{' '}
              <strong>{Number(summary.outstanding.amount).toFixed(2)}</strong>.
            </div>
          )}

          <section className="card mb-6">
            <h2 className="mb-1 text-lg font-semibold">Revenue per day</h2>
            <p className="mb-4 text-sm text-slate-500">
              {summary.from} to {summary.to}
            </p>
            <BarChart series={series} />
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="card">
              <h2 className="mb-4 text-lg font-semibold">Best sellers</h2>
              <Table
                columns={[
                  { key: 'name', label: 'Product' },
                  { key: 'quantity', label: 'Sold', align: 'right' },
                  { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => <Money value={r.revenue} /> },
                ]}
                rows={products}
                empty="No sales in this period."
              />
            </section>

            <section className="card">
              <h2 className="mb-4 text-lg font-semibold">Top customers</h2>
              <Table
                columns={[
                  { key: 'name', label: 'Customer' },
                  { key: 'saleCount', label: 'Visits', align: 'right' },
                  { key: 'revenue', label: 'Spent', align: 'right', render: (r) => <Money value={r.revenue} /> },
                ]}
                rows={customers}
                empty="No named customers in this period."
              />
            </section>
          </div>

          <p className="mt-6 text-xs text-slate-400">
            Profit is an estimate: it uses each product's current cost price, so changing a
            cost also changes past figures.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  const toneClass = tone === 'green' ? 'text-green-600' : tone === 'red' ? 'text-red-600' : '';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}

// Plain divs rather than a charting library: one bar per day is not worth
// shipping a dependency for, and it keeps the bundle small.
function BarChart({ series }) {
  if (!series.length) return <p className="text-slate-500">Nothing to chart yet.</p>;
  const max = Math.max(...series.map((d) => d.revenue), 1);

  return (
    <div className="flex h-44 items-end gap-[2px] overflow-x-auto">
      {series.map((d) => (
        <div key={d.day} className="group relative flex min-w-[6px] flex-1 flex-col justify-end">
          <div
            className="rounded-t bg-teal-500/80 transition-colors group-hover:bg-teal-600"
            style={{ height: `${(d.revenue / max) * 100}%` }}
          />
          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white group-hover:block">
            {d.day}: {d.revenue.toFixed(2)} ({d.saleCount} sale{d.saleCount === 1 ? '' : 's'})
          </div>
        </div>
      ))}
    </div>
  );
}
