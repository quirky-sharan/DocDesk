import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiUrl } from '../api/client';
import { useAssistant } from './AssistantProvider';
import Markdown from './Markdown';

const SUGGESTIONS = {
  '/': ['How are we doing today?', 'What needs reordering?', 'Show unpaid sales'],
  '/inventory': ['Show items running low', 'Sort by price, highest first', 'Add a product called…'],
  '/sales': ['Show unpaid sales', 'Sales report for the last 7 days', 'Record a sale for…'],
  '/orders': ['Order everything that needs restocking', 'Show orders still outstanding'],
  '/customers': ['Who are my top customers?', 'Add a customer called…'],
  '/suppliers': ['Show all suppliers', 'Add a supplier called…'],
  '/files': ['Show only PDFs', 'Largest files first'],
  '/messages': ['Send the waiting messages', 'Show failed messages'],
  '/reports': ['Summarise the last 30 days', 'What sold best this month?'],
  '/settings': ['Set the default tax rate to 5%', 'What do my receipts show?'],
};

const TOOL_LABELS = {
  search_records: 'Looked up records',
  get_details: 'Checked the details',
  business_overview: 'Checked the business',
  sales_report: 'Pulled a sales report',
  restock_suggestions: 'Checked what needs reordering',
  get_settings: 'Checked settings',
  navigate: 'Opened a page',
  show_on_page: 'Updated the list on screen',
  export_table: 'Prepared a download',
  download_receipt: 'Prepared the receipt',
};

const PAGE_NAMES = {
  '/inventory': 'Inventory', '/sales': 'Sales', '/orders': 'Incoming stock', '/customers': 'Customers',
  '/suppliers': 'Suppliers', '/files': 'Files', '/messages': 'Messages',
};

function Icon({ d, size = 16, stroke = 'currentColor', width = 1.8, fill = 'none' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={width}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {[].concat(d).map((path, i) => <path key={i} d={path} />)}
    </svg>
  );
}

const SPARKLE = [
  'M12 3.5l1.6 4.3a3 3 0 0 0 1.8 1.8L19.7 11l-4.3 1.6a3 3 0 0 0-1.8 1.8L12 18.7l-1.6-4.3a3 3 0 0 0-1.8-1.8L4.3 11l4.3-1.6a3 3 0 0 0 1.8-1.8z',
  'M19 3v3M17.5 4.5h3',
];

function formatValue(value, money) {
  if (value === null || value === undefined || value === '') return '—';
  if (money || (typeof value === 'number' && !Number.isInteger(value))) return Number(value).toFixed(2);
  return String(value);
}

// ---------------------------------------------------------------------------

export function AssistantLauncher() {
  const { open, setOpen, openCount, status } = useAssistant();
  if (open) return null;

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="assistant-launcher group fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full py-3 pl-3.5 pr-4 text-sm font-medium text-white"
      style={{ background: 'var(--accent)', boxShadow: 'var(--shadow-lg)' }}
      title="Ask DocDesk (Ctrl+K)"
      aria-label="Open the DocDesk assistant"
    >
      <Icon d={SPARKLE} size={18} stroke="#fff" />
      <span>Ask DocDesk</span>
      <kbd className="hidden rounded px-1.5 py-0.5 text-[10px] font-medium sm:inline" style={{ background: 'rgb(255 255 255 / 0.18)' }}>
        Ctrl K
      </kbd>
      {openCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white"
          style={{ background: 'var(--danger)', boxShadow: '0 0 0 2px var(--bg)' }}>
          {openCount}
        </span>
      )}
      {status && !status.configured && (
        <span className="absolute -left-1 -top-1 h-3 w-3 rounded-full" style={{ background: 'var(--warning)', boxShadow: '0 0 0 2px var(--bg)' }} />
      )}
    </button>
  );
}

export default function AssistantPanel() {
  const { open, setOpen, entries, busy, busySince, status, send, reset } = useAssistant();
  const { pathname } = useLocation();
  const [draft, setDraft] = useState('');
  const scroller = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 60);
  }, [open]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [entries.length, busy, open]);

  if (!open) return null;

  function submit(text = draft) {
    if (!text.trim() || busy) return;
    send(text);
    setDraft('');
  }

  const suggestions = SUGGESTIONS[pathname] || SUGGESTIONS['/'];
  const notConfigured = status && !status.configured;

  return (
    <aside
      className="assistant-panel fixed inset-y-0 right-0 z-40 flex w-full flex-col sm:w-[440px]"
      style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
      aria-label="DocDesk assistant"
    >
      <header className="flex h-14 shrink-0 items-center gap-3 px-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: 'var(--accent-soft)' }}>
          <Icon d={SPARKLE} size={17} stroke="var(--accent)" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">DocDesk assistant</p>
          <p className="flex items-center gap-1.5 text-xs subtle leading-tight">
            <span className="h-1.5 w-1.5 rounded-full" style={{
              background: notConfigured ? 'var(--warning)' : status?.reachable === false ? 'var(--danger)' : 'var(--success)',
            }} />
            {notConfigured ? 'Not connected' : busy ? 'Working…' : 'Ready to help'}
          </p>
        </div>
        {entries.length > 0 && (
          <button type="button" className="btn-ghost px-2" onClick={reset} title="Start a new conversation">
            New chat
          </button>
        )}
        <button type="button" className="btn-ghost px-2" onClick={() => setOpen(false)} aria-label="Close assistant" title="Close (Esc)">
          <Icon d={['M6 6l12 12', 'M18 6L6 18']} />
        </button>
      </header>

      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {notConfigured && (
          <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
            <p className="font-medium">The assistant isn't connected yet</p>
            <p className="mt-1">Add a free Groq key as <code>GROQ_API_KEY</code> in <code>server/.env</code> and restart. REQUIREMENTS.md has the steps.</p>
          </div>
        )}

        {entries.length === 0 && <Welcome suggestions={suggestions} onPick={submit} />}

        {entries.map((entry) => <Entry key={entry.id} entry={entry} onRetry={submit} />)}

        {busy && <Thinking since={busySince} />}
      </div>

      <footer className="shrink-0 px-4 pb-4 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
        {entries.length > 0 && !busy && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => (s.endsWith('…') ? (setDraft(s.replace('…', ' ')), input.current?.focus()) : submit(s))}
                className="shrink-0 rounded-full px-2.5 py-1 text-xs"
                style={{ background: 'var(--surface-sunken)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-end gap-2 rounded-xl p-1.5"
          style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border)' }}
        >
          <textarea
            ref={input}
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask anything, or tell me what to do…"
            className="max-h-[132px] min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
            style={{ color: 'var(--text)' }}
            disabled={notConfigured}
          />
          <button
            type="submit"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
            disabled={busy || !draft.trim() || notConfigured}
            aria-label="Send"
          >
            <Icon d={['M5 12h14', 'M13 6l6 6-6 6']} stroke="#fff" width={2} />
          </button>
        </form>
        <p className="mt-1.5 text-center text-[11px] subtle">
          Changes always ask before they happen · Enter to send, Shift+Enter for a new line
        </p>
      </footer>
    </aside>
  );
}

function Welcome({ suggestions, onPick }) {
  return (
    <div className="pt-4">
      <p className="text-lg font-semibold">Hi — what can I do for you?</p>
      <p className="mt-1 text-sm muted">
        I can look things up, sort and filter your lists, record sales, add or change records, order stock,
        run reports and download files. I'll always show you a change before making it.
      </p>
      <div className="mt-4 space-y-2">
        {suggestions.map((s) => (
          <button key={s} type="button" onClick={() => !s.endsWith('…') && onPick(s)}
            className="block w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors"
            style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Thinking({ since }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const seconds = since ? Math.floor((now - since) / 1000) : 0;

  return (
    <div className="flex items-center gap-2 text-sm muted">
      <span className="assistant-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>
        {seconds < 6 ? 'Thinking…' : 'Waiting for the free AI allowance — just a few more seconds…'}
      </span>
    </div>
  );
}

function Entry({ entry, onRetry }) {
  const { cards } = useAssistant();

  if (entry.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md px-3.5 py-2 text-sm text-white" style={{ background: 'var(--accent)' }}>
          {entry.text}
        </div>
      </div>
    );
  }

  if (entry.role === 'error') {
    return (
      <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
        <p>{entry.text}</p>
        {entry.retry && (
          <button type="button" className="mt-2 font-medium underline" onClick={() => onRetry(entry.retry)}>
            Try again
          </button>
        )}
      </div>
    );
  }

  const done = [...new Set((entry.activity || []).filter((a) => a.state === 'done').map((a) => TOOL_LABELS[a.tool]).filter(Boolean))];

  return (
    <div className="space-y-2">
      {done.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {done.map((label) => (
            <span key={label} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
              style={{ background: 'var(--surface-sunken)', color: 'var(--text-subtle)' }}>
              <Icon d="M5 12l4 4L19 7" size={11} width={2.4} /> {label}
            </span>
          ))}
        </div>
      )}

      {entry.text && (
        <div className="text-sm leading-relaxed" style={{ color: 'var(--text)' }}>
          <Markdown text={entry.text} />
        </div>
      )}

      {(entry.blocks || []).map((block, i) => <Block key={i} block={block} />)}

      {(entry.pendingIds || []).map((id) => cards[id] && <ActionCard key={id} card={cards[id]} />)}
    </div>
  );
}

function Block({ block }) {
  const navigate = useNavigate();

  if (block.type === 'stats') {
    return (
      <div className="rounded-xl p-3" style={{ border: '1px solid var(--border)' }}>
        {block.title && <p className="mb-2 text-xs subtle">{block.title}</p>}
        <div className="grid grid-cols-2 gap-2">
          {block.items.map((item) => (
            <div key={item.label} className="rounded-lg px-2.5 py-2" style={{ background: 'var(--surface-sunken)' }}>
              <p className="text-[11px] subtle">{item.label}</p>
              <p className="text-base font-semibold tabular-nums">{formatValue(item.value, item.money)}</p>
              {item.note && <p className="text-[11px] muted">{item.note}</p>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (block.type === 'table') {
    const rows = block.rows.slice(0, 6);
    return (
      <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-3 py-2" style={{ background: 'var(--surface-sunken)' }}>
          <p className="text-xs font-medium">
            {block.title} <span className="subtle">· {block.total} {block.total === 1 ? 'match' : 'matches'}</span>
          </p>
          {block.page && PAGE_NAMES[block.page] && (
            <button type="button" className="text-xs link hover:underline" onClick={() => navigate(block.page)}>
              Open {PAGE_NAMES[block.page]}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderTop: '1px solid var(--border)' }}>
                  {block.columns.map((col, c) => (
                    <td key={col.key} className={`px-3 py-1.5 ${c === 0 ? 'font-medium' : 'muted'} ${typeof row[col.key] === 'number' ? 'text-right tabular-nums' : ''}`}>
                      {formatValue(row[col.key], /price|total|cost/.test(col.key))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {block.total > rows.length && (
          <p className="px-3 py-1.5 text-[11px] subtle" style={{ borderTop: '1px solid var(--border)' }}>
            and {block.total - rows.length} more
          </p>
        )}
      </div>
    );
  }

  if (block.type === 'download') {
    return (
      <a href={apiUrl(block.url)} download className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors"
        style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'var(--accent-soft)' }}>
          <Icon d={['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14']} size={15} stroke="var(--accent)" />
        </span>
        <span className="flex-1 font-medium">{block.label}</span>
        <span className="text-xs subtle">Download</span>
      </a>
    );
  }

  return null;
}

function ActionCard({ card }) {
  const { confirm, cancel, busy } = useAssistant();
  const tone = card.destructive ? 'var(--danger)' : 'var(--accent)';

  return (
    <div className="overflow-hidden rounded-xl" style={{ border: `1px solid ${card.state === 'open' ? tone : 'var(--border)'}` }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{
        background: card.destructive ? 'var(--danger-soft)' : 'var(--accent-soft)',
        color: card.destructive ? 'var(--danger)' : 'var(--accent-text)',
      }}>
        <p className="flex-1 text-sm font-semibold">{card.title}</p>
        {card.destructive && card.state === 'open' && <span className="text-[11px] font-medium">Can't be undone</span>}
      </div>

      <dl className="divide-y px-3 text-sm" style={{ borderColor: 'var(--border)' }}>
        {(card.lines || []).map(([label, value], i) => (
          <div key={i} className="flex justify-between gap-4 py-1.5" style={{ borderColor: 'var(--border)' }}>
            <dt className="muted">{label}</dt>
            <dd className="text-right font-medium tabular-nums">{value === null || value === undefined || value === '' ? '—' : String(value)}</dd>
          </div>
        ))}
      </dl>

      <div className="px-3 pb-3 pt-2">
        {card.state === 'open' && (
          <div className="flex gap-2">
            <button type="button" className="btn-primary flex-1 justify-center" disabled={busy}
              style={card.destructive ? { background: 'var(--danger)' } : undefined}
              onClick={() => confirm(card.id)}>
              {card.destructive ? 'Yes, delete it' : 'Confirm'}
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => cancel(card.id)}>
              Cancel
            </button>
          </div>
        )}
        {card.state === 'confirming' && <p className="text-sm muted">Working on it…</p>}
        {card.state === 'done' && (
          <p className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--success)' }}>
            <Icon d="M5 12l4 4L19 7" size={15} width={2.4} /> {card.result || 'Done'}
          </p>
        )}
        {card.state === 'cancelled' && <p className="text-sm subtle">Cancelled — nothing was changed.</p>}
        {card.state === 'failed' && <p className="text-sm" style={{ color: 'var(--danger)' }}>{card.result || 'That didn’t go through.'}</p>}
      </div>
    </div>
  );
}
