import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useList } from '../hooks/useList';
import { useAskOutcome } from '../hooks/useAskOutcome';
import AskBar from '../components/AskBar';
import {
  PageHeader, ErrorNote, Table, Modal, Field, Money,
  ConfirmButton, ExportButtons, SearchInput, Pagination,
} from '../components/ui';

// Customers and suppliers differ only by one field and their labels, so they
// share a page rather than duplicating the same form twice.
const CONFIG = {
  customers: {
    title: 'Customers',
    subtitle: 'People you sell to.',
    singular: 'customer',
    resource: () => api.customers,
    extraField: null,
  },
  suppliers: {
    title: 'Suppliers',
    subtitle: 'People you buy from.',
    singular: 'supplier',
    resource: () => api.suppliers,
    extraField: { key: 'contact_name', label: 'Contact person' },
  },
};

export default function ContactsPage({ kind }) {
  const config = CONFIG[kind];
  const resource = config.resource();

  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const fetcher = useCallback((params) => resource.list(params), [resource]);
  const list = useList(fetcher, { initialSort: 'name' });
  const handleAsk = useAskOutcome(list);

  async function save(form) {
    try {
      if (form.id) await resource.update(form.id, form);
      else await resource.create(form);
      setEditing(null);
      await list.reload();
    } catch (err) {
      list.setError(err.message);
      throw err;
    }
  }

  async function remove(id) {
    try {
      await resource.remove(id);
      await list.reload();
    } catch (err) {
      list.setError(err.message);
    }
  }

  const columns = [
    { key: 'name', label: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
    ...(config.extraField ? [{ key: config.extraField.key, label: config.extraField.label }] : []),
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'actions', label: '', sortable: false, align: 'right', render: (r) => (
      <div className="flex justify-end gap-2">
        {kind === 'customers' && (
          <button className="btn-edit" onClick={() => setViewing(r)}>History</button>
        )}
        <button className="btn-edit" onClick={() => setEditing(r)}>Edit</button>
        <ConfirmButton message={`Delete ${r.name}?`} onConfirm={() => remove(r.id)}>Delete</ConfirmButton>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title={config.title} subtitle={config.subtitle}>
        <ExportButtons table={kind} params={{ search: list.search, sort: list.sort, dir: list.dir }} />
        <button className="btn-primary" onClick={() => setEditing({ name: '' })}>
          Add {config.singular}
        </button>
      </PageHeader>

      <ErrorNote error={list.error} onDismiss={() => list.setError(null)} />

      <AskBar table={kind} onView={handleAsk} />

      <div className="mb-4 flex items-center gap-3">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder={`Search ${config.title.toLowerCase()}…`} />
        {list.loading && <span className="text-sm subtle">Loading…</span>}
      </div>

      <Table
        columns={columns}
        rows={list.rows}
        sort={list.sort}
        dir={list.dir}
        onSort={list.toggleSort}
        empty={list.search ? 'Nothing matches that.' : `No ${config.title.toLowerCase()} yet.`}
      />
      <Pagination meta={list.meta} page={list.page} onPage={list.setPage} loading={list.loading} />

      {viewing && <HistoryModal customer={viewing} onClose={() => setViewing(null)} />}

      {editing && (
        <ContactForm
          initial={editing}
          singular={config.singular}
          extraField={config.extraField}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ContactForm({ initial, singular, extraField, onSave, onClose }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(form);
    } catch {
      // Message is shown on the page; leave the form filled in.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={form.id ? `Edit ${singular}` : `Add ${singular}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <input className="input-field" value={form.name || ''} onChange={set('name')} autoFocus required />
        </Field>
        {extraField && (
          <Field label={extraField.label}>
            <input className="input-field" value={form[extraField.key] || ''} onChange={set(extraField.key)} />
          </Field>
        )}
        <Field label="Phone">
          <input className="input-field" value={form.phone || ''} onChange={set('phone')} />
        </Field>
        <Field label="Email">
          <input className="input-field" type="email" value={form.email || ''} onChange={set('email')} />
        </Field>
        <Field label="Address">
          <textarea className="input-field" rows="2" value={form.address || ''} onChange={set('address')} />
        </Field>
        <Field label="Notes">
          <textarea className="input-field" rows="2" value={form.notes || ''} onChange={set('notes')} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function HistoryModal({ customer, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.customers
      .history(customer.id)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [customer.id]);

  return (
    <Modal title={`${customer.name} — history`} onClose={onClose} wide>
      <ErrorNote error={error} />
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-token p-4">
              <p className="text-2xl font-semibold">{data.saleCount}</p>
              <p className="text-sm muted">Purchases</p>
            </div>
            <div className="rounded-lg border border-token p-4">
              <p className="text-2xl font-semibold">{Number(data.totalSpent).toFixed(2)}</p>
              <p className="text-sm muted">Total spent</p>
            </div>
          </div>

          {data.favourites.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">Buys most often</p>
              <ul className="space-y-1 text-sm muted">
                {data.favourites.map((f) => (
                  <li key={f.name}>{f.name} — {f.quantity}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-medium">Purchases</p>
            <Table
              columns={[
                { key: 'reference', label: 'Receipt' },
                { key: 'created_at', label: 'When', render: (s) => new Date(s.created_at).toLocaleDateString() },
                { key: 'payment_status', label: 'Payment' },
                { key: 'total', label: 'Total', align: 'right', render: (s) => <Money value={s.total} /> },
              ]}
              rows={data.sales}
              empty="Nothing bought yet."
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
