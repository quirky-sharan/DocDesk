import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bot, ChevronDown, Database, FilePlus2, FileX2, History, PackageCheck, PenLine, ShieldCheck, TerminalSquare, UserRound } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Empty, ErrorNote, Pagination, SegmentedControl } from '../ui';
import { MONO_FONT } from './SqlEditor';
import { formatDateTime, formatRelative, formatTime, parseDate } from '../../lib/format';
import { cn } from '../../lib/cn';

const ACTORS = {
  web: { label: 'You, in the app', icon: UserRound },
  assistant: { label: 'The assistant', icon: Bot },
  'sql-console': { label: 'SQL console', icon: TerminalSquare },
  'integrity-check': { label: 'Integrity fix', icon: ShieldCheck },
  'sample-data': { label: 'Sample data', icon: PackageCheck },
  import: { label: 'Import', icon: PackageCheck },
  system: { label: 'System', icon: Database },
};

const ACTIONS = {
  INSERT: { label: 'Created', tone: 'green', icon: FilePlus2 },
  UPDATE: { label: 'Changed', tone: 'blue', icon: PenLine },
  DELETE: { label: 'Deleted', tone: 'red', icon: FileX2 },
};

const INTERNAL = new Set(['row_version', 'updated_at']);

function recordName(entry) {
  const data = entry.new_data || entry.old_data || {};
  return data.name || data.reference || data.original_name || data.subject || data.key || entry.record_key || (entry.record_id ? `#${entry.record_id}` : '');
}

export default function ActivityTab({ initialTable, onNavigate }) {
  const [table, setTable] = useState(initialTable || '');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.db.activity({ table, action, actor, page, pageSize: 30, sort: 'created_at', dir: 'desc' })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [table, action, actor, page]);

  useEffect(load, [load]);
  useEffect(() => setPage(1), [table, action, actor]);

  const groups = useMemo(() => {
    const out = [];
    for (const entry of data?.rows || []) {
      const d = parseDate(entry.created_at);
      const key = d ? d.toDateString() : '';
      if (!out.length || out[out.length - 1].key !== key) out.push({ key, date: d, items: [] });
      out[out.length - 1].items.push(entry);
    }
    return out;
  }, [data]);

  const facets = data?.facets;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-32 lg:self-start">
        <div className="panel p-3">
          <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">Table</p>
          <ul className="max-h-[36vh] space-y-0.5 overflow-y-auto" data-lenis-prevent>
            <FacetButton active={!table} onClick={() => setTable('')} label="All tables" />
            {facets?.tables.map((t) => <FacetButton key={t.table_name} active={table === t.table_name} onClick={() => setTable(t.table_name)} label={t.table_name} count={t.n} mono />)}
          </ul>
        </div>
        <div className="panel p-3">
          <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">Made by</p>
          <ul className="space-y-0.5">
            <FacetButton active={!actor} onClick={() => setActor('')} label="Anyone" />
            {facets?.actors.map((a) => {
              const meta = ACTORS[a.actor];
              return <FacetButton key={a.actor} active={actor === a.actor} onClick={() => setActor(a.actor)} label={meta?.label || a.actor} icon={meta?.icon} count={a.n} />;
            })}
          </ul>
        </div>
      </aside>

      <section className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SegmentedControl size="sm" value={action} onChange={setAction} ariaLabel="Kind of change" options={[['', 'Everything'], ['INSERT', 'Created', FilePlus2], ['UPDATE', 'Changed', PenLine], ['DELETE', 'Deleted', FileX2]]} />
          {data && <span className="text-[12.5px] text-ink-3">{data.total.toLocaleString()} change{data.total === 1 ? '' : 's'} recorded by the audit trigger</span>}
        </div>
        <ErrorNote error={error} onDismiss={() => setError(null)} />

        {!data ? (
          <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-16 rounded-[16px]" />)}</div>
        ) : data.rows.length === 0 ? (
          <Empty icon={History} title="No changes recorded" message="Every insert, update and delete made from now on shows up here with the values before and after. Sample data is loaded without history." />
        ) : (
          <div className={cn('transition-opacity', loading && 'opacity-60')}>
            {groups.map((g) => (
              <div key={g.key} className="mb-6">
                <h3 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                  {g.date ? g.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : ''}
                </h3>
                <ol className="relative space-y-2 pl-6">
                  <span aria-hidden="true" className="absolute bottom-3 left-[9px] top-3 w-px bg-[var(--line-strong)]" />
                  {g.items.map((entry, i) => {
                    const act = ACTIONS[entry.action] || ACTIONS.UPDATE;
                    const who = ACTORS[entry.actor] || { label: entry.actor, icon: UserRound };
                    const WhoIcon = who.icon;
                    const ActIcon = act.icon;
                    const fields = (entry.changed_fields || []).filter((f) => !INTERNAL.has(f));
                    const expanded = open === entry.id;
                    return (
                      <motion.li key={entry.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }} className="relative">
                        <span className="absolute -left-6 top-4 grid h-[19px] w-[19px] place-items-center rounded-full" style={{ background: `var(--${act.tone === 'green' ? 'success' : act.tone === 'red' ? 'danger' : 'accent'}-soft)`, boxShadow: '0 0 0 3px rgb(var(--c-canvas))' }}>
                          <ActIcon size={10} style={{ color: act.tone === 'green' ? 'rgb(var(--c-success))' : act.tone === 'red' ? 'rgb(var(--c-danger))' : 'rgb(var(--c-accent))' }} />
                        </span>
                        <div className="panel overflow-hidden">
                          <div role="button" tabIndex={0} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : entry.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(expanded ? null : entry.id); } }} className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
                            <Badge tone={act.tone}>{act.label}</Badge>
                            <button type="button" onClick={(e) => { e.stopPropagation(); onNavigate('tables', { table: entry.table_name }); }} className="text-[12.5px] text-ink-3 hover:text-accent-ink" style={{ fontFamily: MONO_FONT }}>{entry.table_name}</button>
                            <span className="min-w-0 truncate text-[14px] font-medium">{recordName(entry)}</span>
                            {entry.action === 'UPDATE' && fields.length > 0 && <span className="truncate text-[12.5px] text-ink-2">{fields.slice(0, 3).map((f) => f.replace(/_/g, ' ')).join(', ')}{fields.length > 3 ? ` +${fields.length - 3}` : ''}</span>}
                            <span className="ml-auto flex items-center gap-2 text-[12px] text-ink-3">
                              <WhoIcon size={12} /> {who.label} · <span title={formatDateTime(entry.created_at)}>{formatTime(entry.created_at)}</span>
                              <ChevronDown size={14} className={cn('transition-transform', expanded && 'rotate-180')} />
                            </span>
                          </div>
                          <AnimatePresence initial={false}>
                            {expanded && (
                              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                                <Diff entry={entry} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.li>
                    );
                  })}
                </ol>
              </div>
            ))}
            <Pagination meta={data} page={page} onPage={setPage} loading={loading} />
          </div>
        )}
      </section>
    </div>
  );
}

function FacetButton({ active, onClick, label, count, icon: Icon, mono }) {
  return (
    <li>
      <button type="button" onClick={onClick} className={cn('flex w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-[13px] transition-colors', active ? 'bg-[var(--accent-soft)] font-medium text-accent-ink' : 'text-ink-2 hover:bg-[var(--wash)]')}>
        {Icon && <Icon size={13} className="shrink-0" />}
        <span className="truncate" style={mono ? { fontFamily: MONO_FONT, fontSize: 12.5 } : undefined}>{label}</span>
        {count !== undefined && <span className="ml-auto text-[11px] text-ink-3 tabular">{Number(count).toLocaleString()}</span>}
      </button>
    </li>
  );
}

function show(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function Diff({ entry }) {
  const before = entry.old_data || {};
  const after = entry.new_data || {};
  const keys = entry.action === 'UPDATE' ? (entry.changed_fields || []) : Object.keys(entry.action === 'DELETE' ? before : after);
  return (
    <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--line)' }}>
      <table className="mt-3 w-full text-[12.5px]" style={{ fontFamily: MONO_FONT }}>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="align-top">
              <td className="w-40 py-1 pr-4 text-ink-3">{k}</td>
              {entry.action === 'UPDATE' ? (
                <td className="py-1">
                  <span className="rounded px-1.5 py-0.5 text-ink-2 line-through decoration-[rgb(var(--c-danger)/0.5)]" style={{ background: 'var(--danger-soft)' }}>{show(before[k])}</span>
                  <span className="mx-2 text-ink-3">→</span>
                  <span className="rounded px-1.5 py-0.5" style={{ background: 'var(--success-soft)' }}>{show(after[k])}</span>
                </td>
              ) : (
                <td className="break-all py-1" style={{ color: entry.action === 'DELETE' ? 'rgb(var(--c-text-2))' : undefined }}>{show((entry.action === 'DELETE' ? before : after)[k])}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11.5px] text-ink-3" style={{ fontFamily: 'inherit' }}>
        {formatDateTime(entry.created_at)} ({formatRelative(entry.created_at)}) · audit entry #{entry.id}{entry.txid ? ` · transaction ${entry.txid}` : ''}
      </p>
    </div>
  );
}

