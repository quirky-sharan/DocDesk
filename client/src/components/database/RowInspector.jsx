import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Boxes, History, KeyRound, Link2, Table2 } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, ErrorNote, Modal, SegmentedControl, Spinner } from '../ui';
import { MONO_FONT } from './SqlEditor';
import { formatDateTime, formatNumber, formatRelative } from '../../lib/format';
import { cn } from '../../lib/cn';

const ACTION = { INSERT: { label: 'Created', tone: 'green' }, UPDATE: { label: 'Changed', tone: 'blue' }, DELETE: { label: 'Deleted', tone: 'red' } };
const ACTORS = { web: 'you, in the app', assistant: 'the assistant', 'sql-console': 'the SQL console', 'sample-data': 'sample data', import: 'the import', system: 'the system' };

function show(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/**
 * One row, opened: its values, the records it points at, what points back at
 * it, and everything that has ever happened to it. This is the join between the
 * table browser and the audit trail.
 */
export default function RowInspector({ table, id, onClose, onOpenTable, onOpenRow }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('fields');

  useEffect(() => {
    setData(null);
    api.db.row(table, id).then(setData).catch((err) => setError(err.message));
  }, [table, id]);

  const title = data ? (data.row.name || data.row.reference || data.row.original_name || data.row.subject || `${table} #${id}`) : `${table} #${id}`;

  return (
    <Modal
      title={String(title)}
      subtitle={`${table} · ${data?.key || 'id'} ${id}`}
      icon={Table2}
      onClose={onClose}
      size="xl"
    >
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      {!data ? (
        <div className="grid h-40 place-items-center"><Spinner size={22} /></div>
      ) : (
        <>
          <SegmentedControl
            size="sm"
            className="mb-4"
            value={view}
            onChange={setView}
            ariaLabel="What to show"
            options={[
              ['fields', 'Values', KeyRound, data.columns.length],
              ['links', 'Links', Link2, data.references.length + data.referencedBy.filter((r) => r.count > 0).length],
              ['history', 'History', History, data.history.length],
            ]}
          />

          {view === 'fields' && (
            <dl className="overflow-hidden rounded-[16px]" style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}>
              {data.columns.map((c, i) => {
                const raw = data.row[c.name];
                // Dates read as dates here; the exact stored value is still in the table view.
                const value = /^timestamp/.test(c.type) && raw ? formatDateTime(raw) : show(raw);
                return (
                  <div key={c.name} className="grid grid-cols-[minmax(120px,180px)_1fr] gap-4 px-4 py-2" style={{ borderTop: i ? '1px solid var(--line)' : undefined, background: i % 2 ? 'var(--wash)' : undefined }}>
                    <dt className="flex min-w-0 items-center gap-1.5 text-[12.5px]" style={{ fontFamily: MONO_FONT }}>
                      {c.primaryKey && <KeyRound size={11} className="shrink-0 text-warning" />}
                      {c.references && <Link2 size={11} className="shrink-0 text-accent" />}
                      <span className="truncate">{c.name}</span>
                    </dt>
                    <dd className="min-w-0 break-words text-[13px]" style={{ fontFamily: MONO_FONT }}>
                      {value === null ? <span className="rounded px-1 text-[10.5px] font-semibold text-ink-3" style={{ background: 'var(--wash-strong)' }}>NULL</span> : <span className="whitespace-pre-wrap">{value}</span>}
                      <span className="ml-2 text-[11px] text-ink-3">{c.type}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}

          {view === 'links' && (
            <div className="space-y-5">
              <section>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">Points at</h3>
                {data.references.length === 0 ? (
                  <p className="text-[13px] text-ink-3">This row doesn&apos;t reference anything.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.references.map((r) => (
                      <li key={r.column}>
                        <button type="button" onClick={() => onOpenRow(r.table, r.id)} className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-[var(--wash)]" style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                          <Link2 size={14} className="shrink-0 text-accent" />
                          <span className="text-[12.5px] text-ink-3" style={{ fontFamily: MONO_FONT }}>{r.column}</span>
                          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{r.label ?? `#${r.id}`}</span>
                          <Badge tone="slate">{r.table}</Badge>
                          <ArrowUpRight size={14} className="shrink-0 text-ink-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">Pointed at by</h3>
                {data.referencedBy.every((r) => r.count === 0) ? (
                  <p className="text-[13px] text-ink-3">Nothing references this row, so deleting it would affect nothing else.</p>
                ) : (
                  <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {data.referencedBy.filter((r) => r.count > 0).map((r) => (
                      <li key={`${r.table}.${r.column}`}>
                        <button type="button" onClick={() => onOpenTable(r.table)} className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-[var(--wash)]" style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                          <Boxes size={14} className="shrink-0 text-ink-3" />
                          <span className="min-w-0 flex-1 truncate text-[13px]" style={{ fontFamily: MONO_FONT }}>{r.table}.{r.column}</span>
                          <span className="text-[13px] font-semibold tabular">{formatNumber(r.count)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          {view === 'history' && (
            data.history.length === 0 ? (
              <p className="py-10 text-center text-[13.5px] text-ink-3">Nothing recorded for this row - the audit trail starts when a change is made through DocDesk.</p>
            ) : (
              <ol className="relative space-y-2.5 pl-5">
                <span aria-hidden="true" className="absolute bottom-2 left-[5px] top-2 w-px bg-[var(--line-strong)]" />
                {data.history.map((entry, i) => {
                  const act = ACTION[entry.action] || ACTION.UPDATE;
                  const fields = (entry.changed_fields || []).filter((f) => f !== 'row_version' && f !== 'updated_at');
                  return (
                    <motion.li key={entry.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="relative rounded-[14px] px-3.5 py-2.5" style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                      <span className={cn('absolute -left-[17px] top-4 h-2.5 w-2.5 rounded-full')} style={{ background: act.tone === 'green' ? 'rgb(var(--c-success))' : act.tone === 'red' ? 'rgb(var(--c-danger))' : 'rgb(var(--c-accent))', boxShadow: '0 0 0 3px rgb(var(--c-elevated))' }} />
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={act.tone}>{act.label}</Badge>
                        <span className="text-[12.5px] text-ink-2">by {ACTORS[entry.actor] || entry.actor}</span>
                        <span className="ml-auto text-[11.5px] text-ink-3" title={formatDateTime(entry.created_at)}>{formatRelative(entry.created_at)}</span>
                      </div>
                      {fields.length > 0 && (
                        <dl className="mt-2 space-y-1 text-[12.5px]" style={{ fontFamily: MONO_FONT }}>
                          {fields.map((f) => (
                            <div key={f} className="flex flex-wrap items-baseline gap-2">
                              <dt className="w-32 shrink-0 truncate text-ink-3">{f}</dt>
                              <dd className="min-w-0">
                                <span className="rounded px-1.5 py-0.5 text-ink-2 line-through" style={{ background: 'var(--danger-soft)' }}>{show(entry.old_data?.[f]) ?? 'NULL'}</span>
                                <span className="mx-1.5 text-ink-3">→</span>
                                <span className="rounded px-1.5 py-0.5" style={{ background: 'var(--success-soft)' }}>{show(entry.new_data?.[f]) ?? 'NULL'}</span>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </motion.li>
                  );
                })}
              </ol>
            )
          )}
        </>
      )}
    </Modal>
  );
}
