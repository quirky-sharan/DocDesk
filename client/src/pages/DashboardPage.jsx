import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

const TABLE_LABELS = {
  products: 'Products',
  customers: 'Customers',
  sales: 'Sales',
  sale_items: 'Sale line items',
  suppliers: 'Suppliers',
  purchase_orders: 'Purchase orders',
  message_log: 'Queued messages',
};

export default function DashboardPage() {
  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, s] = await Promise.all([api.health(), api.stats()]);
      setHealth(h);
      setStats(s);
    } catch (err) {
      setError(err.message);
      setHealth(null);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runSampleAction(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const connected = Boolean(health);
  const hasRecords = stats
    ? Object.values(stats.counts).some((n) => n > 0)
    : false;

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-1 text-slate-500">
          Phase 1 checks that the browser, the API and the database are all talking.
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="font-semibold">Something went wrong</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}

      <section className="card mb-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Connection</h2>
          <button className="btn-secondary" onClick={load} disabled={loading || busy}>
            {loading ? 'Checking…' : 'Re-check'}
          </button>
        </div>

        <ul className="space-y-3">
          <StatusRow label="Web app" ok={true} detail="Running in your browser" />
          <StatusRow
            label="API server"
            ok={connected}
            detail={connected ? `Up for ${health.uptimeSeconds}s` : 'Not reachable'}
          />
          <StatusRow
            label="Database"
            ok={connected && health.database.connected}
            detail={
              connected
                ? `${health.database.driver} · ${health.database.tables} tables · ${health.database.latencyMs}ms`
                : 'Unknown'
            }
          />
        </ul>
      </section>

      <section className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Stored records</h2>
          <div className="flex gap-2">
            <button
              className="btn-primary"
              onClick={() => runSampleAction(api.seed)}
              disabled={busy || !connected || hasRecords}
              title={hasRecords ? 'Clear the existing records first' : undefined}
            >
              {busy ? 'Working…' : 'Add sample data'}
            </button>
            <button
              className="btn-danger"
              onClick={() => runSampleAction(api.clearSeed)}
              disabled={busy || !connected || !hasRecords}
            >
              Clear all
            </button>
          </div>
        </div>

        {stats ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Object.entries(stats.counts).map(([table, count]) => (
              <div key={table} className="rounded-lg border border-slate-200 p-4">
                <p className="text-2xl font-semibold">{count}</p>
                <p className="text-sm text-slate-500">{TABLE_LABELS[table] || table}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-500">{loading ? 'Loading…' : 'No data to show.'}</p>
        )}

        <p className="mt-4 text-sm text-slate-500">
          Numbers come straight from the database. Add sample data, then restart the
          server — the counts stay, which proves the data is really being saved.
        </p>
      </section>
    </div>
  );
}

function StatusRow({ label, ok, detail }) {
  return (
    <li className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <div className="flex items-center gap-3">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`}
        />
        <span className="font-medium">{label}</span>
      </div>
      <span className="text-sm text-slate-500">{detail}</span>
    </li>
  );
}
