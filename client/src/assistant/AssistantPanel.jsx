import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, ArrowUp, Check, CircleAlert, Download, KeyRound, RotateCcw, Sparkles, X } from 'lucide-react';
import { apiUrl } from '../api/client';
import { useAssistant } from './AssistantProvider';
import Markdown from './Markdown';
import { Button } from '../components/ui';
import { cn } from '../lib/cn';

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
  '/database': ['How big is the database?', 'Back up the database now', 'Which tables have the most rows?'],
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
  database_overview: 'Inspected the database',
  backup_database: 'Backed up the database',
};

const PAGE_NAMES = {
  '/inventory': 'Inventory', '/sales': 'Sales', '/orders': 'Incoming stock', '/customers': 'Customers',
  '/suppliers': 'Suppliers', '/files': 'Files', '/messages': 'Messages', '/database': 'Database',
};

function formatValue(value, money) {
  if (value === null || value === undefined || value === '') return '—';
  if (money || (typeof value === 'number' && !Number.isInteger(value))) return Number(value).toFixed(2);
  return String(value);
}

// ---------------------------------------------------------------------------

/** A floating orb that opens the assistant; expands to show its name on hover. */
export function AssistantLauncher() {
  const { open, setOpen, openCount, status, busy } = useAssistant();

  return (
    <AnimatePresence>
      {!open && (
        <motion.button
          type="button"
          onClick={() => setOpen(true)}
          initial={{ opacity: 0, scale: 0.6, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.6, y: 20 }}
          whileHover="hover"
          whileTap={{ scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 420, damping: 26 }}
          className="glass group fixed bottom-5 right-5 z-40 flex h-14 items-center rounded-full p-2 text-[14px] font-semibold text-ink"
          style={{ background: 'var(--glass-strong)', boxShadow: '0 0 0 1px var(--glass-outline, var(--line)), var(--shadow-xl)' }}
          title="Ask DocDesk (Ctrl+J)"
          aria-label="Open the DocDesk assistant"
        >
          <span className={cn('ai-orb h-10 w-10 shrink-0', busy && 'is-busy')} />
          <motion.span
            variants={{ hover: { width: 'auto', opacity: 1, marginLeft: 10, marginRight: 8 } }}
            initial={{ width: 0, opacity: 0, marginLeft: 0, marginRight: 0 }}
            className="flex items-center gap-2 overflow-hidden whitespace-nowrap"
          >
            Ask DocDesk <kbd className="kbd">Ctrl J</kbd>
          </motion.span>
          {openCount > 0 && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[rgb(var(--c-danger))] px-1 text-[11px] font-semibold text-white" style={{ boxShadow: '0 0 0 2px rgb(var(--c-canvas))' }}>
              {openCount}
            </motion.span>
          )}
          {status && !status.configured && openCount === 0 && (
            <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full bg-[rgb(var(--c-warning))]" style={{ boxShadow: '0 0 0 2px rgb(var(--c-canvas))' }} />
          )}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

export default function AssistantPanel() {
  const { open, setOpen, entries, busy, busySince, status, send, reset } = useAssistant();
  const { pathname } = useLocation();
  const [draft, setDraft] = useState('');
  const scroller = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 120);
  }, [open]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [entries.length, busy, open]);

  function submit(text = draft) {
    if (!text.trim() || busy) return;
    send(text);
    setDraft('');
    if (input.current) input.current.style.height = 'auto';
  }

  const suggestions = SUGGESTIONS[pathname] || SUGGESTIONS['/'];
  const notConfigured = status && !status.configured;

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="assistant"
          initial={{ opacity: 0, x: 40, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 40, scale: 0.98, transition: { duration: 0.2 } }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="glass fixed inset-0 z-50 flex flex-col overflow-hidden sm:inset-auto sm:bottom-3 sm:right-3 sm:top-3 sm:w-[440px] sm:rounded-[28px]"
          style={{ background: 'var(--glass-strong)', boxShadow: '0 0 0 1px var(--glass-outline, var(--line)), var(--shadow-xl)' }}
          aria-label="DocDesk assistant"
        >
          {/* A slowly turning rainbow edge while it is working, like Siri. */}
          <span aria-hidden="true" className={cn('ai-glow', busy && 'is-active')} />
          <span aria-hidden="true" className={cn('ai-glow ai-glow-blur', busy && 'is-active')} style={{ opacity: busy ? 0.5 : 0 }} />

          <header className="relative flex h-16 shrink-0 items-center gap-3 px-4" style={{ borderBottom: '1px solid var(--line)' }}>
            <span className={cn('ai-orb h-9 w-9 shrink-0', busy && 'is-busy')} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-tight tracking-[-0.01em]">DocDesk</p>
              <p className="flex items-center gap-1.5 text-[12px] leading-tight text-ink-3">
                <span className={cn('h-1.5 w-1.5 rounded-full', busy && 'animate-pulse')} style={{ background: notConfigured ? 'rgb(var(--c-warning))' : status?.reachable === false ? 'rgb(var(--c-danger))' : 'rgb(var(--c-success))' }} />
                {notConfigured ? 'Not connected' : busy ? 'Working…' : status?.model ? `Ready · ${status.label || status.provider}` : 'Ready to help'}
              </p>
            </div>
            {entries.length > 0 && (
              <button type="button" className="btn-ghost btn-sm" onClick={reset} title="Start a new conversation">
                <RotateCcw size={14} /> New
              </button>
            )}
            <button type="button" className="btn-ghost btn-icon" onClick={() => setOpen(false)} aria-label="Close assistant" title="Close (Esc)">
              <X size={17} />
            </button>
          </header>

          <div ref={scroller} className="relative flex-1 space-y-5 overflow-y-auto px-4 py-5" data-lenis-prevent>
            {notConfigured && (
              <div className="flex gap-3 rounded-[18px] p-3.5 text-[13px]" style={{ background: 'var(--warning-soft)' }}>
                <KeyRound size={16} className="mt-0.5 shrink-0 text-warning" />
                <div>
                  <p className="font-semibold text-warning">The assistant isn&apos;t connected yet</p>
                  <p className="mt-1 leading-relaxed text-ink">Add a free Groq key as <code className="kbd">GROQ_API_KEY</code> in <code className="kbd">server/.env</code> and restart. Everything else works without it.</p>
                </div>
              </div>
            )}

            {entries.length === 0 && (
              <Welcome
                suggestions={suggestions}
                onPick={submit}
                onFill={(text) => {
                  setDraft(text);
                  input.current?.focus();
                }}
              />
            )}

            {entries.map((entry) => <Entry key={entry.id} entry={entry} onRetry={submit} />)}

            <AnimatePresence>{busy && <Thinking key="thinking" since={busySince} />}</AnimatePresence>
          </div>

          <footer className="relative shrink-0 px-3 pb-3 pt-2">
            {entries.length > 0 && !busy && (
              <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1" data-lenis-prevent>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => (s.endsWith('…') ? (setDraft(s.replace('…', ' ')), input.current?.focus()) : submit(s))}
                    className="shrink-0 rounded-full px-3 py-1.5 text-[12px] text-ink-2 transition-colors hover:text-ink"
                    style={{ background: 'var(--wash-strong)' }}
                  >
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
              className="flex items-end gap-2 rounded-[22px] p-1.5 transition-shadow focus-within:shadow-[0_0_0_4px_var(--ring)]"
              style={{ background: 'rgb(var(--c-surface))', boxShadow: '0 0 0 1px var(--line), var(--shadow-sm)' }}
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
                placeholder={notConfigured ? 'Connect an AI key to start' : 'Ask anything, or tell me what to do…'}
                className="max-h-[132px] min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink-3"
                disabled={notConfigured}
              />
              <motion.button
                type="submit"
                whileTap={{ scale: 0.88 }}
                animate={{ scale: draft.trim() ? 1 : 0.92, opacity: busy || !draft.trim() || notConfigured ? 0.4 : 1 }}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-white"
                disabled={busy || !draft.trim() || notConfigured}
                aria-label="Send"
              >
                <ArrowUp size={18} strokeWidth={2.4} />
              </motion.button>
            </form>
            <p className="mt-2 text-center text-[11px] text-ink-3">Changes always ask first · Enter to send · Shift+Enter for a new line</p>
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Welcome({ suggestions, onPick, onFill }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="pt-2">
      <motion.div initial={{ scale: 0.6, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 14, delay: 0.1 }} className="ai-orb mb-5 h-14 w-14" />
      <p className="text-[22px] font-semibold leading-tight tracking-[-0.025em]">Hi - what can I do for you?</p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
        I can look things up, filter your lists, record sales, add or change records, order stock, run reports, back up the database and prepare downloads. I&apos;ll always show you a change before making it.
      </p>
      <div className="mt-5 space-y-2">
        {suggestions.map((s, i) => (
          <motion.button
            key={s}
            type="button"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 + i * 0.06 }}
            whileHover={{ x: 3 }}
            onClick={() => (s.endsWith('…') ? onFill(s.replace('…', ' ')) : onPick(s))}
            className="group flex w-full items-center gap-3 rounded-[16px] px-3.5 py-3 text-left text-[13.5px] transition-colors hover:bg-[rgb(var(--c-surface))]"
            style={{ background: 'var(--wash)' }}
          >
            <Sparkles size={14} className="shrink-0 text-violet" />
            <span className="flex-1">{s}</span>
            <ArrowRight size={14} className="text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </motion.button>
        ))}
      </div>
    </motion.div>
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
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5 text-[13px] text-ink-2">
      <span className="assistant-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{seconds < 6 ? 'Thinking…' : 'Waiting for the free AI allowance - a few more seconds…'}</span>
    </motion.div>
  );
}

function Entry({ entry, onRetry }) {
  const { cards } = useAssistant();

  if (entry.role === 'user') {
    return (
      <motion.div initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }} className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-br-[6px] px-4 py-2.5 text-[14px] leading-relaxed text-white" style={{ background: 'linear-gradient(160deg, rgb(var(--c-accent)), rgb(var(--c-accent) / 0.85))', boxShadow: '0 6px 16px -8px rgb(var(--c-accent) / 0.7)' }}>
          {entry.text}
        </div>
      </motion.div>
    );
  }

  if (entry.role === 'error') {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5 rounded-[18px] p-3.5 text-[13.5px]" style={{ background: 'var(--danger-soft)' }}>
        <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" />
        <div>
          <p className="text-ink">{entry.text}</p>
          {entry.retry && (
            <button type="button" className="mt-2 inline-flex items-center gap-1 font-medium text-danger hover:underline" onClick={() => onRetry(entry.retry)}>
              <RotateCcw size={13} /> Try again
            </button>
          )}
        </div>
      </motion.div>
    );
  }

  const done = [...new Set((entry.activity || []).filter((a) => a.state === 'done').map((a) => TOOL_LABELS[a.tool]).filter(Boolean))];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} className="space-y-2.5">
      {done.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {done.map((label, i) => (
            <motion.span key={label} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-ink-3" style={{ background: 'var(--wash-strong)' }}>
              <Check size={11} strokeWidth={2.6} /> {label}
            </motion.span>
          ))}
        </div>
      )}

      {entry.text && (
        <div className="text-[14px] leading-relaxed text-ink">
          <Markdown text={entry.text} />
        </div>
      )}

      {(entry.blocks || []).map((block, i) => <Block key={i} block={block} />)}

      {(entry.pendingIds || []).map((id) => cards[id] && <ActionCard key={id} card={cards[id]} />)}
    </motion.div>
  );
}

function Block({ block }) {
  const navigate = useNavigate();

  if (block.type === 'stats') {
    return (
      <div className="rounded-[18px] p-3" style={{ background: 'rgb(var(--c-surface))', boxShadow: '0 0 0 1px var(--line)' }}>
        {block.title && <p className="mb-2 text-[12px] text-ink-3">{block.title}</p>}
        <div className="grid grid-cols-2 gap-2">
          {block.items.map((item) => (
            <div key={item.label} className="rounded-[12px] px-3 py-2" style={{ background: 'var(--wash)' }}>
              <p className="text-[11px] text-ink-3">{item.label}</p>
              <p className="text-[16px] font-semibold tabular">{formatValue(item.value, item.money)}</p>
              {item.note && <p className="text-[11px] text-ink-2">{item.note}</p>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (block.type === 'table') {
    const rows = block.rows.slice(0, 6);
    return (
      <div className="overflow-hidden rounded-[18px]" style={{ background: 'rgb(var(--c-surface))', boxShadow: '0 0 0 1px var(--line)' }}>
        <div className="flex items-center justify-between px-3 py-2" style={{ background: 'var(--wash)' }}>
          <p className="text-[12px] font-medium">
            {block.title} <span className="text-ink-3">· {block.total} {block.total === 1 ? 'match' : 'matches'}</span>
          </p>
          {block.page && PAGE_NAMES[block.page] && (
            <button type="button" className="text-[12px] font-medium text-accent-ink hover:underline" onClick={() => navigate(block.page)}>
              Open {PAGE_NAMES[block.page]}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderTop: '1px solid var(--line)' }}>
                  {block.columns.map((col, c) => (
                    <td key={col.key} className={cn('px-3 py-1.5', c === 0 ? 'font-medium' : 'text-ink-2', typeof row[col.key] === 'number' && 'text-right tabular')}>
                      {formatValue(row[col.key], /price|total|cost/.test(col.key))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {block.total > rows.length && (
          <p className="px-3 py-1.5 text-[11px] text-ink-3" style={{ borderTop: '1px solid var(--line)' }}>
            and {block.total - rows.length} more
          </p>
        )}
      </div>
    );
  }

  if (block.type === 'link') {
    return (
      <button type="button" onClick={() => navigate(block.path)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-accent-ink transition-colors hover:bg-[var(--accent-soft)]" style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}>
        {block.label}
        <ArrowRight size={12} />
      </button>
    );
  }

  if (block.type === 'download') {
    return (
      <a href={apiUrl(block.url)} download className="flex items-center gap-3 rounded-[16px] px-3 py-2.5 text-[13.5px] transition-colors hover:bg-[var(--wash)]" style={{ background: 'rgb(var(--c-surface))', boxShadow: '0 0 0 1px var(--line)' }}>
        <span className="grid h-8 w-8 place-items-center rounded-[10px]" style={{ background: 'var(--accent-soft)' }}>
          <Download size={15} className="text-accent-ink" />
        </span>
        <span className="flex-1 font-medium">{block.label}</span>
        <span className="text-[12px] text-ink-3">Download</span>
      </a>
    );
  }

  return null;
}

function ActionCard({ card }) {
  const { confirm, cancel, busy } = useAssistant();
  const isOpen = card.state === 'open';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="overflow-hidden rounded-[20px]"
      style={{
        background: 'rgb(var(--c-surface))',
        boxShadow: isOpen ? `0 0 0 1.5px ${card.destructive ? 'rgb(var(--c-danger))' : 'rgb(var(--c-accent))'}, var(--shadow-md)` : '0 0 0 1px var(--line)',
      }}
    >
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: card.destructive ? 'var(--danger-soft)' : 'var(--accent-soft)' }}>
        <p className={cn('flex-1 text-[13.5px] font-semibold', card.destructive ? 'text-danger' : 'text-accent-ink')}>{card.title}</p>
        {card.destructive && isOpen && <span className="text-[11px] font-medium text-danger">Can&apos;t be undone</span>}
      </div>

      <dl className="px-4 text-[13px]">
        {(card.lines || []).map(([label, value], i) => (
          <div key={i} className="flex justify-between gap-4 py-1.5" style={{ borderTop: i ? '1px solid var(--line)' : undefined }}>
            <dt className="text-ink-2">{label}</dt>
            <dd className="text-right font-medium tabular">{value === null || value === undefined || value === '' ? '—' : String(value)}</dd>
          </div>
        ))}
      </dl>

      <div className="px-4 pb-3.5 pt-2">
        <AnimatePresence mode="wait" initial={false}>
          {isOpen && (
            <motion.div key="open" exit={{ opacity: 0, y: -4 }} className="flex gap-2">
              <Button variant={card.destructive ? 'danger' : 'primary'} className="flex-1 justify-center" disabled={busy} onClick={() => confirm(card.id)}>
                {card.destructive ? 'Yes, delete it' : 'Confirm'}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => cancel(card.id)}>Cancel</Button>
            </motion.div>
          )}
          {card.state === 'confirming' && (
            <motion.p key="confirming" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-[13px] text-ink-2">
              <span className="assistant-dots" aria-hidden="true"><i /><i /><i /></span> Working on it…
            </motion.p>
          )}
          {card.state === 'done' && (
            <motion.p key="done" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 text-[13px] text-success">
              <motion.span initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 16 }} className="grid h-5 w-5 place-items-center rounded-full bg-[rgb(var(--c-success))] text-white">
                <Check size={12} strokeWidth={3} />
              </motion.span>
              {card.result || 'Done'}
            </motion.p>
          )}
          {card.state === 'cancelled' && <motion.p key="cancelled" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[13px] text-ink-3">Cancelled - nothing was changed.</motion.p>}
          {card.state === 'failed' && <motion.p key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[13px] text-danger">{card.result || 'That didn’t go through.'}</motion.p>}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
