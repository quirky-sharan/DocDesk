import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, FunctionSquare, Link2, Network, ScanEye, TerminalSquare } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Card, CardHeader, ErrorNote, SegmentedControl } from '../ui';
import { Reveal } from '../motion/Reveal';
import ErDiagram from './ErDiagram';
import { CodeBlock } from './TablesTab';
import { MONO_FONT } from './SqlEditor';
import { cn } from '../../lib/cn';

const CARDINALITY = {
  'many-to-one': 'many → exactly one',
  'many-to-zero-or-one': 'many → zero or one',
  'one-to-one': 'one → one',
};

export default function DiagramTab({ onNavigate }) {
  const [data, setData] = useState(null);
  const [routines, setRoutines] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.db.relationships().then(setData).catch((err) => setError(err.message));
    api.db.routines().then(setRoutines).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      {data ? <ErDiagram data={data} onOpenTable={(name) => onNavigate('tables', { table: name })} /> : <div className="skeleton h-[720px] rounded-[22px]" />}

      {data && (
        <Reveal>
          <Card>
            <CardHeader title="Relationships" subtitle="Every foreign key, what it links and what happens when the parent row is deleted." icon={Link2} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="text-left text-[12px] text-ink-3">
                    <th className="pb-2 font-medium">From</th>
                    <th className="pb-2 font-medium" />
                    <th className="pb-2 font-medium">To</th>
                    <th className="pb-2 font-medium">Cardinality</th>
                    <th className="pb-2 font-medium">On delete</th>
                  </tr>
                </thead>
                <tbody>
                  {data.relationships.map((r) => (
                    <tr key={r.name} style={{ borderTop: '1px solid var(--line)' }}>
                      <td className="py-2.5" style={{ fontFamily: MONO_FONT }}>{r.from.table}.<b className="font-semibold">{r.from.columns.join(', ')}</b></td>
                      <td className="px-3 py-2.5 text-ink-3">→</td>
                      <td className="py-2.5" style={{ fontFamily: MONO_FONT }}>{r.to.table}.<b className="font-semibold">{r.to.columns.join(', ')}</b></td>
                      <td className="py-2.5 text-ink-2">{CARDINALITY[r.cardinality] || r.cardinality}</td>
                      <td className="py-2.5">
                        <Badge tone={r.onDelete === 'cascade' ? 'red' : r.onDelete === 'set null' ? 'amber' : 'slate'}>{r.onDelete}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">
              <b className="font-medium text-ink-2">cascade</b> removes the child rows with the parent (a sale's lines and payments go with it). <b className="font-medium text-ink-2">set null</b> keeps the child and clears the link (deleting a product keeps its past sale lines, which also store their own description and price).
            </p>
          </Card>
        </Reveal>
      )}

      {routines && <RoutinesCard routines={routines} onNavigate={onNavigate} />}
    </div>
  );
}

function RoutinesCard({ routines, onNavigate }) {
  const [kind, setKind] = useState('views');
  const [open, setOpen] = useState(null);
  const items = kind === 'views' ? routines.views : routines.functions;

  return (
    <Reveal>
      <Card>
        <CardHeader
          title="Views and functions"
          subtitle="Logic that lives inside the database: reporting views, business-rule triggers and helpers."
          icon={Network}
          action={<SegmentedControl size="sm" value={kind} onChange={(k) => { setKind(k); setOpen(null); }} options={[['views', 'Views', ScanEye, routines.views.length], ['functions', 'Functions', FunctionSquare, routines.functions.length]]} ariaLabel="Kind" />}
        />
        <ul className="divide-y divide-[var(--line)]">
          {items.map((item) => {
            const expanded = open === item.name;
            return (
              <li key={item.name}>
                <button type="button" onClick={() => setOpen(expanded ? null : item.name)} className="flex w-full items-start gap-3 py-3 text-left">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[9px]" style={{ background: 'var(--wash-strong)' }}>
                    {kind === 'views' ? <ScanEye size={14} className="text-ink-2" /> : <FunctionSquare size={14} className="text-ink-2" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-semibold" style={{ fontFamily: MONO_FONT }}>{item.name}{kind === 'functions' ? `(${item.arguments})` : ''}</span>
                      {kind === 'functions' && <Badge tone="slate">{item.language}</Badge>}
                      {item.is_trigger && <Badge tone="amber">trigger</Badge>}
                      {kind === 'functions' && item.returns && !item.is_trigger && <span className="text-[12px] text-ink-3">returns {item.returns}</span>}
                      {kind === 'functions' && item.usedBy > 0 && <span className="text-[12px] text-ink-3">· used by {item.usedBy} trigger{item.usedBy === 1 ? '' : 's'}</span>}
                    </div>
                    {item.comment && <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{item.comment}</p>}
                  </div>
                  <ChevronDown size={16} className={cn('mt-1 shrink-0 text-ink-3 transition-transform', expanded && 'rotate-180')} />
                </button>
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="pb-4">
                        <CodeBlock code={kind === 'views' ? `CREATE VIEW ${item.name} AS\n${item.definition.trim()}` : item.definition} />
                        {kind === 'views' && (
                          <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => onNavigate('sql', { sql: `SELECT *\nFROM ${item.name}\nLIMIT 50` })}>
                            <TerminalSquare size={14} /> Query this view
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </Card>
    </Reveal>
  );
}
