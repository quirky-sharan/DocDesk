import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, ErrorNote, Table, Badge, ConfirmButton, ExportButtons } from '../components/ui';

const TONE = { queued: 'amber', sent: 'green', failed: 'red' };

export default function MessagesPage() {
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.messages.list({ sort: 'created_at', dir: 'desc' });
      setMessages(data.rows);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    try {
      await api.messages.remove(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const queued = messages.filter((m) => m.status === 'queued').length;

  const columns = [
    { key: 'status', label: 'Status', render: (m) => <Badge tone={TONE[m.status] || 'slate'}>{m.status}</Badge> },
    { key: 'subject', label: 'Message', render: (m) => (
      <div>
        <div className="font-medium">{m.subject || '—'}</div>
        <div className="text-xs text-slate-500">{m.body}</div>
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
        <button className="btn-primary" onClick={sendAll} disabled={busy || queued === 0}>
          {busy ? 'Sending…' : `Send ${queued || ''} waiting`.trim()}
        </button>
      </PageHeader>

      <ErrorNote error={error} onDismiss={() => setError(null)} />

      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-semibold">Sending is not switched on yet</p>
        <p className="mt-1">
          DocDesk works out <em>when</em> a message should go out — when something runs low, or when
          you make a sale — and lists it here. Actually delivering it needs an email or SMS account,
          which gets connected in the last phase. Until then "Send" just marks them as done.
        </p>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          {notice}
        </div>
      )}

      {loading && <p className="mb-2 text-sm text-slate-400">Loading…</p>}

      <Table
        columns={columns}
        rows={messages}
        empty="No messages yet. Sell something or let stock run low, and alerts show up here."
      />
    </div>
  );
}
