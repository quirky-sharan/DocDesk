import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check, Columns3, Copy, FileCode2, History, KeyRound, Link2, ListTree, Lock, Search, Table2, TerminalSquare, Zap,
} from 'lucide-react';
import { api } from '../../api/client';
import { Badge, ErrorNote, Pagination, SearchInput, SegmentedControl } from '../ui';
import ResultGrid from './ResultGrid';
import RowInspector from './RowInspector';
import { MONO_FONT } from './SqlEditor';
import { TOKEN_COLORS, tokenize } from './sql';
import { formatBytes, formatNumber } from '../../lib/format';
import { cn } from '../../lib/cn';

const SECTIONS = [
  ['data', 'Data', Table2],
  ['columns', 'Columns', Columns3],
  ['indexes', 'Indexes', ListTree],
  ['constraints', 'Constraints', Lock],
  ['triggers', 'Triggers', Zap],
  ['ddl', 'SQL', FileCode2],
];

export default function TablesTab({ initialTable, onNavigate }) {
  const [tables, setTables] = useState(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(initialTable || null);
  const [detail, setDetail] = useState(null);
  const [section, setSection] = useState('data');
  const [error, setError] = useState(null);

  useEffect(() => {
    api.db.tables().then((list) => {
      setTables(list);
      setSelected((s) => s || list.find((t) => t.name === 'products')?.name || list[0]?.name);
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setDetail(null);
    api.db.table(selected).then(setDetail).catch((err) => setError(err.message));
  }, [selected]);

  const shown = (tables || []).filter((t) => t.name.includes(filter.toLowerCase().trim()));
  const maxRows = Math.max(...(tables || []).map((t) => t.rows), 1);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-32 lg:self-start">
        <div className="panel overflow-hidden">
          <div className="p-3" style={{ borderBottom: '1px solid var(--line)' }}>
            <label className="flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: 'var(--wash)' }}>
              <Search size={14} className="text-ink-3" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tables" className="w-full bg-transparent text-[13px] outline-none" />
            </label>
          </div>
          <ul className="max-h-[62vh] overflow-y-auto p-1.5" data-lenis-prevent>
            {!tables && Array.from({ length: 8 }, (_, i) => <li key={i} className="skeleton m-1.5 h-10 rounded-[10px]" />)}
            {shown.map((t) => {
              const active = t.name === selected;
              return (
                <li key={t.name}>
                  <button type="button" onClick={() => { setSelected(t.name); setSection('data'); }} className={cn('relative flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2 text-left transition-colors', active ? 'text-ink' : 'text-ink-2 hover:bg-[var(--wash)]')}>
                    {active && <motion.span layoutId="db-table-pill" className="absolute inset-0 rounded-[12px]" style={{ background: 'var(--accent-soft)' }} transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                    <Table2 size={14} className={cn('relative shrink-0', active ? 'text-accent-ink' : 'text-ink-3')} />
                    <span className="relative min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium" style={{ fontFamily: MONO_FONT }}>{t.name}</span>
                      <span className="mt-1 block h-[3px] overflow-hidden rounded-full" style={{ background: 'var(--chart-track)' }}>
                        <span className="block h-full rounded-full" style={{ width: `${Math.max((t.rows / maxRows) * 100, t.rows ? 2 : 0)}%`, background: 'var(--series-1)' }} />
                      </span>
                    </span>
                    <span className="relative text-[11.5px] text-ink-3 tabular">{formatNumber(t.rows)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      <section className="min-w-0">
        <ErrorNote error={error} onDismiss={() => setError(null)} />
        {!detail ? (
          <div className="space-y-4">
            <div className="skeleton h-28 rounded-[22px]" />
            <div className="skeleton h-96 rounded-[22px]" />
          </div>
        ) : (
          <>
            <div className="panel mb-4 p-5">
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[22px] font-semibold tracking-[-0.025em]" style={{ fontFamily: MONO_FONT }}>{detail.name}</h2>
                  {detail.comment && <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">{detail.comment}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => onNavigate('sql', { sql: `SELECT *\nFROM ${detail.name}\nORDER BY 1 DESC\nLIMIT 50` })}><TerminalSquare size={14} /> Query</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => onNavigate('activity', { table: detail.name })}><History size={14} /> Changes</button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] text-ink-2">
                <span><b className="font-semibold text-ink tabular">{formatNumber(detail.rows)}</b> rows</span>
                <span><b className="font-semibold text-ink">{detail.columns.length}</b> columns</span>
                <span><b className="font-semibold text-ink">{formatBytes(detail.tableBytes)}</b> data</span>
                <span><b className="font-semibold text-ink">{formatBytes(detail.indexBytes)}</b> in {detail.indexes.length} indexes</span>
                {detail.referencedBy.length > 0 && <span>referenced by <b className="font-semibold text-ink">{detail.referencedBy.map((r) => r.table).join(', ')}</b></span>}
              </div>
            </div>

            <div className="mb-4 overflow-x-auto">
              <SegmentedControl size="sm" value={section} onChange={setSection} ariaLabel="Table details" options={SECTIONS.map(([id, label, icon]) => [id, label, icon, id === 'columns' ? detail.columns.length : id === 'indexes' ? detail.indexes.length : id === 'constraints' ? detail.constraints.length : id === 'triggers' ? detail.triggers.length : undefined])} />
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={`${detail.name}-${section}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                {section === 'data' && <DataView table={detail.name} onOpenTable={(t) => setSelected(t)} />}
                {section === 'columns' && <ColumnsView detail={detail} onOpen={(t) => setSelected(t)} />}
                {section === 'indexes' && <IndexesView detail={detail} />}
                {section === 'constraints' && <ConstraintsView detail={detail} onOpen={(t) => setSelected(t)} />}
                {section === 'triggers' && <TriggersView detail={detail} />}
                {section === 'ddl' && <CodeBlock code={detail.ddl} />}
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </section>
    </div>
  );
}

function DataView({ table, onOpenTable }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [inspecting, setInspecting] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.db.rows(table, { page, pageSize: 50, search })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [table, page, search]);

  useEffect(() => {
    const timer = setTimeout(load, 180);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => setPage(1), [search, table]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search any column…" />
        {data && <span className="text-[12.5px] text-ink-3">Newest first · click a row number to open it · click a cell to copy</span>}
      </div>
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      {!data ? (
        <div className="skeleton h-80 rounded-[16px]" />
      ) : data.rows.length === 0 ? (
        <p className="panel px-6 py-12 text-center text-[13.5px] text-ink-3">{search ? 'No rows match.' : 'This table is empty.'}</p>
      ) : (
        <div className={cn('transition-opacity', loading && 'opacity-60')}>
          <ResultGrid
            columns={data.columns}
            rows={data.rows}
            rowObjects
            maxHeight={560}
            onOpenRow={(index) => {
              const key = data.columns.find((c) => c.primaryKey)?.name || data.columns[0].name;
              setInspecting({ table: data.table, id: data.rows[index][key] });
            }}
          />
        </div>
      )}
      {data && <Pagination meta={{ total: data.total, page: data.page, pageCount: data.pageCount, pageSize: data.pageSize }} page={page} onPage={setPage} loading={loading} />}

      <AnimatePresence>
        {inspecting && (
          <RowInspector
            key={`${inspecting.table}-${inspecting.id}`}
            table={inspecting.table}
            id={inspecting.id}
            onClose={() => setInspecting(null)}
            onOpenRow={(nextTable, nextId) => setInspecting({ table: nextTable, id: nextId })}
            onOpenTable={(nextTable) => {
              setInspecting(null);
              onOpenTable?.(nextTable);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ColumnsView({ detail, onOpen }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="text-left text-[12px] text-ink-3" style={{ background: 'var(--wash)' }}>
            <th className="px-4 py-2.5 font-medium">#</th>
            <th className="px-4 py-2.5 font-medium">Column</th>
            <th className="px-4 py-2.5 font-medium">Type</th>
            <th className="px-4 py-2.5 font-medium">Null</th>
            <th className="px-4 py-2.5 font-medium">Default</th>
            <th className="px-4 py-2.5 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {detail.columns.map((c) => (
            <tr key={c.name} className="align-top transition-colors hover:bg-[var(--wash)]" style={{ borderTop: '1px solid var(--line)' }}>
              <td className="px-4 py-2.5 text-ink-3 tabular">{c.position}</td>
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-1.5 font-medium" style={{ fontFamily: MONO_FONT }}>
                  {c.primaryKey && <KeyRound size={12} className="text-warning" />}
                  {c.references && <Link2 size={12} className="text-accent" />}
                  {c.name}
                </span>
              </td>
              <td className="px-4 py-2.5 text-ink-2" style={{ fontFamily: MONO_FONT }}>{c.type}</td>
              <td className="px-4 py-2.5">{c.nullable ? <span className="text-ink-3">yes</span> : <Badge tone="slate">not null</Badge>}</td>
              <td className="max-w-[180px] truncate px-4 py-2.5 text-ink-2" style={{ fontFamily: MONO_FONT }} title={c.default || ''}>{c.identity ? `identity (${c.identity})` : c.generatedAs ? `generated: ${c.generatedAs}` : c.default || <span className="text-ink-3">—</span>}</td>
              <td className="px-4 py-2.5 text-[12.5px] text-ink-2">
                <div className="flex flex-wrap gap-1.5">
                  {c.primaryKey && <Badge tone="amber">primary key</Badge>}
                  {!c.primaryKey && c.unique && <Badge tone="violet">unique</Badge>}
                  {c.references && <button type="button" onClick={() => onOpen(c.references)}><Badge tone="blue">→ {c.references}</Badge></button>}
                </div>
                {c.comment && <p className="mt-1 max-w-sm leading-relaxed">{c.comment}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IndexesView({ detail }) {
  const maxScans = Math.max(...detail.indexes.map((i) => Number(i.scans) || 0), 1);
  return (
    <ul className="space-y-2">
      {detail.indexes.map((ix, i) => (
        <motion.li key={ix.name} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold" style={{ fontFamily: MONO_FONT }}>{ix.name}</span>
            {ix.primary && <Badge tone="amber">primary</Badge>}
            {!ix.primary && ix.unique && <Badge tone="violet">unique</Badge>}
            {ix.partial && <Badge tone="green">partial</Badge>}
            <Badge tone="slate">{ix.method}</Badge>
            <span className="ml-auto text-[12px] text-ink-3 tabular">{formatBytes(ix.sizeBytes)} · {formatNumber(ix.scans)} scans</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: 'var(--chart-track)' }}>
            <motion.div className="h-full rounded-full" style={{ background: 'var(--series-1)' }} initial={{ width: 0 }} animate={{ width: `${((Number(ix.scans) || 0) / maxScans) * 100}%` }} transition={{ type: 'spring', stiffness: 90, damping: 20, delay: 0.1 + i * 0.03 }} />
          </div>
          <CodeLine code={ix.definition} />
        </motion.li>
      ))}
    </ul>
  );
}

const KIND_TONE = { 'primary key': 'amber', 'foreign key': 'blue', unique: 'violet', check: 'green' };

function ConstraintsView({ detail, onOpen }) {
  return (
    <div className="space-y-6">
      <ul className="space-y-2">
        {detail.constraints.map((c) => (
          <li key={c.name} className="panel p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={KIND_TONE[c.kind] || 'slate'}>{c.kind}</Badge>
              <span className="text-[13px] font-medium" style={{ fontFamily: MONO_FONT }}>{c.name}</span>
              {c.deferrable && <Badge tone="slate">{c.deferred ? 'deferred' : 'deferrable'}</Badge>}
              {c.foreignTable && <button type="button" className="ml-auto text-[12px] text-accent-ink hover:underline" onClick={() => onOpen(c.foreignTable)}>open {c.foreignTable} →</button>}
            </div>
            <CodeLine code={c.definition} />
          </li>
        ))}
      </ul>
      {detail.referencedBy.length > 0 && (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-ink-2">Other tables that point here</h3>
          <ul className="space-y-2">
            {detail.referencedBy.map((r) => (
              <li key={r.name} className="panel flex flex-wrap items-center gap-2 p-4">
                <button type="button" onClick={() => onOpen(r.table)}><Badge tone="blue">{r.table}</Badge></button>
                <CodeLine code={r.definition} inline />
                <span className="ml-auto text-[12px] text-ink-3">on delete: <b className="font-medium text-ink-2">{r.onDelete}</b></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TriggersView({ detail }) {
  if (!detail.triggers.length) return <p className="panel px-6 py-12 text-center text-[13.5px] text-ink-3">No triggers on this table.</p>;
  return (
    <ul className="space-y-2">
      {detail.triggers.map((t) => (
        <li key={t.name} className="panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Zap size={14} className="text-warning" />
            <span className="text-[13.5px] font-semibold" style={{ fontFamily: MONO_FONT }}>{t.name}</span>
            {t.constraint && <Badge tone="violet">constraint trigger</Badge>}
            {!t.enabled && <Badge tone="red">disabled</Badge>}
            <span className="ml-auto text-[12px] text-ink-3">runs <code style={{ fontFamily: MONO_FONT }}>{t.function}()</code></span>
          </div>
          {t.description && <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t.description}</p>}
          <CodeLine code={t.definition} />
        </li>
      ))}
    </ul>
  );
}

function Highlighted({ code }) {
  const tokens = useMemo(() => tokenize(code || ''), [code]);
  return tokens.map((t, i) => (
    <span key={i} style={{ color: TOKEN_COLORS[t.type], fontWeight: t.type === 'keyword' ? 600 : undefined }}>{t.text}</span>
  ));
}

function CodeLine({ code, inline }) {
  return (
    <code className={cn('block overflow-x-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed', inline ? 'min-w-0' : 'mt-2 rounded-[10px] px-3 py-2')} style={{ fontFamily: MONO_FONT, background: inline ? undefined : 'rgb(var(--c-sunken))' }}>
      <Highlighted code={code} />
    </code>
  );
}

export function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        className="btn-secondary btn-sm absolute right-3 top-3 z-10"
        onClick={() => navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {})}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
      </button>
      <pre className="overflow-x-auto rounded-[18px] p-5 text-[12.5px] leading-[1.7]" style={{ fontFamily: MONO_FONT, background: 'rgb(var(--c-sunken))', boxShadow: 'inset 0 0 0 1px var(--line)' }} data-lenis-prevent>
        <Highlighted code={code} />
      </pre>
    </div>
  );
}
