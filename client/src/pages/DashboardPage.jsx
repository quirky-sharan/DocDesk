import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { PageHeader, ErrorNote, Badge, Money } from '../components/ui';

export default function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [sales, setSales] = useState([]);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sum, recentSales, queued] = await Promise.all([
        api.products.summary(),
        api.sales.list({ limit: 5, sort: 'created_at', dir: 'desc' }),
        api.messages.list({ status: 'queued', limit: 5 }),
      ]);
      setSummary(sum);
      setSales(recentSales.rows);
      setMessages(queued.rows);
      setError(null);
    } catch (err) {
      setError(err.message);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const isEmpty = summary && summary.total === 0 && sales.length === 0;
  const salesTotal = sales.reduce((sum, s) => sum + Number(s.total || 0), 0);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="How the shop is doing right now.">
        <button className="btn-secondary" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </PageHeader>

      <ErrorNote error={error} onDismiss={() => setError(null)} />

      {isEmpty && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-8 text-center">
          <p className="text-lg font-medium">Nothing here yet</p>
          <p className="mt-1 text-slate-500">
            Add your products one at a time, or drop in some sample data to look around first.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link className="btn-primary" to="/inventory">Add a product</Link>
            <button className="btn-secondary" onClick={addSampleData} disabled={busy}>
              {busy ? 'Adding…' : 'Use sample data'}
            </button>
          </div>
        </div>
      )}

      {summary && !isEmpty && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card label="Products" value={summary.total} to="/inventory" />
            <Card label="Low stock" value={summary.lowStock} tone="amber" to="/inventory" />
            <Card label="Out of stock" value={summary.outOfStock} tone="red" to="/inventory" />
            <Card label="Stock value" value={Number(summary.stockValue).toFixed(2)} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="card">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Needs restocking</h2>
                <Link className="text-sm text-blue-600 hover:underline" to="/orders">Order stock</Link>
              </div>
              {summary.needsAttention.length === 0 ? (
                <p className="text-slate-500">Everything is above its reorder level.</p>
              ) : (
                <ul className="space-y-2">
                  {summary.needsAttention.slice(0, 6).map((p) => (
                    <li key={p.id} className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0">
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-slate-500">Reorder at {p.reorder_level}</p>
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
                <Link className="text-sm text-blue-600 hover:underline" to="/sales">All sales</Link>
              </div>
              {sales.length === 0 ? (
                <p className="text-slate-500">No sales recorded yet.</p>
              ) : (
                <>
                  <ul className="space-y-2">
                    {sales.map((s) => (
                      <li key={s.id} className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0">
                        <div>
                          <p className="font-medium">{s.reference}</p>
                          <p className="text-xs text-slate-500">
                            {s.customer_name || 'Walk-in'} · {new Date(s.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <span className="font-medium"><Money value={s.total} /></span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-sm text-slate-500">
                    Last {sales.length} sales total <strong>{salesTotal.toFixed(2)}</strong>.
                  </p>
                </>
              )}
            </section>
          </div>

          {messages.length > 0 && (
            <section className="card mt-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Waiting to be sent</h2>
                <Link className="text-sm text-blue-600 hover:underline" to="/messages">View all</Link>
              </div>
              <ul className="space-y-2">
                {messages.map((m) => (
                  <li key={m.id} className="border-b border-slate-100 pb-2 last:border-0">
                    <p className="font-medium">{m.subject}</p>
                    <p className="text-xs text-slate-500">{m.body}</p>
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

function Card({ label, value, tone, to }) {
  const toneClass = tone === 'amber' ? 'text-amber-600' : tone === 'red' ? 'text-red-600' : '';
  const content = (
    <>
      <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
    </>
  );
  const className = 'block rounded-lg border border-slate-200 bg-white p-4';
  return to ? (
    <Link to={to} className={`${className} hover:border-slate-300`}>{content}</Link>
  ) : (
    <div className={className}>{content}</div>
  );
}
