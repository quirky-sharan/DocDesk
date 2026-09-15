import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, ErrorNote, Table, Money, Select } from '../components/ui';
import { AreaChart, HorizontalBars, ShareBar } from '../components/charts';

const RANGES = [
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 3 months'],
  ['365', 'Last year'],
];

export default function ReportsPage() {
  const [days, setDays] = useState('30');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showTable, setShowTable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summary, byDay, products, customers, categories, payments, stock] = await Promise.all([
        api.reports.summary({ days }),
        api.reports.salesByDay({ days }),
        api.reports.topProducts({ days, limit: 8 }),
        api.reports.topCustomers({ days, limit: 8 }),
        api.reports.byCategory({ days }),
        api.reports.byPaymentMethod({ days }),
        api.reports.stockByCategory(),
      ]);
      setData({ summary, series: byDay.series, products, customers, categories, payments, stock });
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

      {data && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Revenue" value={Number(data.summary.revenue).toFixed(2)} />
            <Stat label="Sales" value={data.summary.saleCount} />
            <Stat label="Average sale" value={Number(data.summary.averageSale).toFixed(2)} />
            <Stat
              label="Estimated profit"
              value={Number(data.summary.estimatedProfit).toFixed(2)}
              tone={data.summary.estimatedProfit >= 0 ? 'green' : 'red'}
            />
          </div>

          {data.summary.outstanding.count > 0 && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <strong>{data.summary.outstanding.count}</strong> sale
              {data.summary.outstanding.count === 1 ? '' : 's'} still unpaid, totalling{' '}
              <strong>{Number(data.summary.outstanding.amount).toFixed(2)}</strong>.
            </div>
          )}

          <section className="card mb-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Revenue per day</h2>
                <p className="text-sm text-slate-500">{data.summary.from} to {data.summary.to}</p>
              </div>
              {/* A table view alongside the chart, so the numbers are readable
                  without relying on hover or on seeing colour. */}
              <button className="btn-secondary" onClick={() => setShowTable(!showTable)}>
                {showTable ? 'Show chart' : 'Show as table'}
              </button>
            </div>

            {showTable ? (
              <div className="max-h-80 overflow-y-auto">
                <Table
                  columns={[
                    { key: 'day', label: 'Day' },
                    { key: 'saleCount', label: 'Sales', align: 'right' },
                    { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => <Money value={r.revenue} /> },
                  ]}
                  rows={[...data.series].reverse()}
                  empty="Nothing in this period."
                />
              </div>
            ) : (
              <AreaChart series={data.series} height={260} />
            )}
          </section>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="card">
              <h2 className="mb-1 text-lg font-semibold">Revenue by category</h2>
              <p className="mb-4 text-sm text-slate-500">Where the money actually comes from.</p>
              <HorizontalBars rows={data.categories} labelKey="category" valueKey="revenue" />
            </section>

            <section className="card">
              <h2 className="mb-1 text-lg font-semibold">How people paid</h2>
              <p className="mb-4 text-sm text-slate-500">Share of revenue in this period.</p>
              <ShareBar rows={data.payments} labelKey="method" valueKey="revenue" />
            </section>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="card">
              <h2 className="mb-4 text-lg font-semibold">Best sellers</h2>
              <HorizontalBars rows={data.products} labelKey="name" valueKey="revenue" />
              <Table
                columns={[
                  { key: 'name', label: 'Product' },
                  { key: 'quantity', label: 'Units sold', align: 'right' },
                  { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => <Money value={r.revenue} /> },
                ]}
                rows={data.products}
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
                rows={data.customers}
                empty="No named customers in this period."
              />
            </section>
          </div>

          <section className="card">
            <h2 className="mb-1 text-lg font-semibold">What your stock is worth</h2>
            <p className="mb-4 text-sm text-slate-500">
              At cost price, by category. This is current stock, not the period above.
            </p>
            <HorizontalBars
              rows={data.stock}
              labelKey="category"
              valueKey="value"
              color="var(--series-3)"
            />
            <Table
              columns={[
                { key: 'category', label: 'Category' },
                { key: 'products', label: 'Products', align: 'right' },
                { key: 'units', label: 'Units', align: 'right' },
                { key: 'value', label: 'Value at cost', align: 'right', render: (r) => <Money value={r.value} /> },
              ]}
              rows={data.stock}
              empty="No products yet."
            />
          </section>

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
