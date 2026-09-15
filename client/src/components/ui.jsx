import { useEffect } from 'react';
import { exportUrl } from '../api/client';

export function PageHeader({ title, subtitle, children }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

export function ErrorNote({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div className="mb-4 flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
      <div>
        <p className="font-semibold">Something went wrong</p>
        <p className="mt-1 text-sm">{error}</p>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-sm underline" type="button">
          Dismiss
        </button>
      )}
    </div>
  );
}

export function Empty({ message, action }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center">
      <p className="text-slate-500">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Money({ value }) {
  return <span>{Number(value || 0).toFixed(2)}</span>;
}

export function Badge({ tone = 'slate', children }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    blue: 'bg-blue-100 text-blue-800',
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children, wide = false }) {
  // Escape closes the dialog - expected behaviour for anyone who has used a
  // computer before, and a way out if a form looks stuck.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`w-full rounded-xl bg-white shadow-xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-700" type="button">
            &times;
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmButton({ onConfirm, children, message, className = 'btn-danger' }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (window.confirm(message)) onConfirm();
      }}
    >
      {children}
    </button>
  );
}

const FORMATS = [
  ['csv', 'CSV'],
  ['xlsx', 'Excel'],
  ['json', 'JSON'],
  ['pdf', 'PDF'],
];

export function ExportButtons({ table, params }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
      <span className="px-2 text-xs font-medium text-slate-500">Export</span>
      {FORMATS.map(([format, label]) => (
        <a
          key={format}
          href={exportUrl(table, format, params)}
          className="rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-100"
        >
          {label}
        </a>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  return (
    <input
      type="search"
      className="input-field max-w-xs"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Table({ columns, rows, empty, onSort, sort, dir }) {
  if (!rows.length) return <Empty message={empty} />;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`table-header ${col.align === 'right' ? 'text-right' : ''} ${
                  onSort && col.sortable !== false ? 'cursor-pointer select-none hover:text-slate-700' : ''
                }`}
                onClick={() => onSort && col.sortable !== false && onSort(col.key)}
              >
                {col.label}
                {sort === col.key && <span className="ml-1">{dir === 'desc' ? '↓' : '↑'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i} className="hover:bg-slate-50">
              {columns.map((col) => (
                <td key={col.key} className={`table-cell ${col.align === 'right' ? 'text-right' : ''}`}>
                  {col.render ? col.render(row) : (row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ meta, page, onPage, loading }) {
  if (meta.pageCount <= 1) {
    return meta.total > 0 ? (
      <p className="mt-3 text-sm text-slate-500">
        {meta.total} {meta.total === 1 ? 'record' : 'records'}
      </p>
    ) : null;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-500">
        Page {meta.page} of {meta.pageCount} · {meta.total} records
      </p>
      <div className="flex gap-2">
        <button
          className="btn-secondary"
          onClick={() => onPage(page - 1)}
          disabled={loading || meta.page <= 1}
        >
          Previous
        </button>
        <button
          className="btn-secondary"
          onClick={() => onPage(page + 1)}
          disabled={loading || meta.page >= meta.pageCount}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function Select({ value, onChange, options, placeholder }) {
  return (
    <select className="input-field max-w-[190px]" value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => {
        const [val, label] = Array.isArray(opt) ? opt : [opt, opt];
        return (
          <option key={val} value={val}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

export function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
