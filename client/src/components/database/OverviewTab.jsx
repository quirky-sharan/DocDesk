import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight, Boxes, CheckCircle2, Cpu, Database, FileCode2, FunctionSquare, GitCommitVertical, HardDrive, KeyRound, Link2, ListTree,
  Lock, Puzzle, ScanEye, ShieldCheck, Table2, Zap,
} from 'lucide-react';
import { api } from '../../api/client';
import { useTheme } from '../../hooks/useTheme';
import { Badge, Card, CardHeader } from '../ui';
import { ColumnChart, HorizontalBars } from '../charts';
import { Reveal, RevealGroup, RevealItem } from '../motion/Reveal';
import CountUp from '../motion/CountUp';
import Scene3D from '../three/Scene3D';
import { formatBytes, formatDateTime, formatNumber, formatRelative } from '../../lib/format';

const loadCore = () => import('../three/DatabaseCore3D');

export default function OverviewTab({ overview, onNavigate }) {
  const { isDark } = useTheme();
  const [live, setLive] = useState(null);

  // A light poll so the pulse chart and the 3D core react to what the app is doing.
  useEffect(() => {
    let alive = true;
    const tick = () => api.db.performance().then((p) => alive && setLive(p.queries)).catch(() => {});
    tick();
    const timer = setInterval(() => document.visibilityState === 'visible' && tick(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const perf = live || overview?.performance;
  const recentCount = useMemo(() => (perf?.timeline || []).slice(-6).reduce((s, b) => s + b.count, 0), [perf]);

  if (!overview) return <div className="skeleton h-[420px] rounded-[28px]" />;
  const { engine, database, objects, extensions, migrations, tables, activity, capabilities } = overview;

  const objectTiles = [
    ['Tables', objects.tables, Table2, 'tables'],
    ['Views', objects.views, ScanEye, 'sql'],
    ['Indexes', objects.indexes, ListTree, 'performance'],
    ['Triggers', objects.triggers, Zap, 'tables'],
    ['Functions', objects.functions, FunctionSquare, 'sql'],
    ['Constraints', objects.constraints, Lock, 'health'],
    ['Foreign keys', objects.foreignKeys, Link2, 'diagram'],
  ];

  return (
    <div className="space-y-6">
      <Reveal>
        <section className="relative overflow-hidden rounded-[28px]" style={{ background: isDark ? 'radial-gradient(120% 140% at 85% 30%, rgb(94 92 230 / 0.28), transparent 55%), rgb(var(--c-surface))' : 'radial-gradient(120% 140% at 85% 30%, rgb(94 92 230 / 0.14), transparent 55%), rgb(var(--c-surface))', boxShadow: '0 0 0 1px var(--line), var(--shadow-md), var(--edge-highlight)' }}>
          <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
            <div className="relative z-10 p-7 sm:p-9">
              <p className="mb-3 inline-flex items-center gap-2 text-[13px] font-medium text-ink-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[rgb(var(--c-success))] opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[rgb(var(--c-success))]" />
                </span>
                Online · started {formatRelative(engine.startedAt)}
              </p>
              <h2 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[44px]">
                <CountUp value={overview.totalRows} format={(n) => formatNumber(Math.round(n))} />
                <span className="text-ink-3"> rows</span>
              </h2>
              <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-2">
                in {objects.tables} tables, taking {formatBytes(database.sizeBytes)} on disk. {engine.engine} {database.version}, {database.encoding}.
              </p>
              <div className="mt-6 grid max-w-md grid-cols-3 gap-3">
                <HeroStat label="Queries" value={perf?.total ?? 0} hint="since start" />
                <HeroStat label="Median" value={perf?.p50Ms ?? 0} unit="ms" hint="per query" />
                <HeroStat label="Changes" value={activity.changesToday} hint="today" />
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                <button type="button" className="btn-primary" onClick={() => onNavigate('sql')}>Open SQL console <ArrowRight size={15} /></button>
                <button type="button" className="btn-secondary" onClick={() => onNavigate('diagram')}>See the diagram</button>
              </div>
              <p className="mt-5 flex items-center gap-1.5 truncate text-[12px] text-ink-3">
                <HardDrive size={12} className="shrink-0" /> <span className="truncate">{engine.location}</span>
              </p>
            </div>
            <div className="relative min-h-[300px]">
              <Scene3D load={loadCore} height="100%" className="absolute inset-0 min-h-[300px]" dark={isDark} activity={recentCount} fallback={<CoreFallback />} />
              <p className="pointer-events-none absolute bottom-4 right-6 text-[11.5px] text-ink-3">Glows brighter as queries run · drag to turn</p>
            </div>
          </div>
        </section>
      </Reveal>

      <RevealGroup className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {objectTiles.map(([label, value, Icon, target]) => (
          <RevealItem key={label}>
            <motion.button type="button" whileHover={{ y: -3 }} whileTap={{ scale: 0.97 }} onClick={() => onNavigate(target)} className="card-hover panel flex w-full flex-col items-start gap-3 p-4 text-left">
              <span className="grid h-8 w-8 place-items-center rounded-[10px]" style={{ background: 'var(--accent-soft)', color: 'rgb(var(--c-accent-text))' }}><Icon size={16} /></span>
              <div>
                <p className="text-[24px] font-semibold leading-none tracking-[-0.03em] tabular"><CountUp value={value} format={(n) => Math.round(n)} /></p>
                <p className="mt-1 text-[12.5px] text-ink-2">{label}</p>
              </div>
            </motion.button>
          </RevealItem>
        ))}
      </RevealGroup>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_1fr]">
        <Reveal>
          <Card className="h-full">
            <CardHeader title="Where the space goes" subtitle="Each table's data and indexes, largest first." icon={Boxes} action={<button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate('tables')}>Browse</button>} />
            <HorizontalBars
              rows={[...tables].sort((a, b) => b.totalBytes - a.totalBytes)}
              labelKey="name"
              valueKey="totalBytes"
              formatValue={formatBytes}
              meta={(t) => `${formatNumber(t.rows)} rows · ${t.indexes} index${t.indexes === 1 ? '' : 'es'}`}
              onSelect={(t) => onNavigate('tables', { table: t.name })}
              limit={10}
            />
          </Card>
        </Reveal>

        <Reveal delay={0.05}>
          <Card className="h-full">
            <CardHeader title="Query pulse" subtitle="Queries per 5 seconds over the last six minutes." icon={Cpu} action={<Badge tone="green" dot>Live</Badge>} />
            <ColumnChart
              data={(perf?.timeline || []).map((b) => ({ ...b, label: b.at }))}
              valueKey="count"
              labelKey="label"
              height={200}
              formatValue={(v) => `${v} quer${v === 1 ? 'y' : 'ies'}`}
              formatLabel={() => ''}
              formatTitle={(at) => new Date(at).toLocaleTimeString()}
              extraRows={(b) => [{ value: `${b.avgMs} ms`, label: 'average' }]}
            />
            <div className="mt-4 grid grid-cols-3 gap-2">
              <MiniStat label="p95" value={`${perf?.p95Ms ?? 0} ms`} />
              <MiniStat label="Average" value={`${perf?.avgMs ?? 0} ms`} />
              <MiniStat label="Errors" value={perf?.errors ?? 0} tone={perf?.errors ? 'bad' : undefined} />
            </div>
          </Card>
        </Reveal>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Reveal>
          <Card className="h-full">
            <CardHeader title="Migrations" subtitle="The schema is built by versioned, checksummed SQL files, applied in order." icon={GitCommitVertical} />
            <ol className="relative ml-2 space-y-4 border-l border-[var(--line-strong)] pl-6">
              {migrations.map((m, i) => (
                <motion.li key={m.version} initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }} className="relative">
                  <span className="absolute -left-[31px] top-0.5 grid h-4 w-4 place-items-center rounded-full bg-[rgb(var(--c-success))] text-white"><CheckCircle2 size={11} /></span>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <code className="text-[12px] text-ink-3">{m.version}</code>
                    <span className="text-[14px] font-medium">{m.name.replace(/_/g, ' ')}</span>
                    <span className="ml-auto text-[11.5px] text-ink-3 tabular">{m.duration_ms} ms</span>
                  </div>
                  <p className="text-[12px] text-ink-3">{formatDateTime(m.applied_at)} · checksum <code>{m.checksum}</code></p>
                </motion.li>
              ))}
            </ol>
          </Card>
        </Reveal>

        <Reveal delay={0.05}>
          <Card className="h-full">
            <CardHeader title="How the data stays correct" subtitle="Rules the database enforces itself, whatever writes to it." icon={ShieldCheck} action={<button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate('health')}>Run checks</button>} />
            <ul className="space-y-3 text-[13.5px]">
              {[
                [KeyRound, 'Keys and references', `${objects.foreignKeys} foreign keys stop orphaned records; ${objects.constraints} constraints reject impossible values like negative stock.`],
                [Zap, 'Triggers keep totals in step', 'Stock levels follow the movement ledger, sale status follows its payments, and low stock raises an alert - inside the same transaction.'],
                [FileCode2, 'Every change is recorded', 'An audit trigger writes the before and after of each insert, update and delete, with who made it.'],
                [Lock, 'All or nothing', 'Each save runs in a transaction, and edits check a row version so two people can’t overwrite each other.'],
                [Puzzle, 'Extensions', extensions.map((e) => `${e.name} ${e.version}`).join(', ')],
              ].map(([Icon, title, text]) => (
                <li key={title} className="flex gap-3">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[9px]" style={{ background: 'var(--wash-strong)' }}><Icon size={14} className="text-ink-2" /></span>
                  <div>
                    <p className="font-medium">{title}</p>
                    <p className="text-[12.5px] leading-relaxed text-ink-2">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
            {capabilities && (
              <p className="mt-4 rounded-[12px] px-3 py-2 text-[12px] text-ink-2" style={{ background: 'var(--wash)' }}>
                Console: {capabilities.admin ? 'changes allowed' : 'read-only'} · up to {capabilities.maxRows} rows · {capabilities.timeoutMs / 1000}s time limit per query
              </p>
            )}
          </Card>
        </Reveal>
      </div>
    </div>
  );
}

function HeroStat({ label, value, unit, hint }) {
  return (
    <div className="rounded-[16px] px-3 py-2.5" style={{ background: 'var(--wash)' }}>
      <p className="text-[11.5px] text-ink-3">{label}</p>
      <p className="text-[19px] font-semibold tracking-[-0.02em] tabular">
        <CountUp value={Number(value) || 0} format={(n) => (unit ? n.toFixed(1) : formatNumber(Math.round(n)))} />
        {unit && <span className="ml-0.5 text-[12px] font-medium text-ink-3">{unit}</span>}
      </p>
      <p className="text-[10.5px] text-ink-3">{hint}</p>
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  return (
    <div className="rounded-[12px] px-3 py-2" style={{ background: 'var(--wash)' }}>
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className={`text-[14px] font-semibold tabular ${tone === 'bad' ? 'text-danger' : ''}`}>{value}</p>
    </div>
  );
}

function CoreFallback() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 30, repeat: Infinity, ease: 'linear' }} className="grid h-40 w-40 place-items-center rounded-full" style={{ background: 'conic-gradient(from 0deg, #3aa0ff, #5e5ce6, #bf5af2, #3aa0ff)', opacity: 0.25 }}>
        <Database size={56} className="text-ink-2" />
      </motion.div>
    </div>
  );
}
