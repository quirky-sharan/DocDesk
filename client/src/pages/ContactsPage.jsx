import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Building2, Copy, History, Mail, Pencil, Phone, Receipt, ShoppingBag, Trash2, TrendingUp, UserPlus, Users, Wallet } from 'lucide-react';
import { api } from '../api/client';
import { useList } from '../hooks/useList';
import { useAssistantView } from '../assistant/useAssistantView';
import { useSettings } from '../lib/settings';
import {
  Avatar, Badge, Button, ConfirmButton, ErrorNote, ExportMenu, Field, Modal, PageHeader, Pagination, SearchInput,
  SegmentedControl, Spinner, Table, useToast,
} from '../components/ui';
import { ColumnChart, HorizontalBars } from '../components/charts';
import { ChangeEntry } from '../components/ProductDetail';
import { formatDate, formatRelative } from '../lib/format';

// Customers and suppliers differ by a field and their labels, so they share a page.
const CONFIG = {
  customers: {
    title: 'Customers',
    subtitle: 'The people and businesses you sell to - and what each is worth.',
    singular: 'customer',
    icon: Users,
    resource: () => api.customers,
    extraField: null,
    sort: 'name',
  },
  suppliers: {
    title: 'Suppliers',
    subtitle: 'Who you buy from, what they supply and what is on order.',
    singular: 'supplier',
    icon: Building2,
    resource: () => api.suppliers,
    extraField: { key: 'contact_name', label: 'Contact person' },
    sort: 'name',
  },
};

export default function ContactsPage({ kind }) {
  const config = CONFIG[kind];
  const resource = config.resource();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const { money, compactMoney } = useSettings();
  const toast = useToast();

  const fetcher = useCallback((p) => resource.list(p), [resource]);
  const list = useList(fetcher, { initialSort: config.sort });
  useAssistantView(kind, list, {}, { defaultSort: config.sort });

  useEffect(() => {
    const history = params.get('history');
    const search = params.get('search');
    if (params.get('new')) setEditing({ name: '' });
    if (history) resource.get(history).then(setViewing).catch(() => {});
    if (search) list.setSearch(search);
    if (params.get('new') || history || search) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function save(form) {
    const saved = form.id ? await resource.update(form.id, form) : await resource.create(form);
    setEditing(null);
    toast.success(form.id ? `${config.singular[0].toUpperCase()}${config.singular.slice(1)} saved` : `${config.singular[0].toUpperCase()}${config.singular.slice(1)} added`, { description: saved.name });
    await list.reload();
  }

  async function remove(row) {
    try {
      await resource.remove(row.id);
      toast.success('Deleted', { description: row.name });
      await list.reload();
    } catch (err) {
      list.setError(err.message);
    }
  }

  const copy = (text, label) => {
    navigator.clipboard?.writeText(text).then(() => toast.info(`${label} copied`, { description: text, duration: 1800 })).catch(() => {});
  };

  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: (r) => (
        <div className="flex items-center gap-3">
          <Avatar name={r.name} size={38} square={kind === 'suppliers'} />
          <div className="min-w-0">
            <p className="truncate font-medium">{r.name}</p>
            <p className="truncate text-[12px] text-ink-3">{kind === 'suppliers' ? r.contact_name || 'No contact person' : r.address || 'No address'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'phone',
      label: 'Contact',
      render: (r) => (
        <div className="space-y-0.5 text-[13px]" onClick={(e) => e.stopPropagation()}>
          {r.phone && <button type="button" onClick={() => copy(r.phone, 'Phone number')} className="flex items-center gap-1.5 text-ink-2 hover:text-ink"><Phone size={12} /> {r.phone} <Copy size={11} className="opacity-0 transition-opacity group-hover:opacity-60" /></button>}
          {r.email && <a href={`mailto:${r.email}`} className="flex items-center gap-1.5 text-ink-2 hover:text-accent-ink"><Mail size={12} /> {r.email}</a>}
          {!r.phone && !r.email && <span className="text-ink-3">—</span>}
        </div>
      ),
    },
    ...(kind === 'customers'
      ? [
          { key: 'visits', label: 'Visits', align: 'right', render: (r) => <span className="tabular">{r.visits}</span> },
          {
            key: 'lifetime_value',
            label: 'Spent',
            align: 'right',
            render: (r) => (
              <div>
                <p className="font-semibold tabular">{money(r.lifetime_value)}</p>
                {r.outstanding > 0 && <p className="text-[11.5px] text-warning tabular">{money(r.outstanding)} owed</p>}
              </div>
            ),
          },
          { key: 'last_purchase_at', label: 'Last visit', render: (r) => <span className="text-ink-2">{r.last_purchase_at ? formatRelative(r.last_purchase_at) : '—'}</span> },
        ]
      : [
          { key: 'products_supplied', label: 'Products', align: 'right', render: (r) => <span className="tabular">{r.products_supplied}</span> },
          { key: 'open_orders', label: 'Open orders', align: 'right', render: (r) => (r.open_orders ? <Badge tone="blue">{r.open_orders} open</Badge> : <span className="text-ink-3">—</span>) },
          { key: 'ordered_value', label: 'Ordered', align: 'right', render: (r) => <span className="font-semibold tabular">{compactMoney(r.ordered_value)}</span> },
        ]),
    {
      key: 'actions',
      label: '',
      sortable: false,
      align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn-edit btn-icon" onClick={() => setViewing(r)} aria-label="History"><History size={14} /></button>
          <button type="button" className="btn-edit btn-icon" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}><Pencil size={14} /></button>
          <ConfirmButton className="btn-danger btn-icon" icon={Trash2} title={`Delete ${r.name}`} message={kind === 'customers' ? `Delete ${r.name}? Their past sales stay, as walk-ins.` : `Delete ${r.name}? Products and orders keep working without a supplier.`} onConfirm={() => remove(r)} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={config.title} subtitle={config.subtitle} eyebrow="People" icon={config.icon}>
        <ExportMenu table={kind} params={{ search: list.search, sort: list.sort, dir: list.dir }} />
        <Button icon={UserPlus} onClick={() => setEditing({ name: '' })}>Add {config.singular}</Button>
      </PageHeader>

      <ErrorNote error={list.error} onDismiss={() => list.setError(null)} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder={`Search ${config.title.toLowerCase()}…`} />
        {kind === 'customers' && (
          <SegmentedControl
            size="sm"
            value={`${list.sort}:${list.dir}`}
            onChange={(v) => { const [s, d] = v.split(':'); list.setSort(s); list.setDir(d); list.setPage(1); }}
            options={[['name:asc', 'A-Z'], ['lifetime_value:desc', 'Top spenders'], ['last_purchase_at:desc', 'Recent'], ['outstanding:desc', 'Owes most']]}
            ariaLabel="Sort"
          />
        )}
      </div>

      <Table
        columns={columns}
        rows={list.rows}
        loading={list.loading}
        sort={list.sort}
        dir={list.dir}
        onSort={list.toggleSort}
        onRowClick={(r) => setViewing(r)}
        emptyIcon={config.icon}
        emptyTitle={list.search ? 'Nobody matches' : `No ${config.title.toLowerCase()} yet`}
        empty={list.search ? 'Try a different name, phone or email.' : `Add your first ${config.singular}.`}
        emptyAction={!list.search && <Button icon={UserPlus} onClick={() => setEditing({ name: '' })}>Add {config.singular}</Button>}
      />
      <Pagination meta={list.meta} page={list.page} onPage={list.setPage} loading={list.loading} />

      <AnimatePresence>
        {viewing && (kind === 'customers'
          ? <CustomerHistory key="history" customer={viewing} onClose={() => setViewing(null)} onEdit={(c) => { setViewing(null); setEditing(c); }} />
          : <SupplierHistory key="history" supplier={viewing} onClose={() => setViewing(null)} onEdit={(s) => { setViewing(null); setEditing(s); }} />)}
      </AnimatePresence>
      <AnimatePresence>
        {editing && <ContactForm key="edit" initial={editing} singular={config.singular} extraField={config.extraField} onSave={save} onClose={() => setEditing(null)} />}
      </AnimatePresence>
    </div>
  );
}

function ContactForm({ initial, singular, extraField, onSave, onClose }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(form);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={form.id ? `Edit ${singular}` : `Add a ${singular}`} subtitle={form.id ? form.name : 'Only the name is required'} icon={form.id ? Pencil : UserPlus} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote error={error} onDismiss={() => setError(null)} />
        <div className="flex items-center gap-3">
          <motion.div key={form.name?.charAt(0)} initial={{ scale: 0.7, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
            <Avatar name={form.name || '?'} size={48} square={Boolean(extraField)} />
          </motion.div>
          <Field label="Name" className="flex-1"><input className="input-field" value={form.name || ''} onChange={set('name')} autoFocus required /></Field>
        </div>
        {extraField && <Field label={extraField.label}><input className="input-field" value={form[extraField.key] || ''} onChange={set(extraField.key)} /></Field>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Phone"><input className="input-field" type="tel" value={form.phone || ''} onChange={set('phone')} /></Field>
          <Field label="Email"><input className="input-field" type="email" value={form.email || ''} onChange={set('email')} /></Field>
        </div>
        <Field label="Address"><textarea className="input-field" rows="2" value={form.address || ''} onChange={set('address')} /></Field>
        <Field label="Notes"><textarea className="input-field" rows="2" value={form.notes || ''} onChange={set('notes')} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{form.id ? 'Save changes' : `Add ${singular}`}</Button>
        </div>
      </form>
    </Modal>
  );
}

const STATUS_TONE = { paid: 'green', unpaid: 'red', partial: 'amber', refunded: 'slate' };

function CustomerHistory({ customer, onClose, onEdit }) {
  const [data, setData] = useState(null);
  const [changes, setChanges] = useState(null);
  const [tab, setTab] = useState('purchases');
  const [error, setError] = useState(null);
  const { money, compactMoney } = useSettings();

  useEffect(() => {
    api.customers.history(customer.id).then(setData).catch((err) => setError(err.message));
  }, [customer.id]);

  useEffect(() => {
    if (tab === 'changes' && changes === null) api.db.history('customers', customer.id).then(setChanges).catch(() => setChanges([]));
  }, [tab, changes, customer.id]);

  return (
    <Modal title={customer.name} subtitle={[customer.phone, customer.email].filter(Boolean).join(' · ') || 'Customer'} onClose={onClose} size="xl">
      <ErrorNote error={error} />
      {!data && !error && <div className="grid h-60 place-items-center text-ink-3"><Spinner size={22} /></div>}
      {data && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name={customer.name} size={56} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-ink-2">{data.lastPurchaseAt ? `Last visit ${formatRelative(data.lastPurchaseAt)}` : 'No purchases yet'}</p>
              {customer.notes && <p className="mt-0.5 text-[13px] text-ink-3">{customer.notes}</p>}
            </div>
            <Button variant="secondary" size="sm" icon={Pencil} onClick={() => onEdit(data.customer)}>Edit</Button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat icon={ShoppingBag} label="Visits" value={data.saleCount} />
            <Stat icon={TrendingUp} label="Lifetime value" value={money(data.totalSpent)} />
            <Stat icon={Receipt} label="Average sale" value={money(data.averageSale)} />
            <Stat icon={Wallet} label="Owes you" value={money(data.outstanding)} warn={data.outstanding > 0} />
          </div>

          <SegmentedControl value={tab} onChange={setTab} options={[['purchases', 'Purchases'], ['habits', 'Buying habits'], ['changes', 'Change history']]} />

          {tab === 'purchases' && (
            <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
              {data.sales.length === 0 && <li className="py-8 text-center text-[13.5px] text-ink-3">Nothing bought yet.</li>}
              {data.sales.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-3 text-[13.5px]" style={{ borderColor: 'var(--line)' }}>
                  <Receipt size={15} className="text-ink-3" />
                  <span className="font-medium">{s.reference}</span>
                  <span className="text-ink-3">{formatDate(s.created_at)}</span>
                  <span className="ml-auto"><Badge tone={STATUS_TONE[s.payment_status]} dot>{s.payment_status}</Badge></span>
                  <span className="w-24 text-right font-semibold tabular">{money(s.total)}</span>
                </li>
              ))}
            </ul>
          )}

          {tab === 'habits' && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <section>
                <p className="mb-3 text-[13px] font-medium">Spend per month</p>
                <ColumnChart data={data.monthly} valueKey="spent" labelKey="month" height={200} formatLabel={(m) => formatDate(`${m}-01`, { month: 'short' })} formatTitle={(m) => formatDate(`${m}-01`, { month: 'long', year: 'numeric' })} formatValue={(v) => compactMoney(v)} />
              </section>
              <section>
                <p className="mb-3 text-[13px] font-medium">Buys most often</p>
                <HorizontalBars rows={data.favourites} labelKey="name" valueKey="quantity" formatValue={(v) => `${v}`} meta={(r) => money(r.spent)} />
              </section>
            </div>
          )}

          {tab === 'changes' && (changes === null ? <div className="grid h-32 place-items-center"><Spinner /></div> : changes.length === 0 ? <p className="py-8 text-center text-[13.5px] text-ink-3">No recorded changes.</p> : <ol className="space-y-3">{changes.map((c) => <ChangeEntry key={c.id} entry={c} />)}</ol>)}
        </div>
      )}
    </Modal>
  );
}

function SupplierHistory({ supplier, onClose, onEdit }) {
  const [orders, setOrders] = useState(null);
  const [products, setProducts] = useState(null);
  const [changes, setChanges] = useState(null);
  const { money } = useSettings();

  useEffect(() => {
    api.purchaseOrders.list({ supplier_id: supplier.id, pageSize: 50 }).then((d) => setOrders(d.rows)).catch(() => setOrders([]));
    api.products.list({ supplier_id: supplier.id, pageSize: 100 }).then((d) => setProducts(d.rows)).catch(() => setProducts([]));
    api.db.history('suppliers', supplier.id).then(setChanges).catch(() => setChanges([]));
  }, [supplier.id]);

  return (
    <Modal title={supplier.name} subtitle={[supplier.contact_name, supplier.phone, supplier.email].filter(Boolean).join(' · ') || 'Supplier'} onClose={onClose} size="lg">
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar name={supplier.name} size={52} square />
          <p className="flex-1 text-[13.5px] text-ink-2">{supplier.notes || 'No notes.'}</p>
          <Button variant="secondary" size="sm" icon={Pencil} onClick={() => onEdit(supplier)}>Edit</Button>
        </div>
        <section>
          <p className="mb-2 text-[13px] font-medium">Products supplied</p>
          {products === null ? <Spinner /> : products.length === 0 ? <p className="text-[13.5px] text-ink-3">None linked yet.</p> : (
            <div className="flex flex-wrap gap-1.5">{products.map((p) => <Badge key={p.id} tone={p.stock_quantity <= 0 ? 'red' : p.reorder_level > 0 && p.stock_quantity <= p.reorder_level ? 'amber' : 'slate'}>{p.name}</Badge>)}</div>
          )}
        </section>
        <section>
          <p className="mb-2 text-[13px] font-medium">Orders</p>
          {orders === null ? <Spinner /> : orders.length === 0 ? <p className="text-[13.5px] text-ink-3">No orders yet.</p> : (
            <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
              {orders.map((o) => (
                <li key={o.id} className="flex items-center gap-3 py-2.5 text-[13.5px]" style={{ borderColor: 'var(--line)' }}>
                  <span className="font-medium">{o.reference}</span>
                  <span className="text-ink-3">{formatDate(o.created_at)}</span>
                  <Badge tone={{ received: 'green', partial: 'amber', ordered: 'blue', cancelled: 'red', draft: 'slate' }[o.status]}>{o.status}</Badge>
                  <span className="ml-auto font-semibold tabular">{money(o.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {changes && changes.length > 0 && (
          <section>
            <p className="mb-2 text-[13px] font-medium">Change history</p>
            <ol className="space-y-3">{changes.slice(0, 10).map((c) => <ChangeEntry key={c.id} entry={c} />)}</ol>
          </section>
        )}
      </div>
    </Modal>
  );
}

function Stat({ icon: Icon, label, value, warn }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--wash)' }}>
      <p className="flex items-center gap-1.5 text-[12.5px] text-ink-2"><Icon size={13} /> {label}</p>
      <p className={`mt-1 truncate text-[20px] font-semibold tracking-[-0.025em] ${warn ? 'text-warning' : ''}`}>{value}</p>
    </div>
  );
}
