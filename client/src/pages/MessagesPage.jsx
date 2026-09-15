import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useList } from '../hooks/useList';
import { useAskOutcome } from '../hooks/useAskOutcome';
import AskBar from '../components/AskBar';
import {
  PageHeader, ErrorNote, Table, Badge, ConfirmButton, ExportButtons,
  SearchInput, Select, Pagination,
} from '../components/ui';

const TONE = { queued: 'amber', sent: 'green', failed: 'red' };

export default function MessagesPage() {
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [queuedCount, setQueuedCount] = useState(0);

  const fetcher = useCallback((params) => api.messages.list(params), []);
  const list = useList(fetcher, { initialSort: 'created_at', initialDir: 'desc', filters: { status } });
  const handleAsk = useAskOutcome(list, {
    filterHandlers: { status: (value) => setStatus(String(value)) },
  });

  // The send button needs the total waiting, not just what is on this page.
  useEffect(() => {
    api.messages
      .list({ status: 'queued', pageSize: 1 })
      .then((d) => setQueuedCount(d.total))
      .catch(() => {});
  }, [list.rows]);

  async function sendAll() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.messages.send();
      setNotice(
        result.sent === 0
          ? 'Nothing was waiting to be sent.'
          : `${result.sent} message${result.sent === 1 ? '' : 's'} marked as sent. Nothing actually left your computer — real sending is switched on later.`
      );
      await list.reload();
    } catch (err) {
      list.setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    try {
      await api.messages.remove(id);
      await list.reload();
    } catch (err) {
      list.setError(err.message);
    }
  }

  const columns = [
    { key: 'status', label: 'Status', render: (m) => <Badge tone={TONE[m.status] || 'slate'}>{m.status}</Badge> },
    { key: 'subject', label: 'Message', render: (m) => (
      <div>
        <div className="font-medium">{m.subject || '—'}</div>
        <div className="text-xs muted">{m.body}</div>
      </div>
    ) },
    { key: 'trigger_type', label: 'Triggered by', render: (m) => (m.trigger_type || '—').replace(/_/g, ' ') },
    { key: 'recipient', label: 'To', render: (m) => m.recipient || '—' },
    { key: 'created_at', label: 'Created', render: (m) => new Date(m.created_at).toLocaleString() },
    { key: 'actions', label: '', sortable: false, align: 'right', render: (m) => (
      <ConfirmButton message="Delete this message?" onConfirm={() => remove(m.id)}>Delete</ConfirmButton>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Messages" subtitle="Alerts DocDesk raised on its own.">
        <ExportButtons table="message_log" />
        <button className="btn-primary" onClick={sendAll} disabled={busy || queuedCount === 0}>
          {busy ? 'Sending…' : queuedCount ? `Send ${queuedCount} waiting` : 'Nothing waiting'}
        </button>
      </PageHeader>

      <ErrorNote error={list.error} onDismiss={() => list.setError(null)} />

      <div className="mb-6 rounded-lg border border-accent bg-accent-soft p-4 text-sm text-accent">
        <p className="font-semibold">Sending is not switched on yet</p>
        <p className="mt-1">
          DocDesk works out <em>when</em> a message should go out — when something runs low, or when
          you make a sale — and lists it here. Actually delivering it needs an email or SMS account,
          which gets connected in the last phase. Until then "Send" just marks them as done.
        </p>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-success bg-success-soft p-4 text-sm text-success">
          {notice}
        </div>
      )}

      <AskBar table="message_log" onView={handleAsk} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search messages…" />
        <Select
          value={status}
          onChange={setStatus}
          options={[['queued', 'Waiting'], ['sent', 'Sent'], ['failed', 'Failed']]}
          placeholder="Any status"
        />
        {list.loading && <span className="text-sm subtle">Loading…</span>}
      </div>

      <Table
        columns={columns}
        rows={list.rows}
        sort={list.sort}
        dir={list.dir}
        onSort={list.toggleSort}
        empty="No messages yet. Sell something or let stock run low, and alerts show up here."
      />
      <Pagination meta={list.meta} page={list.page} onPage={list.setPage} loading={list.loading} />
    </div>
  );
}
