import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart2, Broom, CheckCircle2, ChevronDown, CircleAlert, Eraser, Loader2, Lock, RefreshCw, ShieldCheck, Sparkles, Wrench, XCircle,
} from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Button, Card, CardHeader, ConfirmButton, ErrorNote, useToast } from '../ui';
import { Reveal } from '../motion/Reveal';
import { formatRelative } from '../../lib/format';
import { cn } from '../../lib/cn';

const STATUS = {
  ok: { icon: CheckCircle2, color: 'rgb(var(--c-success))', soft: 'var(--success-soft)', label: 'Passed' },
  warning: { icon: CircleAlert, color: 'rgb(var(--c-warning))', soft: 'var(--warning-soft)', label: 'Needs a look' },
  error: { icon: XCircle, color: 'rgb(var(--c-danger))', soft: 'var(--danger-soft)', label: 'Problem' },
};

export default function HealthTab({ capabilities }) {
  const [report, setReport] = useState(null);
  const [revealed, setRevealed] = useState(0);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);
  const [fixing, setFixing] = useState(null);
  const toast = useToast();

  const run = useCallback(async () => {
    setRunning(true);
    setRevealed(0);
    try {
      const data = await api.db.integrity();
      setReport(data);
      setError(null);
      // Reveal results one by one - a scan you can watch.
      for (let i = 1; i <= data.results.length; i++) {
        await new Promise((r) => setTimeout(r, 140));
        setRevealed(i);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  async function fix(check) {
    setFixing(check.id);
    try {
      const result = await api.db.fix(check.id);
      toast.success('Repaired', { description: `${check.title}: ${result.fixed} record${result.fixed === 1 ? '' : 's'} corrected.` });
      await run();
    } catch (err) {
      toast.error('Could not repair', { description: err.message });
    } finally {
      setFixing(null);
    }
  }

  const results = report?.results || [];
  const passed = results.filter((r) => r.status === 'ok').length;
  const problems = results.filter((r) => r.status === 'error').length;
  const warnings = results.filter((r) => r.status === 'warning').length;
  const score = results.length ? passed / results.length : 0;
  const done = !running && report;
  const heroTone = !done ? 'accent' : problems ? 'danger' : warnings ? 'warning' : 'success';
  const heroColor = { accent: 'rgb(var(--c-accent))', danger: 'rgb(var(--c-danger))', warning: 'rgb(var(--c-warning))', success: 'rgb(var(--c-success))' }[heroTone];

  return (
    <div className="space-y-6">
      <ErrorNote error={error} onDismiss={() => setError(null)} />

      <Reveal>
        <section className="relative overflow-hidden rounded-[28px] p-7 sm:p-9" style={{ background: `radial-gradient(90% 120% at 0% 0%, ${heroColor.replace('rgb(', 'rgb(').replace(')', ' / 0.14)')}, transparent 60%), rgb(var(--c-surface))`, boxShadow: '0 0 0 1px var(--line), var(--shadow-md), var(--edge-highlight)' }}>
          <div className="flex flex-wrap items-center gap-8">
            <ScoreRing score={done ? score : revealed / Math.max(results.length || 9, 1)} color={heroColor} scanning={running}>
              {running ? <Loader2 size={30} className="animate-spin" style={{ color: heroColor }} /> : <ShieldCheck size={34} style={{ color: heroColor }} />}
            </ScoreRing>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink-2">Integrity checks</p>
              <h2 className="mt-1 text-[30px] font-semibold leading-tight tracking-[-0.035em] sm:text-[36px]">
                {!done ? 'Checking your data…' : problems ? `${problems} problem${problems === 1 ? '' : 's'} found` : warnings ? 'Healthy, with notes' : 'Everything adds up'}
              </h2>
              <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed text-ink-2">
                Cross-checks the totals the database keeps against the records they come from - stock against the ledger, sales against their lines and payments, orders against deliveries - plus files on disk.
              </p>
              {done && (
                <p className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                  <Badge tone="green" icon>{passed} passed</Badge>
                  {warnings > 0 && <Badge tone="amber" icon>{warnings} to look at</Badge>}
                  {problems > 0 && <Badge tone="red" icon>{problems} problem{problems === 1 ? '' : 's'}</Badge>}
                  <span>· {report.durationMs} ms · {formatRelative(report.checkedAt)}</span>
                </p>
              )}
            </div>
            <Button variant="secondary" icon={RefreshCw} loading={running} onClick={run}>Run again</Button>
          </div>
        </section>
      </Reveal>

      <ul className="space-y-2">
        {(results.length ? results : Array.from({ length: 9 }, (_, i) => ({ id: `s${i}` }))).map((check, i) => {
          const shown = i < revealed && check.status;
          const st = STATUS[check.status] || STATUS.ok;
          const Icon = st.icon;
          const expanded = open === check.id;
          return (
            <li key={check.id} className="panel overflow-hidden">
              <div
                role={shown && check.samples?.length ? 'button' : undefined}
                tabIndex={shown && check.samples?.length ? 0 : undefined}
                aria-expanded={shown && check.samples?.length ? expanded : undefined}
                onClick={() => shown && check.samples?.length && setOpen(expanded ? null : check.id)}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && shown && check.samples?.length) { e.preventDefault(); setOpen(expanded ? null : check.id); } }}
                className={cn('flex w-full items-center gap-3 px-4 py-3.5 text-left', shown && check.samples?.length && 'cursor-pointer')}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: shown ? st.soft : 'var(--wash-strong)' }}>
                  <AnimatePresence mode="wait" initial={false}>
                    {shown ? (
                      <motion.span key="done" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 20 }}>
                        <Icon size={17} style={{ color: st.color }} />
                      </motion.span>
                    ) : (
                      <motion.span key="wait" exit={{ scale: 0 }}>
                        <Loader2 size={15} className={cn('text-ink-3', running && 'animate-spin')} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <div className="min-w-0 flex-1">
                  {check.title ? <p className="text-[14px] font-medium">{check.title}</p> : <div className="skeleton h-3.5 w-56 rounded" />}
                  {check.explain && <p className="mt-0.5 text-[12.5px] text-ink-2">{check.explain}</p>}
                  {check.error && <p className="mt-0.5 text-[12.5px] text-danger">{check.error}</p>}
                </div>
                {shown && check.count > 0 && <span className="text-[12.5px] font-semibold tabular" style={{ color: st.color }}>{check.count}</span>}
                {shown && check.fixable && check.count > 0 && capabilities?.admin && (
                  <span onClick={(e) => e.stopPropagation()} role="presentation">
                    <ConfirmButton className="btn-secondary btn-sm" icon={Wrench} confirmLabel="Repair" message={`Recalculate from the source records and correct ${check.count} row${check.count === 1 ? '' : 's'}? The change is recorded in the activity log.`} onConfirm={() => fix(check)} disabled={fixing === check.id}>
                      Repair
                    </ConfirmButton>
                  </span>
                )}
                {shown && check.samples?.length > 0 && <ChevronDown size={16} className={cn('shrink-0 text-ink-3 transition-transform', expanded && 'rotate-180')} />}
              </div>
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <ul className="space-y-1 px-4 pb-4 pl-[60px]">
                      {check.samples.map((s) => (
                        <li key={s.id} className="flex gap-3 rounded-[10px] px-3 py-1.5 text-[12.5px]" style={{ background: 'var(--wash)' }}>
                          <span className="font-medium">{s.label}</span>
                          <span className="text-ink-2">{s.detail}</span>
                        </li>
                      ))}
                      {check.count > check.samples.length && <li className="px-3 text-[12px] text-ink-3">and {check.count - check.samples.length} more</li>}
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>

      {report?.guaranteed && (
        <Reveal>
          <Card>
            <CardHeader title="Guaranteed by the schema" subtitle="These can't go wrong, so there's nothing to check: the database refuses the change outright." icon={Lock} />
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {report.guaranteed.map((g, i) => (
                <motion.li key={g.id} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }} className="rounded-[16px] p-4" style={{ background: 'var(--wash)' }}>
                  <Lock size={15} className="mb-2 text-success" />
                  <p className="text-[13.5px] font-medium">{g.title}</p>
                  <p className="mt-0.5 text-[12px] text-ink-3">{g.by}</p>
                </motion.li>
              ))}
            </ul>
          </Card>
        </Reveal>
      )}

      <Maintenance admin={capabilities?.admin} />
    </div>
  );
}

function ScoreRing({ score, color, scanning, children }) {
  const size = 132;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-track)" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} animate={{ strokeDashoffset: c * (1 - Math.max(score, 0.02)) }} transition={{ type: 'spring', stiffness: 60, damping: 16 }} />
      </svg>
      {scanning && <motion.span aria-hidden="true" className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${color}` }} animate={{ scale: [1, 1.18], opacity: [0.5, 0] }} transition={{ duration: 1.2, repeat: Infinity }} />}
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

const TASKS = [
  { action: 'analyze', title: 'Refresh statistics', icon: BarChart2, text: 'Re-measures every table so the query planner picks good plans after lots of new data.', confirm: false },
  { action: 'vacuum', title: 'Vacuum', icon: Sparkles, text: 'Reclaims space left by updated and deleted rows, then refreshes statistics.', confirm: false },
  { action: 'prune_activity', title: 'Trim old activity', icon: Eraser, text: 'Deletes audit entries older than 180 days. Recent history is kept.', confirm: true },
];

function Maintenance({ admin }) {
  const [busy, setBusy] = useState(null);
  const [results, setResults] = useState({});
  const toast = useToast();

  async function perform(task) {
    setBusy(task.action);
    try {
      const res = await api.db.maintenance(task.action, task.action === 'prune_activity' ? { days: 180 } : {});
      setResults((r) => ({ ...r, [task.action]: res }));
      toast.success(task.title, { description: `${res.detail} (${res.durationMs} ms)` });
    } catch (err) {
      toast.error(`${task.title} failed`, { description: err.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Reveal>
      <Card>
        <CardHeader title="Maintenance" subtitle={admin ? 'Housekeeping PostgreSQL normally does on its own - run it by hand after big imports.' : 'Maintenance is switched off for this installation (DB_ADMIN).'} icon={Broom} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {TASKS.map((task) => {
            const Icon = task.icon;
            const done = results[task.action];
            return (
              <div key={task.action} className="flex flex-col rounded-[18px] p-4" style={{ background: 'var(--wash)' }}>
                <div className="mb-2 flex items-center gap-2">
                  <Icon size={16} className="text-ink-2" />
                  <p className="text-[14px] font-semibold">{task.title}</p>
                </div>
                <p className="flex-1 text-[12.5px] leading-relaxed text-ink-2">{task.text}</p>
                {done && <p className="mt-2 text-[12px] text-success">{done.detail}</p>}
                <div className="mt-3">
                  {task.confirm ? (
                    <ConfirmButton className="btn-secondary btn-sm" confirmLabel="Trim" message="Delete activity entries older than 180 days? This can't be undone." onConfirm={() => perform(task)} disabled={!admin || busy !== null}>
                      {busy === task.action ? 'Working…' : 'Run'}
                    </ConfirmButton>
                  ) : (
                    <Button variant="secondary" size="sm" loading={busy === task.action} disabled={!admin || (busy !== null && busy !== task.action)} success={Boolean(done)} onClick={() => perform(task)}>Run</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </Reveal>
  );
}
