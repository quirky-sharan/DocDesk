import { useEffect } from 'react';
import { exportUrl } from '../api/client';

export function PageHeader({ title, subtitle, children }) {
  return (
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[1.6rem] font-semibold tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm muted">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

export function ErrorNote({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div
      className="mb-4 flex items-start justify-between gap-4 rounded-xl p-4"
      style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
      role="alert"
    >
      <div>
        <p className="text-sm font-semibold">Something went wrong</p>
        <p className="mt-0.5 text-sm opacity-90">{error}</p>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 text-sm underline opacity-80 hover:opacity-100" type="button">
          Dismiss
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', title, children }) {
  const tones = {
    info: { bg: 'var(--accent-soft)', fg: 'var(--accent-text)', bd: 'var(--accent)' },
    success: { bg: 'var(--success-soft)', fg: 'var(--success)', bd: 'var(--success)' },
    warning: { bg: 'var(--warning-soft)', fg: 'var(--warning)', bd: 'var(--warning)' },
  }[tone];
  return (
    <div
      className="mb-4 rounded-xl p-4 text-sm"
      style={{ background: tones.bg, color: tones.fg, border: `1px solid ${tones.bd}33` }}
    >
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1 opacity-90' : 'opacity-90'}>{children}</div>
    </div>
  );
}

export function Empty({ message, action }) {
  return (
    <div
      className="rounded-xl px-6 py-14 text-center"
      style={{ border: '1px dashed var(--border-strong)' }}
    >
      <p className="text-sm muted">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Money({ value }) {
  return <span className="tabular-nums">{Number(value || 0).toFixed(2)}</span>;
}

export function Badge({ tone = 'slate', children }) {
  const tones = {
    slate: { bg: 'var(--surface-sunken)', fg: 'var(--text-muted)' },
    green: { bg: 'var(--success-soft)', fg: 'var(--success)' },
    amber: { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
    red: { bg: 'var(--danger-soft)', fg: 'var(--danger)' },
    blue: { bg: 'var(--accent-soft)', fg: 'var(--accent-text)' },
  }[tone];
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: tones.bg, color: tones.fg }}
    >
      {children}
    </span>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs subtle">{hint}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children, wide = false }) {
  // Escape closes the dialog - expected behaviour for anyone who has used a
  // computer before, and a way out if a form looks stuck.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // The page behind must not scroll while a dialog is open.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={{ background: 'rgb(12 12 11 / 0.45)', backdropFilter: 'blur(3px)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`w-full animate-[modalIn_180ms_ease-out] rounded-2xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)' }}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="btn-ghost -mr-1.5 px-2 py-1 text-xl leading-none"
            type="button"
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
      <style>{`@keyframes modalIn{from{opacity:0;transform:translateY(-6px) scale(.99)}to{opacity:1;transform:none}}`}</style>
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
    <div
      className="flex items-center gap-0.5 rounded-lg p-1"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
    >
      <span className="px-2 text-xs font-medium subtle">Export</span>
      {FORMATS.map(([format, label]) => (
        <a key={format} href={exportUrl(table, format, params)} className="btn-edit px-2 py-0.5 text-xs">
          {label}
        </a>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="relative max-w-xs flex-1">
      <svg
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
        width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke="var(--text-subtle)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        className="input-field pl-9"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function Table({ columns, rows, empty, onSort, sort, dir }) {
  if (!rows.length) return <Empty message={empty} />;
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr>
            {columns.map((col) => {
              const sortable = onSort && col.sortable !== false;
              return (
                <th
                  key={col.key}
                  className={`table-header ${col.align === 'right' ? 'text-right' : ''} ${
                    sortable ? 'cursor-pointer select-none' : ''
                  }`}
                  onClick={() => sortable && onSort(col.key)}
                  aria-sort={sort === col.key ? (dir === 'desc' ? 'descending' : 'ascending') : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sort === col.key && (
                      <span style={{ color: 'var(--accent)' }}>{dir === 'desc' ? '↓' : '↑'}</span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id ?? i}
              className="transition-colors last:[&>td]:border-b-0"
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            >
              {columns.map((col) => (
                <td key={col.key} className={`table-cell ${col.align === 'right' ? 'text-right' : ''}`}>
                  {col.render ? col.render(row) : (row[col.key] ?? <span className="subtle">—</span>)}
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
      <p className="mt-3 text-xs subtle">
        {meta.total} {meta.total === 1 ? 'record' : 'records'}
      </p>
    ) : null;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs subtle">
        Page {meta.page} of {meta.pageCount} · {meta.total} records
      </p>
      <div className="flex gap-2">
        <button className="btn-secondary" onClick={() => onPage(page - 1)} disabled={loading || meta.page <= 1}>
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
