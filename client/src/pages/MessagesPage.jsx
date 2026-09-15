import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowUpRight, BellRing, CheckCircle2, Clock, Inbox, Mail, MessageSquare, PackageX, Send, Smartphone, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useList } from '../hooks/useList';
import { useAssistantView } from '../assistant/useAssistantView';
import { useSettings } from '../lib/settings';
import { Badge, Button, ConfirmButton, Empty, ErrorNote, ExportMenu, Notice, PageHeader, Pagination, SearchInput, SegmentedControl, useToast } from '../components/ui';
import { formatDate, formatDateTime, formatRelative, formatTime, parseDate } from '../lib/format';
import { cn } from '../lib/cn';

const STATUS = {
  queued: { tone: 'amber', label: 'Waiting', icon: Clock },
  sent: { tone: 'green', label: 'Sent', icon: CheckCircle2 },
  failed: { tone: 'red', label: 'Failed', icon: AlertTriangle },
};
const CHANNEL = { email: Mail, sms: Smartphone, whatsapp: MessageSquare };
const TRIGGER = {
  low_stock: { label: 'Low stock', icon: PackageX, hue: '#ff9f0a' },
  sale_receipt: { label: 'Sale receipt', icon: Mail, hue: '#0a84ff' },
  sale_confirmation: { label: 'Sale receipt', icon: Mail, hue: '#0a84ff' },
};
const CHANNEL_LABEL = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' };

function dayHeading(value) {
  const d = parseDate(value);
  if (!d) return '';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return formatDate(value, { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function MessagesPage() {
  const [status, setStatus] = useState('');
  const [counts, setCounts] = useState({ queued: 0, sent: 0, failed: 0 });
  const [selectedId, setSelectedId] = useState(null);
  const [sending, setSending] = useState(false);
  const [flights, setFlights] = useState(0);
  const toast = useToast();

  const fetcher = useCallback((p) => api.messages.list(p), []);
  const list = useList(fetcher, { initialSort: 'created_at', initialDir: 'desc', filters: { status }, pageSize: 30 });
  useAssistantView('message_log', list, { status: setStatus }, { defaultSort: 'created_at', defaultDir: 'desc' });

  useEffect(() => {
    Promise.all(['queued', 'sent', 'failed'].map((s) => api.messages.list({ status: s, pageSize: 1 }).then((d) => [s, d.total])))
      .then((entries) => setCounts(Object.fromEntries(entries)))
      .catch(() => {});
  }, [list.rows]);

  const selected = list.rows.find((m) => m.id === selectedId) || null;
  useEffect(() => {
    if (!selectedId && list.rows.length && window.matchMedia('(min-width: 1024px)').matches) setSelectedId(list.rows[0].id);
  }, [list.rows, selectedId]);

  const groups = useMemo(() => {
    const out = [];
    for (const m of list.rows) {
      const heading = dayHeading(m.created_at);
      if (!out.length || out[out.length - 1].heading !== heading) out.push({ heading, items: [] });
      out[out.length - 1].items.push(m);
    }
    return out;
  }, [list.rows]);

  async function sendAll() {
    setSending(true);
    try {
      const result = await api.messages.send();
      if (result.sent) setFlights((n) => n + 1);
      toast.success(result.sent ? `${result.sent} message${result.sent === 1 ? '' : 's'} sent` : 'Nothing was waiting', {
        description: result.sent ? 'Simulated - nothing left this computer. Connect a provider to deliver for real.' : undefined,
      });
      await list.reload();
    } catch (err) {
      list.setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function remove(m) {
    try {
      await api.messages.remove(m.id);
      if (selectedId === m.id) setSelectedId(null);
      toast.success('Message deleted');
      await list.reload();
    } catch (err) {
      list.setError(err.message);
    }
  }

  const total = counts.queued + counts.sent + counts.failed;

  return (
    <div>
      <PageHeader title="Messages" subtitle="Alerts and receipts DocDesk decided to send on its own." eyebrow="Outbox" icon={BellRing}>
        <ExportMenu table="message_log" params={{ search: list.search, status }} />
        <div className="relative">
          <Button icon={Send} onClick={sendAll} loading={sending} disabled={!counts.queued}>
            {counts.queued ? `Send ${counts.queued} waiting` : 'All caught up'}
          </Button>
          <AnimatePresence>
            {flights > 0 && (
              <motion.span
                key={flights}
                className="pointer-events-none absolute left-4 top-2 text-accent"
                initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
                animate={{ x: 160, y: -120, opacity: 0, rotate: -20, scale: 0.6 }}
                transition={{ duration: 0.9, ease: [0.3, 0.7, 0.4, 1] }}
                onAnimationComplete={() => setFlights(0)}
              >
                <Send size={20} />
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </PageHeader>

      <ErrorNote error={list.error} onDismiss={() => list.setError(null)} />

      <Notice tone="info" title="Delivery is simulated" className="mb-6">
        DocDesk works out <em>when</em> a message should go - stock running low, a sale with an email on file - and queues it here. Sending marks them done without anything leaving this computer until an email or SMS provider is connected.
      </Notice>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search messages…" />
        <SegmentedControl
          size="sm"
          value={status}
          onChange={setStatus}
          options={[['', 'All', Inbox, total], ['queued', 'Waiting', Clock, counts.queued], ['sent', 'Sent', CheckCircle2, counts.sent], ['failed', 'Failed', AlertTriangle, counts.failed]]}
          ariaLabel="Status"
        />
      </div>

      {list.rows.length === 0 && !list.loading ? (
        <Empty icon={Inbox} title={list.search || status ? 'Nothing matches' : 'No messages yet'} message={list.search || status ? 'Try another search or status.' : 'Let stock run low or record a sale for a customer with an email, and messages appear here.'} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className={cn('transition-opacity', list.loading && 'opacity-60')}>
            {groups.map((group) => (
              <section key={group.heading} className="mb-5">
                <h3 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">{group.heading}</h3>
                <ul className="panel divide-y divide-[var(--line)] overflow-hidden">
                  {group.items.map((m, i) => {
                    const trigger = TRIGGER[m.trigger_type] || { label: (m.trigger_type || 'Message').replace(/_/g, ' '), icon: Mail, hue: '#8e8e93' };
                    const Icon = trigger.icon;
                    const active = selected?.id === m.id;
                    return (
                      <motion.li key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.02 }}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(m.id)}
                          className={cn('relative flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors', active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--wash)]')}
                        >
                          {active && <motion.span layoutId="message-active" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent" />}
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px]" style={{ background: `${trigger.hue}1f`, color: trigger.hue }}>
                            <Icon size={16} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className={cn('truncate text-[14px]', m.status === 'queued' ? 'font-semibold' : 'font-medium')}>{m.subject || '(no subject)'}</p>
                              <span className="shrink-0 text-[11.5px] text-ink-3 tabular">{formatTime(m.created_at)}</span>
                            </div>
                            <p className="mt-0.5 line-clamp-1 text-[12.5px] text-ink-2">{m.body}</p>
                            <div className="mt-1.5 flex items-center gap-2">
                              <Badge tone={STATUS[m.status]?.tone || 'slate'} dot>{STATUS[m.status]?.label || m.status}</Badge>
                              <span className="text-[11.5px] text-ink-3">{trigger.label}{m.recipient ? ` · ${m.recipient}` : ''}</span>
                            </div>
                          </div>
                        </button>
                      </motion.li>
                    );
                  })}
                </ul>
              </section>
            ))}
            <Pagination meta={list.meta} page={list.page} onPage={list.setPage} loading={list.loading} />
          </div>

          <div className="hidden lg:block">
            <div className="sticky top-24">
              <AnimatePresence mode="wait">
                {selected ? <MessagePreview key={selected.id} message={selected} onDelete={() => remove(selected)} /> : <Empty key="none" compact icon={Mail} title="Pick a message" message="Its full text and where it came from show here." />}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}

      {/* On a phone, the preview slides up as a sheet. */}
      <AnimatePresence>
        {selected && (
          <motion.div className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto p-3 lg:hidden" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }} data-lenis-prevent>
            <MessagePreview message={selected} onDelete={() => remove(selected)} onClose={() => setSelectedId(null)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MessagePreview({ message: m, onDelete, onClose }) {
  const { businessName } = useSettings();
  const ChannelIcon = CHANNEL[m.channel] || Mail;
  const st = STATUS[m.status] || STATUS.queued;
  const StatusIcon = st.icon;
  const related = m.related_type === 'product' ? `/inventory?view=${m.related_id}` : m.related_type === 'sale' ? `/sales?receipt=${m.related_id}` : null;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12, rotateX: -6 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      style={{ transformPerspective: 900, background: 'rgb(var(--c-elevated))', boxShadow: '0 0 0 1px var(--line), var(--shadow-lg), var(--edge-highlight)' }}
      className="overflow-hidden rounded-[24px]"
    >
      <div className="flex items-center gap-2 px-5 py-3" style={{ background: 'var(--wash)', borderBottom: '1px solid var(--line)' }}>
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="ml-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-2"><ChannelIcon size={13} /> {CHANNEL_LABEL[m.channel] || m.channel}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[12px] text-ink-2"><StatusIcon size={13} /> {st.label}</span>
        {onClose && <button type="button" className="btn-ghost btn-sm ml-2" onClick={onClose}>Close</button>}
      </div>
      <div className="p-6">
        <dl className="mb-5 grid grid-cols-[64px_1fr] gap-y-1.5 text-[13px]">
          <dt className="text-ink-3">From</dt><dd className="font-medium">{businessName}</dd>
          <dt className="text-ink-3">To</dt><dd>{m.recipient || <span className="text-ink-3">Shop owner (no address set)</span>}</dd>
          <dt className="text-ink-3">Queued</dt><dd>{formatDateTime(m.created_at)} <span className="text-ink-3">· {formatRelative(m.created_at)}</span></dd>
          {m.sent_at && (<><dt className="text-ink-3">Sent</dt><dd>{formatDateTime(m.sent_at)}</dd></>)}
        </dl>
        <h2 className="mb-3 text-[20px] font-semibold tracking-[-0.02em]">{m.subject || '(no subject)'}</h2>
        <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink-2">{m.body}</p>
        {m.error && <Notice tone="danger" title="Delivery failed" className="mt-4">{m.error}</Notice>}
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-4">
          {related && (
            <Link to={related} className="btn-secondary btn-sm">
              Open {m.related_type} <ArrowUpRight size={14} />
            </Link>
          )}
          <span className="ml-auto" />
          <ConfirmButton className="btn-danger btn-sm" icon={Trash2} message="Delete this message from the log?" onConfirm={onDelete}>Delete</ConfirmButton>
        </div>
      </div>
    </motion.article>
  );
}
