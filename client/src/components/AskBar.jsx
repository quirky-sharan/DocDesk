import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { ErrorNote, Badge, Modal } from './ui';

const EXAMPLES = {
  products: [
    'sort by price, cheapest first',
    'add a column for expiry date',
    'show only Hygiene items',
    'average price per category',
  ],
  sales: ['sort by total, highest first', 'show only unpaid sales', 'total revenue per payment method'],
  customers: ['sort by name', 'add a column for date of birth', 'show customers with no email'],
  suppliers: ['sort by name', 'add a column for lead time'],
};

/**
 * Plain-English commands over the table on screen.
 *
 * Nothing runs straight off the model's answer: the request is turned into a
 * described operation with a preview, and the user confirms. Read-only
 * operations (sort, filter) change the view rather than the data.
 */
export default function AskBar({ table, onView }) {
  const [request, setRequest] = useState('');
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    api.ai.status().then(setStatus).catch(() => {});
  }, []);

  async function ask(e) {
    e?.preventDefault();
    if (!request.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setNotice(null);
    try {
      setResult(await api.ai.interpret(table, request));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const applied = await api.ai.apply(table, result.operation);
      setResult(null);
      setRequest('');

      if (applied.applied) {
        setNotice(applied.message);
        onView?.({ kind: 'changed' });
      } else {
        // sort/filter describe a view, so hand it back to the page.
        onView?.({ kind: 'view', operation: applied.operation });
        setNotice(applied.message);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const examples = EXAMPLES[table] || EXAMPLES.products;

  return (
    <div className="mb-5">
      <form onSubmit={ask} className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
            <circle cx="12" cy="12" r="3.2" />
          </svg>
          <input
            ref={inputRef}
            className="input-field pl-9"
            placeholder={`Ask in plain English — e.g. "${examples[0]}"`}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={busy || !request.trim()}>
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="subtle">Try:</span>
        {examples.slice(0, 3).map((example) => (
          <button
            key={example}
            type="button"
            className="link hover:underline"
            onClick={() => {
              setRequest(example);
              inputRef.current?.focus();
            }}
          >
            {example}
          </button>
        ))}
        {status && !status.configured && (
          <span className="subtle ml-auto">
            Simple requests only until an AI key is added — see REQUIREMENTS.md
          </span>
        )}
      </div>

      {notice && (
        <div
          className="mt-3 rounded-xl p-3 text-sm"
          style={{ background: 'var(--success-soft)', color: 'var(--success)' }}
        >
          {notice}
        </div>
      )}

      {error && <div className="mt-3"><ErrorNote error={error} onDismiss={() => setError(null)} /></div>}

      {result && (
        <ConfirmOperation
          result={result}
          busy={busy}
          onCancel={() => setResult(null)}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}

function ConfirmOperation({ result, busy, onCancel, onConfirm }) {
  const { operation, explanation, preview, destructive, changesSchema, source, model, latencyMs } = result;
  const readOnly = ['sort', 'filter', 'summarize'].includes(operation.type);

  return (
    <Modal title="Is this what you meant?" onClose={onCancel} wide>
      <div className="space-y-5">
        <div
          className="rounded-xl p-4"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}
        >
          <p className="text-sm font-semibold">{explanation}</p>
          {destructive && (
            <p className="mt-2 text-sm" style={{ color: 'var(--danger)' }}>
              This changes your data and can't be undone.
            </p>
          )}
        </div>

        {preview.kind === 'rows' && (
          <div>
            <p className="mb-2 text-sm font-medium">
              {destructive
                ? `${preview.affected} row${preview.affected === 1 ? '' : 's'} would change. First few:`
                : `${preview.total} row${preview.total === 1 ? '' : 's'} match. First few:`}
            </p>
            <PreviewTable rows={preview.rows} />
          </div>
        )}

        {preview.kind === 'summary' && (
          <div>
            <p className="mb-2 text-sm font-medium">Result:</p>
            <PreviewTable rows={preview.rows} />
          </div>
        )}

        {preview.kind === 'schema' && (
          <p className="text-sm muted">
            This changes the shape of the table. It affects all {preview.total} rows.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs subtle">
          <Badge tone={source === 'model' ? 'blue' : 'slate'}>
            {source === 'model' ? `Understood by ${model}` : 'Matched a simple rule'}
          </Badge>
          {latencyMs > 0 && <span>{latencyMs} ms</span>}
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>
            No, cancel
          </button>
          <button
            className="btn-primary"
            onClick={onConfirm}
            disabled={busy}
            style={destructive ? { background: 'var(--danger)' } : undefined}
          >
            {busy ? 'Working…' : readOnly ? 'Yes, show me' : destructive ? 'Yes, change it' : 'Yes, do it'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PreviewTable({ rows }) {
  if (!rows?.length) return <p className="text-sm muted">Nothing to show.</p>;
  // A wide table would dominate the dialog, so show the columns most likely to
  // identify a row plus anything the operation touched.
  const columns = Object.keys(rows[0]).filter((c) => c !== 'description').slice(0, 6);

  return (
    <div className="panel max-h-56 overflow-auto">
      <table className="w-full">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} className="table-header">{c.replace(/_/g, ' ')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c} className="table-cell">
                  {row[c] === null || row[c] === undefined || row[c] === ''
                    ? <span className="subtle">—</span>
                    : String(row[c]).slice(0, 40)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
