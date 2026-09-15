import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Activity, AlertTriangle, Database, Gauge, HardDrive, ListTree, Pause, Play, RotateCw, Timer, Turtle, Zap } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Card, CardHeader, ErrorNote } from '../ui';
import { ColumnChart, HorizontalBars, Rings, RingsLegend, StatTile } from '../charts';
import { Reveal, RevealGroup, RevealItem } from '../motion/Reveal';
import { MONO_FONT } from './SqlEditor';
import { TOKEN_COLORS, tokenize } from './sql';
import { formatBytes, formatNumber, formatTime } from '../../lib/format';
import { cn } from '../../lib/cn';

function Sql({ text, className }) {
  return (
    <code className={cn('block truncate text-[12px]', className)} style={{ fontFamily: MONO_FONT }} title={text}>
      {tokenize(text.replace(/\s+/g, ' ')).map((t, i) => <span key={i} style={{ color: TOKEN_COLORS[t.type] }}>{t.text}</span>)}
    </code>
  );
}

export default function PerformanceTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return undefined;
    let alive = true;
    const tick = () => api.db.performance().then((d) => { if (alive) { setData(d); setError(null); } }).catch((err) => alive && setError(err.message));
    tick();
    const timer = setInterval(() => document.visibilityState === 'visible' && tick(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [paused]);

  if (!data) return <div className="space-y-4"><ErrorNote error={error} onDismiss={() => setError(null)} /><div className="skeleton h-[480px] rounded-[24px]" /></div>;

  const q = data.queries;
  const db = data.database || {};
  const cache = Number(db.cache_hit_percent) || 0;
  const commits = Number(db.xact_commit) || 0;
  const rollbacks = Number(db.xact_rollback) || 0;
  const commitPct = commits + rollbacks ? (commits / (commits + rollbacks)) * 100 : 100;
  const unused = data.indexUsage.filter((i) => Number(i.scans) === 0);
  const hits = Number(db.blks_hit) || 0;
  const reads = Number(db.blks_read) || 0;
  const rings = [
    { key: 'cache', label: 'Reads served from memory', value: cache, target: 100, color: 'var(--series-1)', display: formatNumber(hits), targetDisplay: `of ${formatNumber(hits + reads)} blocks` },
    { key: 'commit', label: 'Transactions committed', value: commitPct, target: 100, color: 'var(--series-3)', display: formatNumber(commits), targetDisplay: `of ${formatNumber(commits + rollbacks)}` },
  ];

  return (
    <div className="space-y-6">
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={paused ? 'slate' : 'green'} dot>{paused ? 'Paused' : 'Live · every 4 seconds'}</Badge>
        <span className="text-[12.5px] text-ink-3">Measured by DocDesk since the server started {formatTime(q.since)}. Restarts: {data.engine.restarts}.</span>
        <button type="button" className="btn-secondary btn-sm ml-auto" onClick={() => setPaused((p) => !p)}>{paused ? <Play size={14} /> : <Pause size={14} />} {paused ? 'Resume' : 'Pause'}</button>
      </div>

      <RevealGroup className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <RevealItem><StatTile label="Queries run" icon={Activity} value={q.total} format={(n) => formatNumber(Math.round(n))} footnote={`${q.errors} failed`} /></RevealItem>
        <RevealItem><StatTile label="Median time" icon={Timer} value={q.p50Ms} format={(n) => `${n.toFixed(1)} ms`} footnote={`average ${q.avgMs} ms`} /></RevealItem>
        <RevealItem><StatTile label="95th percentile" icon={Gauge} value={q.p95Ms} format={(n) => `${n.toFixed(1)} ms`} tone={q.p95Ms > q.slowThresholdMs ? 'amber' : undefined} footnote="19 in 20 queries are faster" /></RevealItem>
        <RevealItem><StatTile label="Slow queries" icon={Turtle} value={q.slowest.length} format={(n) => Math.round(n)} tone={q.slowest.length ? 'amber' : 'green'} footnote={`over ${q.slowThresholdMs} ms`} /></RevealItem>
      </RevealGroup>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Reveal>
          <Card className="h-full">
            <CardHeader title="Throughput" subtitle="Queries per 5 seconds, last six minutes. Hover for the average time." icon={Zap} />
            <ColumnChart
              data={q.timeline.map((b) => ({ ...b, label: b.at }))}
              valueKey="count"
              labelKey="label"
              height={230}
              highlight={(b) => b.errors > 0}
              formatValue={(v) => `${v} quer${v === 1 ? 'y' : 'ies'}`}
              formatLabel={() => ''}
              formatTitle={(at) => new Date(at).toLocaleTimeString()}
              extraRows={(b) => [{ value: `${b.avgMs} ms`, label: 'average' }, ...(b.errors ? [{ value: String(b.errors), label: 'failed' }] : [])]}
            />
          </Card>
        </Reveal>
        <Reveal delay={0.05}>
          <Card className="h-full">
            <CardHeader title="Engine health" subtitle="From PostgreSQL's own statistics." icon={Database} />
            <div className="flex flex-wrap items-center justify-center gap-6">
              <Rings size={160} rings={rings}>
                <div>
                  <p className="text-[11px] text-ink-3">Cache</p>
                  <p className="text-[18px] font-semibold tabular">{cache.toFixed(0)}%</p>
                </div>
              </Rings>
              <RingsLegend rings={rings} />
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-2 text-[12.5px]">
              {[
                ['Rows read', db.tup_returned],
                ['Rows fetched', db.tup_fetched],
                ['Inserted', db.tup_inserted],
                ['Updated', db.tup_updated],
                ['Deleted', db.tup_deleted],
                ['Deadlocks', db.deadlocks],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-[10px] px-3 py-1.5" style={{ background: 'var(--wash)' }}>
                  <dt className="text-ink-3">{label}</dt>
                  <dd className="font-semibold tabular">{formatNumber(Number(value) || 0)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[11.5px] text-ink-3">{data.engine.connections?.note}</p>
          </Card>
        </Reveal>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Reveal>
          <Card className="h-full">
            <CardHeader title="Where the time goes" subtitle="Query shapes by total time - literal values are folded together." icon={Timer} />
            <ul className="space-y-2.5">
              {q.topByTime.map((t, i) => {
                const max = q.topByTime[0]?.totalMs || 1;
                return (
                  <li key={i}>
                    <div className="flex items-baseline gap-3">
                      <Sql text={t.sql} className="min-w-0 flex-1" />
                      <span className="shrink-0 text-[12px] font-semibold tabular">{formatNumber(t.totalMs)} ms</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--chart-track)' }}>
                        <motion.div className="h-full rounded-full" style={{ background: 'var(--series-1)' }} initial={{ width: 0 }} animate={{ width: `${(t.totalMs / max) * 100}%` }} transition={{ type: 'spring', stiffness: 90, damping: 20 }} />
                      </div>
                      <span className="w-40 shrink-0 text-right text-[11px] text-ink-3 tabular">{t.calls}× · avg {t.avgMs} · max {t.maxMs} ms</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </Reveal>

        <Reveal delay={0.05}>
          <Card className="h-full">
            <CardHeader title="Recent queries" subtitle="The last ones to reach the database, newest first." icon={RotateCw} />
            <ul className="max-h-[420px] divide-y divide-[var(--line)] overflow-y-auto" data-lenis-prevent>
              {[...q.recent].reverse().slice(0, 40).map((r, i) => (
                <li key={`${r.at}-${i}`} className="flex items-center gap-3 py-2">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', r.error ? 'bg-[rgb(var(--c-danger))]' : r.ms >= q.slowThresholdMs ? 'bg-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-success))]')} />
                  <Sql text={r.sql} className="min-w-0 flex-1" />
                  <span className="shrink-0 text-[11px] text-ink-3">{r.actor}</span>
                  <span className={cn('w-16 shrink-0 text-right text-[12px] tabular', r.ms >= q.slowThresholdMs ? 'font-semibold text-warning' : 'text-ink-2')}>{r.ms} ms</span>
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>
      </div>

      <Reveal>
        <Card>
          <CardHeader title="Index usage" subtitle="How often each index has been used to find rows since statistics were last reset." icon={ListTree} action={unused.length > 0 && <Badge tone="slate">{unused.length} not used yet</Badge>} />
          <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
            <HorizontalBars
              rows={data.indexUsage.filter((i) => Number(i.scans) > 0).slice(0, 14).map((i) => ({ ...i, label: i.index_name, scans: Number(i.scans) }))}
              labelKey="label"
              valueKey="scans"
              formatValue={(v) => `${formatNumber(v)} scans`}
              meta={(i) => `${i.table_name} · ${formatBytes(i.size_bytes)}`}
            />
            <div className="mt-6 lg:mt-0">
              <p className="mb-2 flex items-center gap-2 text-[13px] font-medium"><AlertTriangle size={14} className="text-ink-3" /> Not used yet</p>
              <p className="mb-3 text-[12.5px] leading-relaxed text-ink-2">An index that is never used still costs space and slows writes. On a young database many are simply waiting for the queries that need them - unique indexes also enforce rules even when never scanned.</p>
              <ul className="flex flex-wrap gap-1.5">
                {unused.slice(0, 30).map((i) => (
                  <li key={i.index_name} className="rounded-full px-2.5 py-1 text-[11.5px] text-ink-2" style={{ background: 'var(--wash-strong)', fontFamily: MONO_FONT }} title={`${i.table_name} · ${formatBytes(i.size_bytes)}`}>{i.index_name}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-[11.5px] text-ink-3"><HardDrive size={12} /> {data.engine.engine} {data.engine.version} · {data.engine.location}</p>
        </Card>
      </Reveal>
    </div>
  );
}
