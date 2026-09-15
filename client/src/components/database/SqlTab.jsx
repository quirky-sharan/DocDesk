import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertOctagon, BarChart3, BookOpen, CheckCircle2, ChevronRight, Clock, Columns3, Download, Eraser, GitBranch, History, Play, ShieldAlert,
  ShieldCheck, Sparkles, Table2, Trash2, Wand2,
} from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Button, SegmentedControl } from '../ui';
import { ColumnChart, HorizontalBars } from '../charts';
import SqlEditor, { MONO_FONT } from './SqlEditor';
import ResultGrid, { isNumericType, toCsv } from './ResultGrid';
import PlanTree from './PlanTree';
import { formatSql } from './sql';
import { formatRelative } from '../../lib/format';
import { cn } from '../../lib/cn';

const HISTORY_KEY = 'docdesk.sql.history.v1';
const DRAFT_KEY = 'docdesk.sql.draft.v1';
const DEFAULT_SQL = `-- Ctrl+Enter runs the query (or just the selected part).
SELECT p.name, c.name AS category, p.stock_quantity, p.reorder_level
FROM products p
LEFT JOIN categories c ON c.id = p.category_id
ORDER BY p.stock_quantity ASC
LIMIT 20;`;

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Optional.
  }
}

export default function SqlTab({ initialSql, capabilities }) {
  const [sql, setSql] = useState(() => initialSql || readJson(DRAFT_KEY, null) || DEFAULT_SQL);
  const [allowWrite, setAllowWrite] = useState(false);
  const [measure, setMeasure] = useState(true);
  const [running, setRunning] = useState(null);
  const [result, setResult] = useState(null);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('results');
  const [history, setHistory] = useState(() => readJson(HISTORY_KEY, []));
  const [schema, setSchema] = useState(null);
  const [samples, setSamples] = useState([]);
  const [side, setSide] = useState('samples');

  useEffect(() => {
    if (initialSql) setSql(initialSql);
  }, [initialSql]);

  useEffect(() => {
    const timer = setTimeout(() => writeJson(DRAFT_KEY, sql), 400);
    return () => clearTimeout(timer);
  }, [sql]);

  useEffect(() => {
    api.db.relationships().then((d) => setSchema((s) => ({ ...s, tables: d.tables }))).catch(() => {});
    api.db.routines().then((r) => setSchema((s) => ({ ...s, views: r.views }))).catch(() => {});
    api.db.samples().then(setSamples).catch(() => {});
  }, []);

  const remember = useCallback((entry) => {
    setHistory((h) => {
      const next = [entry, ...h.filter((x) => x.sql !== entry.sql)].slice(0, 40);
      writeJson(HISTORY_KEY, next);
      return next;
    });
  }, []);

  async function run(selected) {
    const text = (selected || sql).trim();
    if (!text) return;
    setRunning('run');
    setError(null);
    try {
      const data = await api.db.query(text, allowWrite);
      setResult({ ...data, sql: text, at: Date.now() });
      setPlan(null);
      if (view === 'plan') setView('results');
      remember({ sql: text, at: Date.now(), ms: data.durationMs, rows: data.rowCount, kind: data.kind, ok: true });
    } catch (err) {
      setError({ message: err.message, position: err.body?.position, sql: text, offset: selected ? sql.indexOf(selected) : 0 });
      remember({ sql: text, at: Date.now(), ok: false, message: err.message });
    } finally {
      setRunning(null);
    }
  }

  async function explain() {
    const text = sql.trim();
    if (!text) return;
    setRunning('explain');
    setError(null);
    try {
      const data = await api.db.explain(text.replace(/^\s*(--[^\n]*\n\s*)*/, ''), { analyze: measure, allowWrite });
      setPlan(data);
      setView('plan');
    } catch (err) {
      setError({ message: err.message, position: null, sql: text, offset: 0 });
    } finally {
      setRunning(null);
    }
  }

  function download() {
    if (!result?.columns?.length) return;
    const blob = new Blob([toCsv(result.columns, result.rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const canChart = result?.columns?.some((c) => isNumericType(c.type)) && result.rows.length > 1;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <div className="panel p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button icon={Play} loading={running === 'run'} onClick={() => run()}>Run</Button>
            <Button variant="secondary" icon={GitBranch} loading={running === 'explain'} onClick={explain}>Explain</Button>
            <label className="flex items-center gap-1.5 px-1 text-[12.5px] text-ink-2" title="Run the query to get real timings (always rolled back)">
              <input type="checkbox" checked={measure} onChange={(e) => setMeasure(e.target.checked)} className="accent-[rgb(var(--c-accent))]" /> Measure
            </label>
            <span className="mx-1 hidden h-5 w-px bg-[var(--line)] sm:block" />
            <button type="button" className="btn-ghost btn-sm" onClick={() => setSql(formatSql(sql))}><Wand2 size={14} /> Format</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setSql('')}><Eraser size={14} /> Clear</button>
            <span className="flex-1" />
            {capabilities?.admin ? (
              <button
                type="button"
                onClick={() => setAllowWrite((v) => !v)}
                className={cn('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors', allowWrite ? 'text-white' : 'text-ink-2')}
                style={{ background: allowWrite ? 'rgb(var(--c-danger))' : 'var(--wash-strong)' }}
                aria-pressed={allowWrite}
              >
                {allowWrite ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
                {allowWrite ? 'Changes allowed' : 'Read-only'}
              </button>
            ) : (
              <Badge tone="slate" icon={ShieldCheck}>Read-only</Badge>
            )}
          </div>
          <SqlEditor value={sql} onChange={setSql} onRun={run} schema={schema} minRows={9} />
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11.5px] text-ink-3">
            <span><kbd className="kbd">Ctrl</kbd> + <kbd className="kbd">Enter</kbd> run</span>
            <span><kbd className="kbd">Tab</kbd> accept suggestion</span>
            <span>Reads run in a rolled-back transaction · max {capabilities?.maxRows ?? 1000} rows · {Math.round((capabilities?.timeoutMs ?? 15000) / 1000)}s limit</span>
          </p>
        </div>

        <AnimatePresence mode="popLayout">
          {error && (
            <motion.div key="error" initial={{ opacity: 0, y: -6, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1, x: [0, -6, 6, -3, 3, 0] }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="rounded-[18px] p-4" style={{ background: 'var(--danger-soft)' }}>
              <div className="flex items-start gap-3">
                <AlertOctagon size={18} className="mt-0.5 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-danger">That query didn&apos;t run</p>
                  <p className="mt-0.5 text-[13.5px] text-ink">{error.message}</p>
                  {error.position && <ErrorPointer sql={error.sql} position={error.position} />}
                </div>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {(result || plan) && (
          <div className="panel p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <SegmentedControl
                size="sm"
                value={view}
                onChange={setView}
                ariaLabel="Result view"
                options={[
                  ['results', 'Results', Table2],
                  ...(canChart ? [['chart', 'Chart', BarChart3]] : []),
                  ...(plan ? [['plan', 'Plan', GitBranch]] : []),
                ]}
              />
              {result && view !== 'plan' && (
                <motion.p key={result.at} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 text-[12.5px] text-ink-2">
                  <CheckCircle2 size={14} className="text-success" />
                  {result.kind === 'write' ? `${result.rowCount ?? 0} row${result.rowCount === 1 ? '' : 's'} affected` : `${result.rowCount} row${result.rowCount === 1 ? '' : 's'}`}
                  {result.truncated && <Badge tone="amber">first {result.rowCount} shown</Badge>}
                  <span className="text-ink-3">· {result.durationMs} ms · {result.command}</span>
                </motion.p>
              )}
              {view === 'plan' && plan && <span className="text-[12.5px] text-ink-3">{plan.analyze ? 'Measured by running the query, then rolled back' : 'Estimated by the planner, not run'}</span>}
              <span className="flex-1" />
              {result?.columns?.length > 0 && view !== 'plan' && (
                <button type="button" className="btn-ghost btn-sm" onClick={download}><Download size={14} /> CSV</button>
              )}
            </div>

            {view === 'plan' && plan ? (
              <PlanTree result={plan} />
            ) : view === 'chart' && canChart ? (
              <ResultChart result={result} />
            ) : result?.columns?.length ? (
              <ResultGrid columns={result.columns} rows={result.rows} />
            ) : result ? (
              <WriteSuccess result={result} />
            ) : null}
          </div>
        )}

        {!result && !plan && !error && (
          <div className="rounded-[22px] px-6 py-10 text-center" style={{ boxShadow: 'inset 0 0 0 1.5px var(--line)', background: 'var(--wash)' }}>
            <Sparkles size={22} className="mx-auto mb-2 text-ink-3" />
            <p className="text-[14px] font-medium">Write a query, or start from one of the examples</p>
            <p className="mt-1 text-[13px] text-ink-2">Results appear here. Explain shows how PostgreSQL plans to run it, step by step.</p>
          </div>
        )}
      </div>

      <aside className="min-w-0 xl:sticky xl:top-32 xl:self-start">
        <div className="panel overflow-hidden">
          <div className="p-2" style={{ borderBottom: '1px solid var(--line)' }}>
            <SegmentedControl size="sm" value={side} onChange={setSide} ariaLabel="Helpers" options={[['samples', 'Examples', BookOpen], ['schema', 'Schema', Columns3], ['history', 'History', History]]} />
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-2" data-lenis-prevent>
            {side === 'samples' && (
              <ul className="space-y-1">
                {samples.map((s, i) => (
                  <motion.li key={s.title} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                    <button type="button" onClick={() => { setSql(s.sql); setResult(null); setPlan(null); setError(null); }} className="group w-full rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-[var(--wash)]">
                      <span className="flex items-center gap-2 text-[13px] font-medium">
                        {s.title}
                        <ChevronRight size={13} className="ml-auto shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
                      </span>
                      <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium text-accent-ink" style={{ background: 'var(--accent-soft)' }}>{s.concept}</span>
                    </button>
                  </motion.li>
                ))}
              </ul>
            )}
            {side === 'schema' && <SchemaTree schema={schema} onInsert={(text) => setSql((q) => `${q}${q && !/\s$/.test(q) ? ' ' : ''}${text}`)} />}
            {side === 'history' && (
              history.length === 0 ? (
                <p className="px-3 py-8 text-center text-[13px] text-ink-3">Queries you run are kept here, in this browser.</p>
              ) : (
                <>
                  <ul className="space-y-1">
                    {history.map((h) => (
                      <li key={`${h.at}-${h.sql.length}`}>
                        <button type="button" onClick={() => setSql(h.sql)} className="w-full rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-[var(--wash)]">
                          <code className="line-clamp-2 block text-[11.5px] leading-relaxed text-ink" style={{ fontFamily: MONO_FONT }}>{h.sql}</code>
                          <span className={cn('mt-1 flex items-center gap-1.5 text-[11px]', h.ok ? 'text-ink-3' : 'text-danger')}>
                            <Clock size={10} /> {formatRelative(h.at)}
                            {h.ok ? ` · ${h.rows ?? 0} rows · ${h.ms} ms` : ' · failed'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="btn-ghost btn-sm mt-2 w-full" onClick={() => { setHistory([]); writeJson(HISTORY_KEY, []); }}><Trash2 size={13} /> Clear history</button>
                </>
              )
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function ErrorPointer({ sql, position }) {
  // Show the line the error is on with a caret under the character.
  const index = Math.max(position - 1, 0);
  const lineStart = sql.lastIndexOf('\n', index - 1) + 1;
  const lineEnd = sql.indexOf('\n', index);
  const line = sql.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const lineNumber = sql.slice(0, lineStart).split('\n').length;
  const column = index - lineStart;
  return (
    <pre className="mt-2 overflow-x-auto rounded-[10px] px-3 py-2 text-[12px] leading-relaxed" style={{ fontFamily: MONO_FONT, background: 'rgb(var(--c-surface))' }}>
      <span className="text-ink-3">{String(lineNumber).padStart(3)} │ </span>{line}{'\n'}
      <span className="text-ink-3">{'    │ '}</span><span className="font-bold text-danger">{' '.repeat(Math.max(column, 0))}^</span>
    </pre>
  );
}

function WriteSuccess({ result }) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }} className="mb-3 grid h-14 w-14 place-items-center rounded-full" style={{ background: 'var(--success-soft)' }}>
        <CheckCircle2 size={28} className="text-success" />
      </motion.div>
      <p className="text-[15px] font-semibold">{result.command === 'analyze' || result.command === 'vacuum' ? 'Done' : `${result.rowCount ?? 0} row${result.rowCount === 1 ? '' : 's'} affected`}</p>
      <p className="mt-1 text-[13px] text-ink-2">Committed in {result.durationMs} ms. Business rules and the audit trail ran as usual.</p>
    </div>
  );
}

function ResultChart({ result }) {
  const numeric = result.columns.map((c, i) => ({ ...c, i })).filter((c) => isNumericType(c.type));
  const labels = result.columns.map((c, i) => ({ ...c, i })).filter((c) => !isNumericType(c.type));
  const [valueIndex, setValueIndex] = useState(numeric[0]?.i ?? 0);
  const [labelIndex, setLabelIndex] = useState(labels[0]?.i ?? -1);
  const rows = useMemo(
    () => result.rows.slice(0, 40).map((r, n) => ({ id: n, label: labelIndex === -1 ? `#${n + 1}` : String(r[labelIndex] ?? 'NULL'), value: Number(r[valueIndex]) || 0 })),
    [result, valueIndex, labelIndex]
  );
  const looksLikeTime = labelIndex !== -1 && /date|time/.test(result.columns[labelIndex]?.type || '');

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-[12.5px]">
        <label className="flex items-center gap-2 text-ink-2">Label
          <select className="input-field h-8 w-auto py-0" value={labelIndex} onChange={(e) => setLabelIndex(Number(e.target.value))}>
            <option value={-1}>Row number</option>
            {result.columns.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-ink-2">Value
          <select className="input-field h-8 w-auto py-0" value={valueIndex} onChange={(e) => setValueIndex(Number(e.target.value))}>
            {numeric.map((c) => <option key={c.i} value={c.i}>{c.name}</option>)}
          </select>
        </label>
        {result.rows.length > 40 && <span className="text-ink-3">First 40 rows</span>}
      </div>
      {looksLikeTime ? (
        <ColumnChart data={rows} valueKey="value" labelKey="label" height={260} formatLabel={(l) => String(l).slice(5, 10)} formatTitle={(l) => l} formatValue={(v) => v.toLocaleString()} />
      ) : (
        <HorizontalBars rows={rows} labelKey="label" valueKey="value" formatValue={(v) => v.toLocaleString()} />
      )}
    </div>
  );
}

function SchemaTree({ schema, onInsert }) {
  const [open, setOpen] = useState(null);
  if (!schema?.tables) return <div className="skeleton m-2 h-40 rounded-[12px]" />;
  return (
    <ul className="space-y-0.5">
      {schema.tables.map((t) => (
        <li key={t.name}>
          <div className="flex items-center rounded-[10px] hover:bg-[var(--wash)]">
            <button type="button" onClick={() => setOpen(open === t.name ? null : t.name)} className="flex flex-1 items-center gap-2 px-2.5 py-1.5 text-left">
              <ChevronRight size={13} className={cn('text-ink-3 transition-transform', open === t.name && 'rotate-90')} />
              <Table2 size={13} className="text-ink-3" />
              <span className="text-[12.5px] font-medium" style={{ fontFamily: MONO_FONT }}>{t.name}</span>
              <span className="ml-auto text-[11px] text-ink-3 tabular">{t.rows}</span>
            </button>
            <button type="button" className="px-2 text-[11px] text-accent-ink opacity-70 hover:opacity-100" onClick={() => onInsert(t.name)} title="Insert name">+</button>
          </div>
          <AnimatePresence initial={false}>
            {open === t.name && (
              <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-8">
                {t.columns.map((c) => (
                  <li key={c.name}>
                    <button type="button" onClick={() => onInsert(c.name)} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1 text-left hover:bg-[var(--wash)]" title="Insert name">
                      <span className={cn('text-[12px]', c.primaryKey ? 'font-semibold text-warning' : c.foreignKey ? 'text-accent-ink' : 'text-ink')} style={{ fontFamily: MONO_FONT }}>{c.name}</span>
                      <span className="ml-auto truncate text-[10.5px] text-ink-3" style={{ fontFamily: MONO_FONT }}>{String(c.type).replace('timestamp with time zone', 'timestamptz')}</span>
                    </button>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </li>
      ))}
    </ul>
  );
}
