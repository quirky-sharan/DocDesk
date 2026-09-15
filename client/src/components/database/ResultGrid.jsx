import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import { MONO_FONT } from './SqlEditor';
import { cn } from '../../lib/cn';

const NUMERIC = /^(smallint|integer|bigint|numeric|real|double|decimal|int|float|money)/;

export function isNumericType(type = '') {
  return NUMERIC.test(type);
}

function display(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/**
 * Query results as a spreadsheet-like grid: sticky header with each column's
 * type, row numbers, NULL shown as NULL (not blank), numbers right-aligned,
 * click a header to sort the fetched rows, click a cell to copy it.
 */
export default function ResultGrid({ columns = [], rows = [], maxHeight = 460, rowObjects = false }) {
  const [sort, setSort] = useState(null);
  const [copied, setCopied] = useState(null);

  const matrix = useMemo(() => (rowObjects ? rows.map((r) => columns.map((c) => r[c.name])) : rows), [rows, columns, rowObjects]);

  const sorted = useMemo(() => {
    if (!sort) return matrix.map((r, i) => ({ r, i }));
    const { index, dir } = sort;
    const numeric = isNumericType(columns[index]?.type);
    return matrix
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const x = a.r[index];
        const y = b.r[index];
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        const cmp = numeric ? Number(x) - Number(y) : String(display(x)).localeCompare(String(display(y)), undefined, { numeric: true });
        return dir === 'asc' ? cmp : -cmp;
      });
  }, [matrix, sort, columns]);

  function toggle(index) {
    setSort((s) => (s?.index !== index ? { index, dir: 'asc' } : s.dir === 'asc' ? { index, dir: 'desc' } : null));
  }

  function copy(value, key) {
    const text = display(value) ?? 'NULL';
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 900);
    }).catch(() => {});
  }

  if (!columns.length) return null;

  return (
    <div className="overflow-auto rounded-[16px]" style={{ maxHeight, boxShadow: 'inset 0 0 0 1px var(--line)' }} data-lenis-prevent>
      <table className="w-max min-w-full border-separate border-spacing-0 text-[12.5px]" style={{ fontFamily: MONO_FONT }}>
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 w-10 px-3 py-2 text-right text-[11px] font-normal text-ink-3" style={{ background: 'rgb(var(--c-sunken))', borderBottom: '1px solid var(--line)', borderRight: '1px solid var(--line)' }}>#</th>
            {columns.map((c, i) => {
              const numeric = isNumericType(c.type);
              const active = sort?.index === i;
              return (
                <th key={`${c.name}-${i}`} className="sticky top-0 z-10 whitespace-nowrap px-3 py-1.5 font-normal" style={{ background: 'rgb(var(--c-sunken))', borderBottom: '1px solid var(--line)', textAlign: numeric ? 'right' : 'left' }}>
                  <button type="button" onClick={() => toggle(i)} className={cn('inline-flex flex-col rounded-md text-left', numeric && 'items-end')}>
                    <span className={cn('flex items-center gap-1 text-[12.5px] font-semibold', active ? 'text-accent-ink' : 'text-ink')}>
                      {c.name}
                      {active && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </span>
                    <span className="text-[10.5px] text-ink-3">{c.type}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ r, i }, rowIndex) => (
            <tr key={i} className="group">
              <td className="sticky left-0 z-[5] px-3 py-1.5 text-right text-[11px] text-ink-3 tabular" style={{ background: 'rgb(var(--c-surface))', borderRight: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>{rowIndex + 1}</td>
              {columns.map((c, j) => {
                const value = r[j];
                const text = display(value);
                const key = `${i}-${j}`;
                const numeric = isNumericType(c.type);
                return (
                  <td
                    key={j}
                    onClick={() => copy(value, key)}
                    title={text && text.length > 60 ? text : 'Click to copy'}
                    className="relative max-w-[340px] cursor-copy truncate px-3 py-1.5 transition-colors group-hover:bg-[var(--wash)]"
                    style={{ borderBottom: '1px solid var(--line)', textAlign: numeric ? 'right' : 'left', background: copied === key ? 'var(--accent-soft)' : undefined }}
                  >
                    {text === null ? (
                      <span className="rounded px-1 text-[10.5px] font-semibold text-ink-3" style={{ background: 'var(--wash-strong)' }}>NULL</span>
                    ) : typeof value === 'boolean' ? (
                      <span className={value ? 'text-success' : 'text-ink-3'}>{text}</span>
                    ) : (
                      <span className={cn(numeric && 'tabular', typeof value === 'object' && 'text-violet')}>{text}</span>
                    )}
                    {copied === key && (
                      <span className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] text-white">
                        <Check size={10} /> Copied
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Rows as CSV text, for "Download results". */
export function toCsv(columns, rows) {
  const esc = (v) => {
    const s = display(v);
    if (s === null) return '';
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.name)).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

