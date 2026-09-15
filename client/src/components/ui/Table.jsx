import { motion } from 'motion/react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import Empty from './Empty';

/**
 * The list view every page uses. Sorting from the headers, a soft hover wash,
 * rows that settle in when the page or sort changes, a skeleton on first load
 * and - while refreshing - the previous rows held at reduced opacity rather than
 * a flash of emptiness.
 */
export default function Table({
  columns,
  rows,
  empty,
  emptyTitle,
  emptyIcon,
  emptyAction,
  onSort,
  sort,
  dir,
  loading = false,
  onRowClick,
  rowKey = (row, index) => row.id ?? index,
  minWidth = 640,
  className,
}) {
  if (loading && rows.length === 0) return <TableSkeleton columns={columns} />;
  if (!rows.length) return <Empty title={emptyTitle} message={empty} icon={emptyIcon} action={emptyAction} />;

  return (
    <div className={cn('panel overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth }}>
          <thead>
            <tr style={{ background: 'var(--wash)' }}>
              {columns.map((col) => {
                const sortable = onSort && col.sortable !== false;
                const active = sort === col.key;
                const alignRight = col.align === 'right';
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={cn('h-10 whitespace-nowrap px-5 text-[12px] font-medium text-ink-3', alignRight ? 'text-right' : 'text-left', col.headerClassName)}
                    style={{ borderBottom: '1px solid var(--line)', width: col.width }}
                    aria-sort={active ? (dir === 'desc' ? 'descending' : 'ascending') : undefined}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => onSort(col.key)}
                        className={cn('group inline-flex items-center gap-1 rounded-md transition-colors hover:text-ink', active && 'text-ink', alignRight && 'flex-row-reverse')}
                      >
                        {col.label}
                        <motion.span
                          animate={{ rotate: active && dir === 'asc' ? 180 : 0, opacity: active ? 1 : 0 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          className="inline-flex group-hover:!opacity-60"
                        >
                          <ChevronDown size={13} strokeWidth={2.4} />
                        </motion.span>
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 250ms ease' }}>
            {rows.map((row, index) => (
              <motion.tr
                key={rowKey(row, index)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: Math.min(index, 14) * 0.018 }}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn('group transition-colors duration-150 hover:bg-[var(--wash)]', onRowClick && 'cursor-pointer')}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn('px-5 py-3 text-[14px] text-ink', col.align === 'right' && 'text-right', col.className)}
                    style={{ borderTop: index ? '1px solid var(--line)' : undefined }}
                  >
                    {col.render ? col.render(row) : (row[col.key] ?? <span className="text-ink-3">—</span>)}
                  </td>
                ))}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableSkeleton({ columns }) {
  return (
    <div className="panel overflow-hidden" aria-busy="true" aria-label="Loading">
      <div className="h-10" style={{ background: 'var(--wash)', borderBottom: '1px solid var(--line)' }} />
      {Array.from({ length: 6 }, (_, row) => (
        <div key={row} className="flex items-center gap-6 px-5 py-4" style={{ borderTop: row ? '1px solid var(--line)' : undefined }}>
          {columns.slice(0, 5).map((col, i) => (
            <div key={col.key} className="skeleton h-3.5" style={{ width: i === 0 ? '28%' : `${12 + ((row + i) % 3) * 4}%`, opacity: 1 - row * 0.12 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Pagination({ meta, page, onPage, loading }) {
  if (!meta || meta.total === 0) return null;
  const pageSize = meta.pageSize || 25;
  const from = (meta.page - 1) * pageSize + 1;
  const to = Math.min(meta.page * pageSize, meta.total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1">
      <p className="text-[13px] text-ink-3 tabular">
        {meta.pageCount > 1 ? (
          <>
            <span className="text-ink-2">{from}–{to}</span> of {meta.total.toLocaleString()}
          </>
        ) : (
          <>
            {meta.total.toLocaleString()} {meta.total === 1 ? 'record' : 'records'}
          </>
        )}
      </p>
      {meta.pageCount > 1 && (
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn-secondary btn-sm btn-icon" onClick={() => onPage(page - 1)} disabled={loading || meta.page <= 1} aria-label="Previous page">
            <ChevronLeft size={16} strokeWidth={2.2} />
          </button>
          <span className="min-w-[4.5rem] text-center text-[13px] text-ink-2 tabular">
            {meta.page} / {meta.pageCount}
          </span>
          <button type="button" className="btn-secondary btn-sm btn-icon" onClick={() => onPage(page + 1)} disabled={loading || meta.page >= meta.pageCount} aria-label="Next page">
            <ChevronRight size={16} strokeWidth={2.2} />
          </button>
        </div>
      )}
    </div>
  );
}
