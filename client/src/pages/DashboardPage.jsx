import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useDataChanged } from '../hooks/useDataChanged';
import { PageHeader, ErrorNote, Badge, Money } from '../components/ui';
import { AreaChart, HorizontalBars, ShareBar, Sparkline } from '../components/charts';

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summary, pulse, byDay, sales, topProducts, payments, queued] = await Promise.all([
        api.products.summary(),
        api.reports.pulse(),
        api.reports.salesByDay({ days: 30 }),
        api.sales.list({ pageSize: 5, sort: 'created_at', dir: 'desc' }),
        api.reports.topProducts({ days: 30, limit: 5 }),
        api.reports.byPaymentMethod({ days: 30 }),
        api.messages.list({ status: 'queued', pageSize: 4 }),
      ]);
      setData({ summary, pulse, series: byDay.series, sales: sales.rows, topProducts, payments, queued: queued.rows, queuedTotal: queued.total });
      setError(null);
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Changes made through the assistant should show up here without a reload.
  useDataChanged(() => load());

  async function addSampleData() {
    setBusy(true);
    try {
      await api.seed();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const isEmpty = data && data.summary.total === 0 && data.sales.length === 0;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="How the shop is doing right now.">
        <Link className="btn-secondary" to="/reports">Full reports</Link>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </PageHeader>

      <ErrorNote error={error} onDismiss={() => setError(null)} />

      {isEmpty && (
        <div className="rounded-xl border border-token bg-surface p-8 text-center">
          <p className="text-lg font-medium">Nothing here yet</p>
          <p className="mt-1 muted">
            Add your products one at a time, import a spreadsheet, or drop in some sample data
            to look around first.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link className="btn-primary" to="/inventory">Add a product</Link>
            <button className="btn-secondary" onClick={addSampleData} disabled={busy}>
              {busy ? 'Adding…' : 'Use sample data'}
            </button>
          </div>
        </div>
      )}

      {data && !isEmpty && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <PulseCard
              label="Today"
              value={data.pulse.today.revenue}
              meta={`${data.pulse.today.saleCount} sale${data.pulse.today.saleCount === 1 ? '' : 's'}`}
              change={data.pulse.dayChangePercent}
              changeLabel="vs yesterday"
            />
            <PulseCard
              label="Last 7 days"
              value={data.pulse.thisWeek.revenue}
              meta={`${data.pulse.thisWeek.saleCount} sales`}
              change={data.pulse.weekChangePercent}
              changeLabel="vs week before"
              spark={data.series.slice(-7).map((d) => d.revenue)}
            />
            <StatCard label="Needs restocking" value={data.summary.lowStock + data.summary.outOfStock}
                      meta={`${data.summary.outOfStock} out of stock`} to="/inventory"
                      tone={data.summary.outOfStock > 0 ? 'red' : 'amber'} />
            <StatCard label="Stock value" value={Number(data.summary.stockValue).toFixed(2)}
                      meta={`${data.summary.total} products`} to="/inventory" />
          </div>

          <section className="card mb-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Revenue, last 30 days</h2>
                <p className="text-sm muted">Hover the chart to read any day.</p>
              </div>
              <Link className="text-sm link hover:underline" to="/reports">Reports</Link>
            </div>
            <AreaChart series={data.series} height={230} />
          </section>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="card">
              <h2 className="mb-4 text-lg font-semibold">Best sellers this month</h2>
              <HorizontalBars
                rows={data.topProducts}
                labelKey="name"
                valueKey="revenue"
              />
            </section>

            <section className="card">
              <h2 className="mb-1 text-lg font-semibold">How people paid</h2>
              <p className="mb-4 text-sm muted">Share of revenue, last 30 days.</p>
              <ShareBar rows={data.payments} labelKey="method" valueKey="revenue" />
            </section>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="card">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Needs restocking</h2>
                <Link className="text-sm link hover:underline" to="/orders">Order stock</Link>
              </div>
              {data.summary.needsAttention.length === 0 ? (
                <p className="muted">Everything is above its reorder level.</p>
              ) : (
                <ul className="space-y-2">
                  {data.summary.needsAttention.slice(0, 6).map((p) => (
                    <li key={p.id} className="flex items-center justify-between border-b border-token pb-2 last:border-0">
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs muted">Reorder at {p.reorder_level}</p>
                      </div>
                      <Badge tone={p.stock_quantity <= 0 ? 'red' : 'amber'}>
                        {p.stock_quantity <= 0 ? 'Out of stock' : `${p.stock_quantity} left`}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Latest sales</h2>
                <Link className="text-sm link hover:underline" to="/sales">All sales</Link>
              </div>
              {data.sales.length === 0 ? (
                <p className="muted">No sales recorded yet.</p>
              ) : (
                <ul className="space-y-2">
                  {data.sales.map((s) => (
                    <li key={s.id} className="flex items-center justify-between border-b border-token pb-2 last:border-0">
                      <div>
                        <p className="font-medium">{s.reference}</p>
                        <p className="text-xs muted">
                          {s.customer_name || 'Walk-in'} · {new Date(s.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="font-medium"><Money value={s.total} /></span>
                        {s.payment_status !== 'paid' && (
                          <div className="mt-0.5">
                            <Badge tone={s.payment_status === 'unpaid' ? 'red' : 'amber'}>
                              {s.payment_status}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {data.queued.length > 0 && (
            <section className="card mt-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  Waiting to be sent
                  <span className="ml-2 text-sm font-normal muted">{data.queuedTotal}</span>
                </h2>
                <Link className="text-sm link hover:underline" to="/messages">View all</Link>
              </div>
              <ul className="space-y-2">
                {data.queued.map((m) => (
                  <li key={m.id} className="border-b border-token pb-2 last:border-0">
                    <p className="font-medium">{m.subject}</p>
                    <p className="text-xs muted">{m.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function PulseCard({ label, value, meta, change, changeLabel, spark }) {
  const up = change > 0;
  const flat = change === 0;
  return (
    <div className="rounded-lg border border-token bg-surface p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-2xl font-semibold">{Number(value).toFixed(2)}</p>
          <p className="text-sm muted">{label}</p>
        </div>
        {spark && <Sparkline values={spark} width={72} height={28} />}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {/* Arrow plus sign, so direction is not carried by colour alone. */}
        <span className={flat ? 'muted' : up ? 'text-success' : 'text-danger'}>
          {flat ? '—' : up ? '▲' : '▼'} {Math.abs(change)}%
        </span>
        <span className="subtle">{changeLabel}</span>
        <span className="ml-auto subtle">{meta}</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, meta, tone, to }) {
  const toneClass = tone === 'red' ? 'text-danger' : tone === 'amber' ? 'text-warning' : '';
  const body = (
    <>
      <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
      <p className="text-sm muted">{label}</p>
      <p className="mt-2 text-xs subtle">{meta}</p>
    </>
  );
  return to ? (
    <Link to={to} className="block rounded-lg border border-token bg-surface p-4 hover:border-token-strong">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-token bg-surface p-4">{body}</div>
  );
}
