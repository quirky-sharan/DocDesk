import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, ChevronRight, Clock, Filter, Layers, Rows3, Zap } from 'lucide-react';
import { cn } from '../../lib/cn';

// What each plan step means, in a sentence someone new to databases can follow.
const NODE_HELP = {
  'Seq Scan': 'Reads every row of the table, one after another.',
  'Index Scan': 'Jumps straight to matching rows using an index, then reads them.',
  'Index Only Scan': 'Answers from the index alone without touching the table.',
  'Bitmap Heap Scan': 'Reads the table pages an index said contain matches.',
  'Bitmap Index Scan': 'Uses an index to mark which pages hold matching rows.',
  'Hash Join': 'Builds a lookup table from one side, then probes it with the other.',
  'Merge Join': 'Walks two sorted inputs side by side, pairing matches.',
  'Nested Loop': 'For each row on one side, looks up matches on the other.',
  Hash: 'Builds the in-memory lookup table a hash join probes.',
  Sort: 'Puts rows in order.',
  'Incremental Sort': 'Sorts in batches on input that is already partly ordered.',
  Aggregate: 'Combines rows into totals - sum, count, average.',
  HashAggregate: 'Groups rows using a hash table, then totals each group.',
  GroupAggregate: 'Totals groups from input that is already sorted.',
  Limit: 'Stops once enough rows have been produced.',
  Materialize: 'Keeps rows in memory so they can be re-read cheaply.',
  Memoize: 'Caches lookups so repeated keys are not fetched twice.',
  'Function Scan': 'Reads rows produced by a set-returning function.',
  'Subquery Scan': 'Reads the output of a subquery.',
  'CTE Scan': 'Reads the output of a WITH query.',
  Result: 'Computes a value without reading a table.',
  Append: 'Joins the outputs of several steps one after another.',
  Gather: 'Collects rows from parallel workers.',
  WindowAgg: 'Computes window functions such as running totals or ranks.',
  Unique: 'Removes duplicate rows from sorted input.',
  ModifyTable: 'Writes the changes - insert, update or delete.',
  'Values Scan': 'Reads rows written directly in the query.',
};

function nodeTitle(node) {
  const type = node['Node Type'];
  if (type === 'Aggregate' && node.Strategy === 'Hashed') return 'HashAggregate';
  if (type === 'Aggregate' && node.Strategy === 'Sorted') return 'GroupAggregate';
  if (type === 'ModifyTable') return `${node.Operation || 'Modify'} ${node['Relation Name'] || ''}`.trim();
  return type;
}

/** Flattens the plan and works out each step's own time (its total minus its children's). */
function analyse(plan) {
  const nodes = [];
  const walk = (node, depth, parent) => {
    const loops = node['Actual Loops'] || 1;
    const total = node['Actual Total Time'] !== undefined ? node['Actual Total Time'] * loops : null;
    const entry = { node, depth, parent, children: [], total, id: nodes.length };
    nodes.push(entry);
    parent?.children.push(entry);
    for (const child of node.Plans || []) walk(child, depth + 1, entry);
    return entry;
  };
  const root = walk(plan, 0, null);
  for (const e of nodes) {
    const childTime = e.children.reduce((s, c) => s + (c.total || 0), 0);
    e.self = e.total === null ? null : Math.max(e.total - childTime, 0);
    const est = e.node['Plan Rows'];
    const actual = e.node['Actual Rows'] !== undefined ? e.node['Actual Rows'] * (e.node['Actual Loops'] || 1) : null;
    e.misestimate = actual !== null && est > 0 && actual > 0 ? Math.max(actual / est, est / actual) : null;
  }
  const maxSelf = Math.max(...nodes.map((n) => n.self || 0), 0.0001);
  const maxCost = Math.max(...nodes.map((n) => n.node['Total Cost'] || 0), 0.0001);
  return { root, nodes, maxSelf, maxCost };
}

/**
 * An EXPLAIN plan as a tree of steps. Each shows how long it took on its own,
 * rows expected against rows found, and the notes that matter: which index,
 * which filter, and whether it read a whole table.
 */
export default function PlanTree({ result }) {
  const plan = result?.plan?.Plan;
  const data = useMemo(() => (plan ? analyse(plan) : null), [plan]);
  const [collapsed, setCollapsed] = useState(() => new Set());

  if (!data) return null;
  const analyzed = plan['Actual Total Time'] !== undefined;
  const hottest = data.nodes.reduce((a, b) => ((b.self || 0) > (a.self || 0) ? b : a));
  const seqScans = data.nodes.filter((n) => n.node['Node Type'] === 'Seq Scan' && (n.node['Actual Rows'] ?? n.node['Plan Rows']) > 1000);

  const visible = [];
  const hide = new Set();
  for (const e of data.nodes) {
    if (e.parent && (hide.has(e.parent.id) || collapsed.has(e.parent.id))) {
      hide.add(e.id);
      continue;
    }
    visible.push(e);
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure icon={Clock} label="Execution" value={analyzed ? `${result.plan['Execution Time'].toFixed(2)} ms` : 'not run'} />
        <Figure icon={Zap} label="Planning" value={`${(result.plan['Planning Time'] ?? 0).toFixed(2)} ms`} />
        <Figure icon={Layers} label="Steps" value={data.nodes.length} />
        <Figure icon={Rows3} label="Estimated cost" value={plan['Total Cost'].toLocaleString()} />
      </div>

      {seqScans.length > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-[14px] px-3.5 py-2.5 text-[13px]" style={{ background: 'var(--warning-soft)' }}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
          <span>
            Reads every row of <b>{[...new Set(seqScans.map((s) => s.node['Relation Name']))].join(', ')}</b>. Fine for small tables; on large ones an index on the filtered column would help.
          </span>
        </div>
      )}

      <ol className="space-y-1.5">
        {visible.map((e, i) => {
          const n = e.node;
          const title = nodeTitle(n);
          const isHot = analyzed && e === hottest && data.nodes.length > 1;
          const hasChildren = e.children.length > 0;
          const selfPct = e.self !== null ? (e.self / data.maxSelf) * 100 : ((n['Total Cost'] || 0) / data.maxCost) * 100;
          const details = [
            n['Relation Name'] && ['on', `${n['Relation Name']}${n.Alias && n.Alias !== n['Relation Name'] ? ` ${n.Alias}` : ''}`],
            n['Index Name'] && ['index', n['Index Name']],
            n['Index Cond'] && ['index cond', n['Index Cond']],
            n['Hash Cond'] && ['hash cond', n['Hash Cond']],
            n['Merge Cond'] && ['merge cond', n['Merge Cond']],
            n['Join Filter'] && ['join filter', n['Join Filter']],
            n.Filter && ['filter', n.Filter],
            n['Rows Removed by Filter'] ? ['removed', `${n['Rows Removed by Filter'].toLocaleString()} rows by filter`] : null,
            n['Sort Key'] && ['sort key', n['Sort Key'].join(', ')],
            n['Sort Method'] && ['sort', `${n['Sort Method']}${n['Sort Space Used'] ? ` · ${n['Sort Space Used']} kB ${String(n['Sort Space Type'] || '').toLowerCase()}` : ''}`],
            n['Group Key'] && ['group key', n['Group Key'].join(', ')],
            n['Function Name'] && ['function', n['Function Name']],
          ].filter(Boolean);

          return (
            <motion.li
              key={e.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.035, type: 'spring', stiffness: 400, damping: 32 }}
              style={{ marginLeft: `${Math.min(e.depth, 8) * 22}px` }}
              className="relative"
            >
              {e.depth > 0 && <span aria-hidden="true" className="absolute -left-3 top-0 h-5 w-3 rounded-bl-[8px]" style={{ borderLeft: '1.5px solid var(--line-strong)', borderBottom: '1.5px solid var(--line-strong)' }} />}
              <div className={cn('rounded-[14px] px-3.5 py-2.5', isHot && 'ring-1 ring-[rgb(var(--c-warning))]')} style={{ background: isHot ? 'var(--warning-soft)' : 'rgb(var(--c-surface))', boxShadow: '0 0 0 1px var(--line)' }}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button type="button" disabled={!hasChildren} onClick={() => setCollapsed((s) => { const next = new Set(s); next.has(e.id) ? next.delete(e.id) : next.add(e.id); return next; })} className={cn('grid h-5 w-5 place-items-center rounded-md text-ink-3', !hasChildren && 'invisible')} aria-label={collapsed.has(e.id) ? 'Expand' : 'Collapse'}>
                    <ChevronRight size={14} className={cn('transition-transform', !collapsed.has(e.id) && 'rotate-90')} />
                  </button>
                  <span className="text-[13.5px] font-semibold" title={NODE_HELP[title] || NODE_HELP[n['Node Type']]}>{title}</span>
                  {n['Join Type'] && n['Node Type'].includes('Join') && <span className="text-[12px] text-ink-3">{n['Join Type'].toLowerCase()}</span>}
                  {n['Node Type'] === 'Seq Scan' && <span className="rounded-full px-1.5 text-[10.5px] font-medium text-warning" style={{ background: 'var(--warning-soft)' }}>full scan</span>}
                  {n['Node Type'].startsWith('Index') && <span className="rounded-full px-1.5 text-[10.5px] font-medium text-success" style={{ background: 'var(--success-soft)' }}>uses index</span>}
                  {isHot && <span className="rounded-full bg-[rgb(var(--c-warning))] px-1.5 text-[10.5px] font-semibold text-white">slowest step</span>}
                  <span className="ml-auto flex items-center gap-3 text-[12px] text-ink-2 tabular">
                    <span title="Rows expected → rows found">
                      {n['Plan Rows'].toLocaleString()}
                      {n['Actual Rows'] !== undefined && <> → <b className={cn('font-semibold', e.misestimate > 10 ? 'text-warning' : 'text-ink')}>{(n['Actual Rows'] * (n['Actual Loops'] || 1)).toLocaleString()}</b></>} rows
                    </span>
                    {e.self !== null ? <span className="w-20 text-right">{e.self < 0.01 ? '<0.01' : e.self.toFixed(2)} ms</span> : <span className="w-20 text-right">cost {n['Total Cost']}</span>}
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: 'var(--chart-track)' }}>
                  <motion.div className="h-full rounded-full" style={{ background: isHot ? 'rgb(var(--c-warning))' : 'var(--series-1)' }} initial={{ width: 0 }} animate={{ width: `${Math.max(selfPct, 1.5)}%` }} transition={{ delay: 0.15 + i * 0.035, type: 'spring', stiffness: 120, damping: 20 }} />
                </div>
                {(details.length > 0 || NODE_HELP[title] || NODE_HELP[n['Node Type']]) && (
                  <div className="mt-2 space-y-0.5 pl-7">
                    <p className="text-[12px] text-ink-3">{NODE_HELP[title] || NODE_HELP[n['Node Type']]}</p>
                    {details.map(([k, v]) => (
                      <p key={k} className="flex gap-2 text-[12px]">
                        <span className="w-20 shrink-0 text-ink-3">{k === 'filter' ? <span className="inline-flex items-center gap-1"><Filter size={10} /> filter</span> : k}</span>
                        <code className="min-w-0 break-all text-ink-2">{v}</code>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </motion.li>
          );
        })}
      </ol>
      {result.plan.Triggers?.length > 0 && (
        <p className="mt-3 text-[12px] text-ink-3">Triggers fired: {result.plan.Triggers.map((t) => `${t['Trigger Name']} (${t.Time?.toFixed(2)} ms)`).join(', ')}</p>
      )}
    </div>
  );
}

function Figure({ icon: Icon, label, value }) {
  return (
    <div className="rounded-[14px] px-3.5 py-2.5" style={{ background: 'var(--wash)' }}>
      <p className="flex items-center gap-1.5 text-[11.5px] text-ink-3"><Icon size={12} /> {label}</p>
      <p className="mt-0.5 text-[16px] font-semibold tabular">{value}</p>
    </div>
  );
}
