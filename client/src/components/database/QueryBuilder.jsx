import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Filter, Link2, ListOrdered, Play, Plus, Sigma, Table2, Trash2, X } from 'lucide-react';
import { TOKEN_COLORS, formatSql, tokenize } from './sql';
import { MONO_FONT } from './SqlEditor';
import { cn } from '../../lib/cn';

const AGGREGATES = [
  ['', 'the value'],
  ['count', 'count of'],
  ['sum', 'sum of'],
  ['avg', 'average of'],
  ['min', 'smallest'],
  ['max', 'largest'],
];

const OPERATORS = [
  ['=', 'is'],
  ['<>', 'is not'],
  ['>', 'more than'],
  ['<', 'less than'],
  ['>=', 'at least'],
  ['<=', 'at most'],
  ['ILIKE', 'contains'],
  ['IS NULL', 'is empty'],
  ['IS NOT NULL', 'is not empty'],
];

const NUMERIC = /^(smallint|integer|bigint|numeric|real|double|money)/;
const DATEISH = /^(date|timestamp)/;

function quote(value, type) {
  if (value === '') return "''";
  if (NUMERIC.test(type) && Number.isFinite(Number(value))) return String(Number(value));
  if (value === 'true' || value === 'false') return value;
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Builds a SELECT by picking things rather than typing them: a table, the
 * columns (optionally totalled), joins suggested from the real foreign keys,
 * filters, grouping and ordering. The SQL it writes is shown as it is built, so
 * this reads as a way to learn the language rather than a way to avoid it.
 */
export default function QueryBuilder({ schema, relationships = [], onUse, onRun }) {
  const tables = schema?.tables || [];
  const [base, setBase] = useState('');
  const [joins, setJoins] = useState([]);
  const [picked, setPicked] = useState([]);
  const [filters, setFilters] = useState([]);
  const [order, setOrder] = useState(null);
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    if (!base && tables.length) setBase(tables.find((t) => t.name === 'sales')?.name || tables[0].name);
  }, [tables, base]);

  function reset(next) {
    setBase(next);
    setJoins([]);
    setPicked([]);
    setFilters([]);
    setOrder(null);
  }

  // Tables reachable from what is already in the query, in either direction.
  const available = useMemo(() => {
    const inQuery = new Set([base, ...joins.map((j) => j.table)]);
    const out = [];
    for (const r of relationships) {
      if (inQuery.has(r.from.table) && !inQuery.has(r.to.table)) {
        out.push({ table: r.to.table, on: `${r.from.table}.${r.from.columns[0]} = ${r.to.table}.${r.to.columns[0]}`, via: r.from.table });
      } else if (inQuery.has(r.to.table) && !inQuery.has(r.from.table)) {
        out.push({ table: r.from.table, on: `${r.from.table}.${r.from.columns[0]} = ${r.to.table}.${r.to.columns[0]}`, via: r.to.table });
      }
    }
    return out.filter((item, i) => out.findIndex((o) => o.table === item.table) === i);
  }, [base, joins, relationships]);

  const columns = useMemo(() => {
    const inQuery = [base, ...joins.map((j) => j.table)].filter(Boolean);
    return inQuery.flatMap((name) => (tables.find((t) => t.name === name)?.columns || []).map((c) => ({ ...c, table: name, id: `${name}.${c.name}` })));
  }, [base, joins, tables]);

  const sql = useMemo(() => {
    if (!base) return '';
    const grouped = picked.some((p) => p.aggregate);
    const select = picked.length
      ? picked.map((p) => {
          const expression = p.aggregate ? `${p.aggregate}(${p.aggregate === 'count' ? p.id : p.id})` : p.id;
          const alias = p.aggregate ? ` AS ${p.aggregate}_${p.id.split('.')[1]}` : '';
          return expression + alias;
        })
      : ['*'];
    const lines = [`SELECT ${select.join(', ')}`, `FROM ${base}`];
    for (const j of joins) lines.push(`${j.kind} JOIN ${j.table} ON ${j.on}`);
    if (filters.length) {
      lines.push(
        `WHERE ${filters
          .map((f) => {
            if (f.operator === 'IS NULL' || f.operator === 'IS NOT NULL') return `${f.column} ${f.operator}`;
            if (f.operator === 'ILIKE') return `${f.column} ILIKE '%${String(f.value).replace(/'/g, "''")}%'`;
            return `${f.column} ${f.operator} ${quote(f.value, f.type)}`;
          })
          .join('\n  AND ')}`
      );
    }
    if (grouped) {
      const plain = picked.filter((p) => !p.aggregate).map((p) => p.id);
      if (plain.length) lines.push(`GROUP BY ${plain.join(', ')}`);
    }
    if (order) lines.push(`ORDER BY ${order.expression} ${order.dir.toUpperCase()}`);
    lines.push(`LIMIT ${limit}`);
    return formatSql(lines.join('\n'));
  }, [base, joins, picked, filters, order, limit]);

  const toggleColumn = (column) => {
    setPicked((list) => (list.some((p) => p.id === column.id) ? list.filter((p) => p.id !== column.id) : [...list, { id: column.id, type: column.type, aggregate: '' }]));
  };

  if (!tables.length) return <div className="skeleton h-72 rounded-[18px]" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section icon={Table2} title="Start from" hint="The table the query reads first.">
          <div className="flex flex-wrap gap-1.5">
            {tables.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => reset(t.name)}
                className={cn('rounded-full px-2.5 py-1 text-[12px] transition-colors', base === t.name ? 'bg-accent text-white' : 'text-ink-2 hover:text-ink')}
                style={{ background: base === t.name ? undefined : 'var(--wash-strong)', fontFamily: MONO_FONT }}
              >
                {t.name}
              </button>
            ))}
          </div>
        </Section>

        <Section icon={Link2} title="Join" hint="Only tables a foreign key actually connects.">
          <div className="flex flex-wrap gap-1.5">
            {joins.map((j) => (
              <span key={j.table} className="flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[12px] text-accent-ink" style={{ fontFamily: MONO_FONT }}>
                {j.table}
                <button type="button" onClick={() => { setJoins((list) => list.filter((x) => x.table !== j.table)); setPicked((list) => list.filter((p) => !p.id.startsWith(`${j.table}.`))); }} aria-label={`Remove ${j.table}`}>
                  <X size={11} />
                </button>
              </span>
            ))}
            {available.map((a) => (
              <button key={a.table} type="button" onClick={() => setJoins((list) => [...list, { ...a, kind: 'LEFT' }])} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] text-ink-2 hover:text-ink" style={{ background: 'var(--wash-strong)', fontFamily: MONO_FONT }}>
                <Plus size={11} /> {a.table}
              </button>
            ))}
            {!available.length && !joins.length && <p className="text-[12.5px] text-ink-3">Nothing links to this table.</p>}
          </div>
        </Section>
      </div>

      <Section icon={Sigma} title="Show" hint="Nothing picked means every column. Pick a total to group the rest.">
        <div className="max-h-56 space-y-1 overflow-y-auto pr-1" data-lenis-prevent>
          {columns.map((c) => {
            const chosen = picked.find((p) => p.id === c.id);
            return (
              <div key={c.id} className={cn('flex flex-wrap items-center gap-2 rounded-[10px] px-2 py-1', chosen && 'bg-[var(--wash)]')}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={Boolean(chosen)} onChange={() => toggleColumn(c)} className="accent-[rgb(var(--c-accent))]" />
                  <span className="truncate text-[12.5px]" style={{ fontFamily: MONO_FONT }}>
                    <span className="text-ink-3">{c.table}.</span>{c.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-3">{c.type}</span>
                </label>
                {chosen && (
                  <select
                    className="input-field h-7 w-auto py-0 text-[12px]"
                    value={chosen.aggregate}
                    onChange={(e) => setPicked((list) => list.map((p) => (p.id === c.id ? { ...p, aggregate: e.target.value } : p)))}
                  >
                    {AGGREGATES.filter(([value]) => !value || value === 'count' || NUMERIC.test(c.type)).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section icon={Filter} title="Only rows where" hint="Every condition must hold.">
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {filters.map((f, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-wrap items-center gap-1.5">
                  <select className="input-field h-8 w-auto py-0 text-[12.5px]" value={f.column} onChange={(e) => { const col = columns.find((c) => c.id === e.target.value); setFilters((list) => list.map((x, n) => (n === i ? { ...x, column: e.target.value, type: col?.type || 'text' } : x))); }}>
                    {columns.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
                  </select>
                  <select className="input-field h-8 w-auto py-0 text-[12.5px]" value={f.operator} onChange={(e) => setFilters((list) => list.map((x, n) => (n === i ? { ...x, operator: e.target.value } : x)))}>
                    {OPERATORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  {!f.operator.startsWith('IS') && (
                    <input
                      className="input-field h-8 w-28 py-0 text-[12.5px]"
                      value={f.value}
                      placeholder={DATEISH.test(f.type) ? 'YYYY-MM-DD' : NUMERIC.test(f.type) ? '0' : 'text'}
                      onChange={(e) => setFilters((list) => list.map((x, n) => (n === i ? { ...x, value: e.target.value } : x)))}
                    />
                  )}
                  <button type="button" className="btn-edit btn-icon" onClick={() => setFilters((list) => list.filter((_, n) => n !== i))} aria-label="Remove condition"><Trash2 size={13} /></button>
                </motion.div>
              ))}
            </AnimatePresence>
            <button type="button" className="btn-secondary btn-sm" disabled={!columns.length} onClick={() => setFilters((list) => [...list, { column: columns[0].id, type: columns[0].type, operator: '=', value: '' }])}>
              <Plus size={13} /> Add a condition
            </button>
          </div>
        </Section>

        <Section icon={ListOrdered} title="Order and limit">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input-field h-8 w-auto py-0 text-[12.5px]"
              value={order?.expression || ''}
              onChange={(e) => setOrder(e.target.value ? { expression: e.target.value, dir: order?.dir || 'desc' } : null)}
            >
              <option value="">no particular order</option>
              {picked.filter((p) => p.aggregate).map((p) => <option key={p.id} value={`${p.aggregate}(${p.id})`}>{`${p.aggregate}(${p.id})`}</option>)}
              {columns.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
            </select>
            {order && (
              <div className="flex gap-1">
                {['desc', 'asc'].map((d) => (
                  <button key={d} type="button" onClick={() => setOrder({ ...order, dir: d })} className={cn('rounded-full px-2.5 py-1 text-[12px]', order.dir === d ? 'bg-accent text-white' : 'text-ink-2')} style={{ background: order.dir === d ? undefined : 'var(--wash-strong)' }}>
                    {d === 'desc' ? 'highest first' : 'lowest first'}
                  </button>
                ))}
              </div>
            )}
            <label className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-2">
              at most
              <input type="number" min="1" max="1000" value={limit} onChange={(e) => setLimit(Math.min(Math.max(Number(e.target.value) || 1, 1), 1000))} className="input-field h-8 w-20 py-0 text-[12.5px]" />
            </label>
          </div>
        </Section>
      </div>

      <div className="rounded-[18px] p-4" style={{ background: 'rgb(var(--c-sunken))', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
        <p className="mb-2 text-[12px] font-medium text-ink-3">The SQL this writes</p>
        <pre className="overflow-x-auto text-[12.5px] leading-relaxed" style={{ fontFamily: MONO_FONT }} data-lenis-prevent>
          {tokenize(sql).map((t, i) => (
            <span key={i} style={{ color: TOKEN_COLORS[t.type], fontWeight: t.type === 'keyword' ? 600 : undefined }}>{t.text}</span>
          ))}
        </pre>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={!sql} onClick={() => onRun(sql)}><Play size={15} /> Run it</button>
          <button type="button" className="btn-secondary" disabled={!sql} onClick={() => onUse(sql)}>Open in the editor <ArrowRight size={14} /></button>
        </div>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, hint, children }) {
  return (
    <section className="rounded-[18px] p-4" style={{ background: 'rgb(var(--c-surface))', boxShadow: '0 0 0 1px var(--line)' }}>
      <div className="mb-3 flex items-baseline gap-2">
        <Icon size={14} className="translate-y-0.5 text-ink-3" />
        <h3 className="text-[13.5px] font-semibold">{title}</h3>
        {hint && <p className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
