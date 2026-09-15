import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, Archive, Database, Gauge, HeartPulse, LayoutDashboard, Network, Table2, TerminalSquare } from 'lucide-react';
import { api } from '../api/client';
import { Badge, ErrorNote, PageHeader, SegmentedControl } from '../components/ui';
import { useDataChanged } from '../hooks/useDataChanged';

const OverviewTab = lazy(() => import('../components/database/OverviewTab'));
const TablesTab = lazy(() => import('../components/database/TablesTab'));
const DiagramTab = lazy(() => import('../components/database/DiagramTab'));
const SqlTab = lazy(() => import('../components/database/SqlTab'));
const ActivityTab = lazy(() => import('../components/database/ActivityTab'));
const PerformanceTab = lazy(() => import('../components/database/PerformanceTab'));
const HealthTab = lazy(() => import('../components/database/HealthTab'));
const BackupsTab = lazy(() => import('../components/database/BackupsTab'));

const TABS = [
  ['overview', 'Overview', LayoutDashboard],
  ['tables', 'Tables', Table2],
  ['diagram', 'Diagram', Network],
  ['sql', 'SQL', TerminalSquare],
  ['activity', 'Activity', Activity],
  ['performance', 'Performance', Gauge],
  ['health', 'Health', HeartPulse],
  ['backups', 'Backups', Archive],
];

/**
 * The database console: what is stored and how it is shaped, a SQL workbench
 * with query plans, the audit trail, live performance, integrity checks and
 * backups - everything a database course asks you to be able to show, working
 * against the real data.
 */
export default function DatabasePage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'overview';
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.db
      .overview()
      .then((data) => {
        setOverview(data);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);
  useDataChanged(() => load());

  // Keeps other query parameters (a table name, a query) when switching tabs only if they belong to the new tab.
  const go = useCallback(
    (next, extra = {}) => {
      setParams({ tab: next, ...extra }, { replace: false });
    },
    [setParams]
  );

  const engine = overview?.engine;

  return (
    <div>
      <PageHeader
        title="Database"
        subtitle="Tables, relationships, queries, activity and backups - the engine behind DocDesk, open for inspection."
        eyebrow={engine ? `PostgreSQL ${engine.version}` : 'PostgreSQL'}
        icon={Database}
      >
        {engine && (
          <div className="flex items-center gap-2">
            <Badge tone={engine.mode === 'embedded' ? 'violet' : 'blue'} dot>{engine.mode === 'embedded' ? 'Embedded on this computer' : 'Hosted server'}</Badge>
            {overview.capabilities && !overview.capabilities.admin && <Badge tone="amber">Read-only console</Badge>}
          </div>
        )}
      </PageHeader>

      <ErrorNote error={error} onDismiss={() => setError(null)} />

      <div className="sticky top-16 z-20 -mx-2 mb-6 px-2 py-2">
        <div className="glass inline-flex max-w-full rounded-full" style={{ background: 'var(--glass-bg)' }}>
          <SegmentedControl value={tab} onChange={(next) => go(next)} options={TABS} ariaLabel="Database sections" />
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -6, filter: 'blur(4px)', transition: { duration: 0.14 } }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <Suspense fallback={<TabSkeleton />}>
            {tab === 'overview' && <OverviewTab overview={overview} onNavigate={go} reload={load} />}
            {tab === 'tables' && <TablesTab initialTable={params.get('table')} onNavigate={go} capabilities={overview?.capabilities} />}
            {tab === 'diagram' && <DiagramTab onNavigate={go} />}
            {tab === 'sql' && <SqlTab initialSql={params.get('sql')} capabilities={overview?.capabilities} />}
            {tab === 'activity' && <ActivityTab onNavigate={go} initialTable={params.get('table')} />}
            {tab === 'performance' && <PerformanceTab onNavigate={go} />}
            {tab === 'health' && <HealthTab capabilities={overview?.capabilities} />}
            {tab === 'backups' && <BackupsTab capabilities={overview?.capabilities} onRestored={load} />}
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function TabSkeleton() {
  return (
    <div className="space-y-4">
      <div className="skeleton h-40 rounded-[24px]" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="skeleton h-64 rounded-[24px]" />
        <div className="skeleton h-64 rounded-[24px]" />
      </div>
    </div>
  );
}
