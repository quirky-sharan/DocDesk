import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  PageHeader, ErrorNote, Table, Modal, Field,
  ConfirmButton, ExportButtons, SearchInput,
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

  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [dir, setDir] = useState('asc');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await resource.list({ search, sort, dir });
      setRows(data.rows);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [resource, search, sort, dir]);

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  function toggleSort(key) {
    if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setDir('asc');
    }
  }

  async function save(form) {
    try {
      if (form.id) await resource.update(form.id, form);
      else await resource.create(form);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  async function remove(id) {
    try {
      await resource.remove(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const columns = [
    { key: 'name', label: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
    ...(config.extraField ? [{ key: config.extraField.key, label: config.extraField.label }] : []),
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'actions', label: '', sortable: false, align: 'right', render: (r) => (
      <div className="flex justify-end gap-2">
        <button className="btn-edit" onClick={() => setEditing(r)}>Edit</button>
        <ConfirmButton message={`Delete ${r.name}?`} onConfirm={() => remove(r.id)}>Delete</ConfirmButton>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title={config.title} subtitle={config.subtitle}>
        <ExportButtons table={kind} params={{ search, sort, dir }} />
        <button className="btn-primary" onClick={() => setEditing({ name: '' })}>
          Add {config.singular}
        </button>
      </PageHeader>

      <ErrorNote error={error} onDismiss={() => setError(null)} />

      <div className="mb-4 flex items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder={`Search ${config.title.toLowerCase()}…`} />
        {loading && <span className="text-sm text-slate-400">Loading…</span>}
      </div>

      <Table
        columns={columns}
        rows={rows}
        sort={sort}
        dir={dir}
        onSort={toggleSort}
        empty={search ? 'Nothing matches that.' : `No ${config.title.toLowerCase()} yet.`}
      />

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
