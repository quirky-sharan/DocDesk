import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Ban, CalendarClock, ClipboardList, Minus, PackageCheck, Plus, Sparkles, Trash2, Truck, X } from 'lucide-react';
import { api } from '../api/client';
import { useList } from '../hooks/useList';
import { useAssistantView } from '../assistant/useAssistantView';
import { useSettings } from '../lib/settings';
import { useShell } from '../components/shell/ShellProvider';
import {
  Avatar, Badge, Button, ConfirmButton, ErrorNote, ExportMenu, Field, Modal, Notice, PageHeader, Pagination,
  SearchInput, SegmentedControl, Spinner, Table, useToast,
} from '../components/ui';
import { StatTile } from '../components/charts';
import { RevealGroup, RevealItem } from '../components/motion/Reveal';
import ProductPicker from '../components/sales/ProductPicker';
import { formatDate, parseDate } from '../lib/format';
import { cn } from '../lib/cn';

const STATUS_TONE = { draft: 'slate', ordered: 'blue', partial: 'amber', received: 'green', cancelled: 'red' };
const STATUS_LABEL = { draft: 'Draft', ordered: 'Ordered', partial: 'Part arrived', received: 'Received', cancelled: 'Cancelled' };

function daysUntil(date) {
  const d = parseDate(date);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86_400_000);
}

export default function PurchaseOrdersPage() {
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState(null);
  const [status, setStatus] = useState('');
  const [restock, setRestock] = useState(null);
  const [lowCount, setLowCount] = useState(0);
  const [kpis, setKpis] = useState(null);
  const { money, compactMoney } = useSettings();
  const shell = useShell();
  const toast = useToast();

  const fetcher = useCallback((p) => api.purchaseOrders.list(p), []);
  const list = useList(fetcher, { initialSort: 'created_at', initialDir: 'desc', filters: { status } });
  useAssistantView('purchase_orders', list, { status: setStatus }, { defaultSort: 'created_at', defaultDir: 'desc' });

  const loadAside = useCallback(async () => {
    const [suggestion, open, partial] = await Promise.all([
      api.products.restockSuggestion(),
      api.purchaseOrders.list({ status: 'ordered', pageSize: 200 }),
      api.purchaseOrders.list({ status: 'partial', pageSize: 200 }),
    ]);
    setLowCount(suggestion.count);
    const openOrders = [...open.rows, ...partial.rows];
    setKpis({
      open: openOrders.length,
      value: openOrders.reduce((s, o) => s + Number(o.total), 0),
      dueSoon: openOrders.filter((o) => { const d = daysUntil(o.expected_date); return d !== null && d <= 7; }).length,
      overdue: openOrders.filter((o) => { const d = daysUntil(o.expected_date); return d !== null && d < 0; }).length,
    });
  }, []);

  useEffect(() => {
    loadAside().catch(() => {});
  }, [loadAside]);

  const openRestock = useCallback(async () => {
    try {
      setRestock(await api.products.restockSuggestion());
    } catch (err) {
      list.setError(err.message);
    }
  }, [list]);

  useEffect(() => {
    if (params.get('new')) setCreating(true);
    if (params.get('restock')) openRestock();
    if (params.get('new') || params.get('restock')) setParams({}, { replace: true });
  }, [params, setParams, openRestock]);

  async function refresh() {
    await Promise.all([list.reload(), loadAside()]);
    shell.refreshCounts();
  }

  async function remove(order) {
    try {
      await api.purchaseOrders.remove(order.id);
      toast.success('Order deleted', { description: order.reference });
      await refresh();
    } catch (err) {
      list.setError(err.message);
    }
  }

  async function cancel(order) {
    try {
      await api.purchaseOrders.update(order.id, { status: 'cancelled' });
      toast.info('Order cancelled', { description: order.reference });
      await refresh();
    } catch (err) {
      list.setError(err.message);
    }
  }

  const columns = [
    {
      key: 'reference',
      label: 'Order',
      render: (o) => (
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-[12px]" style={{ background: 'var(--accent-soft)' }}><Truck size={16} className="text-accent-ink" /></span>
          <div>
            <p className="font-medium">{o.reference}</p>
            <p className="text-[12px] text-ink-3">{o.line_count} item{o.line_count === 1 ? '' : 's'} · {formatDate(o.created_at)}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'supplier_name',
      label: 'Supplier',
      render: (o) => (o.supplier_name ? <span className="flex items-center gap-2"><Avatar name={o.supplier_name} size={26} square />{o.supplier_name}</span> : <span className="text-ink-3">—</span>),
    },
    { key: 'status', label: 'Status', render: (o) => <Badge tone={STATUS_TONE[o.status]} icon>{STATUS_LABEL[o.status]}</Badge> },
    {
      key: 'units_received',
      label: 'Arrived',
      render: (o) => {
        const pct = o.units_ordered ? Math.min(Number(o.units_received) / Number(o.units_ordered), 1) : 0;
        return (
          <div className="w-32">
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--chart-track)' }}>
              <motion.div className="h-full rounded-full" style={{ background: pct >= 1 ? 'var(--status-good)' : 'var(--series-1)' }} initial={{ width: 0 }} animate={{ width: `${pct * 100}%` }} transition={{ type: 'spring', stiffness: 90, damping: 18 }} />
            </div>
            <p className="mt-1 text-[11.5px] text-ink-3 tabular">{Number(o.units_received)} of {Number(o.units_ordered)}</p>
          </div>
        );
      },
    },
    {
      key: 'expected_date',
      label: 'Expected',
      render: (o) => {
        if (!o.expected_date) return <span className="text-ink-3">—</span>;
        const days = daysUntil(o.expected_date);
        const open = ['ordered', 'partial'].includes(o.status);
        return (
          <div>
            <p>{formatDate(o.expected_date, { day: 'numeric', month: 'short' })}</p>
            {open && days !== null && <p className={cn('text-[11.5px]', days < 0 ? 'text-danger' : days <= 2 ? 'text-warning' : 'text-ink-3')}>{days < 0 ? `${-days}d late` : days === 0 ? 'today' : `in ${days}d`}</p>}
          </div>
        );
      },
    },
    { key: 'total', label: 'Cost', align: 'right', render: (o) => <span className="font-semibold tabular">{money(o.total)}</span> },
    {
      key: 'actions',
      label: '',
      sortable: false,
      align: 'right',
      render: (o) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          {['ordered', 'partial', 'draft'].includes(o.status) && <button type="button" className="btn-edit" onClick={() => setReceiving(o.id)}><PackageCheck size={14} /> Receive</button>}
          {['ordered', 'draft'].includes(o.status) && Number(o.units_received) === 0 && (
            <ConfirmButton className="btn-edit btn-icon" icon={Ban} title="Cancel order" confirmLabel="Yes, cancel it" message={`Cancel ${o.reference}? It stays on record as cancelled.`} onConfirm={() => cancel(o)} />
          )}
          {Number(o.units_received) === 0 && <ConfirmButton className="btn-danger btn-icon" icon={Trash2} title={`Delete ${o.reference}`} message={`Delete ${o.reference}?`} onConfirm={() => remove(o)} />}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Incoming stock" subtitle="What you've ordered, what's arrived, and what's late." eyebrow="Operations" icon={Truck}>
        <ExportMenu table="purchase_orders" params={{ search: list.search, sort: list.sort, dir: list.dir, status }} />
        {lowCount > 0 && <Button variant="secondary" icon={Sparkles} onClick={openRestock}>Restock {lowCount} item{lowCount === 1 ? '' : 's'}</Button>}
        <Button icon={Plus} onClick={() => setCreating(true)}>New order</Button>
      </PageHeader>

      <ErrorNote error={list.error} onDismiss={() => list.setError(null)} />

      {kpis && (
        <RevealGroup className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4" gap={0.06}>
          <RevealItem><StatTile label="Open orders" icon={ClipboardList} value={kpis.open} onClick={() => setStatus(status === 'ordered' ? '' : 'ordered')} active={status === 'ordered'} /></RevealItem>
          <RevealItem><StatTile label="Value on order" icon={Truck} value={kpis.value} format={(n) => compactMoney(n)} /></RevealItem>
          <RevealItem><StatTile label="Due within a week" icon={CalendarClock} value={kpis.dueSoon} /></RevealItem>
          <RevealItem><StatTile label="Late" icon={CalendarClock} value={kpis.overdue} tone={kpis.overdue ? 'red' : undefined} footnote="past their expected date" /></RevealItem>
        </RevealGroup>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search orders or supplier…" />
        <SegmentedControl size="sm" value={status} onChange={setStatus} options={[['', 'Any'], ['draft', 'Draft'], ['ordered', 'Ordered'], ['partial', 'Part arrived'], ['received', 'Received'], ['cancelled', 'Cancelled']]} ariaLabel="Status" />
      </div>

      <Table
        columns={columns}
        rows={list.rows}
        loading={list.loading}
        sort={list.sort}
        dir={list.dir}
        onSort={list.toggleSort}
        onRowClick={(o) => ['ordered', 'partial', 'draft'].includes(o.status) && setReceiving(o.id)}
        emptyIcon={Truck}
        emptyTitle={list.search || status ? 'No orders match' : 'No orders yet'}
        empty={list.search || status ? 'Try another filter.' : 'Order stock from a supplier - it goes into stock when you mark it received.'}
        emptyAction={!list.search && !status && <Button icon={Plus} onClick={() => setCreating(true)}>New order</Button>}
      />
      <Pagination meta={list.meta} page={list.page} onPage={list.setPage} loading={list.loading} />

      <AnimatePresence>
        {creating && <NewOrder key="new" onClose={() => setCreating(false)} onDone={async (order) => { setCreating(false); toast.success(`Order ${order.reference} created`, { description: money(order.total) }); await refresh(); }} />}
      </AnimatePresence>
      <AnimatePresence>
        {restock && (
          <RestockModal key="restock" suggestion={restock} onClose={() => setRestock(null)} onDone={async (order) => { setRestock(null); toast.success(`Order ${order.reference} created`, { description: order.supplier_name || 'No supplier' }); await refresh(); }} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {receiving && <ReceiveOrder key="receive" orderId={receiving} onClose={() => setReceiving(null)} onDone={async (order) => { setReceiving(null); toast.success('Delivery booked in', { description: `${order.reference} is ${STATUS_LABEL[order.status].toLowerCase()}` }); await refresh(); }} />}
      </AnimatePresence>
    </div>
  );
}

let seq = 0;
const blankLine = () => ({ key: ++seq, product_id: '', description: '', quantity: 1, unit_cost: '' });

function NewOrder({ onClose, onDone }) {
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [lines, setLines] = useState([blankLine()]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { money } = useSettings();

  useEffect(() => {
    Promise.all([api.products.list({ pageSize: 200, sort: 'name' }), api.suppliers.list({ pageSize: 200, sort: 'name' })])
      .then(([p, s]) => { setProducts(p.rows); setSuppliers(s.rows); })
      .catch((err) => setError(err.message));
  }, []);

  const update = (key, patch) => setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const valid = lines.filter((l) => l.product_id || l.description);
  const total = valid.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);
  // Suggest this supplier's own products first.
  const ordered = supplierId ? [...products].sort((a, b) => (String(b.supplier_id) === supplierId) - (String(a.supplier_id) === supplierId)) : products;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const order = await api.purchaseOrders.create({
        supplier_id: supplierId || null,
        expected_date: expectedDate || null,
        status: 'ordered',
        items: valid.map((l) => ({ product_id: l.product_id || null, description: l.description, quantity: l.quantity, unit_cost: l.unit_cost === '' ? undefined : l.unit_cost })),
      });
      await onDone(order);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New order" subtitle="Stock goes up when you receive it, not before" icon={Truck} onClose={onClose} size="lg">
      <form onSubmit={submit} className="space-y-5">
        <ErrorNote error={error} onDismiss={() => setError(null)} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Supplier">
            <select className="input-field" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Not specified</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Expected by"><input className="input-field" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></Field>
        </div>
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {lines.map((line) => (
              <motion.li key={line.key} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -16 }} className="grid grid-cols-12 items-center gap-2 rounded-2xl p-3" style={{ background: 'var(--wash)' }}>
                <div className="col-span-12 sm:col-span-6">
                  <ProductPicker products={ordered} value={line.product_id} description={line.description} disableOutOfStock={false} onPick={(p) => update(line.key, { product_id: p.id, description: p.name, unit_cost: p.cost_price })} onDescribe={(text) => update(line.key, { product_id: '', description: text })} />
                </div>
                <div className="col-span-5 flex items-center sm:col-span-3">
                  <button type="button" className="btn-secondary btn-icon btn-sm" onClick={() => update(line.key, { quantity: Math.max(Number(line.quantity || 0) - 1, 1) })} aria-label="Less"><Minus size={13} /></button>
                  <input className="input-field mx-1 min-h-[34px] px-1 text-center tabular" type="number" min="0.001" step="any" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} aria-label="Quantity" />
                  <button type="button" className="btn-secondary btn-icon btn-sm" onClick={() => update(line.key, { quantity: Number(line.quantity || 0) + 1 })} aria-label="More"><Plus size={13} /></button>
                </div>
                <div className="col-span-5 sm:col-span-2"><input className="input-field min-h-[34px] text-right tabular" type="number" min="0" step="0.01" placeholder="Cost" value={line.unit_cost} onChange={(e) => update(line.key, { unit_cost: e.target.value })} aria-label="Unit cost" /></div>
                <div className="col-span-2 flex justify-end sm:col-span-1"><button type="button" className="btn-ghost btn-icon btn-sm" disabled={lines.length === 1} onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))} aria-label="Remove"><X size={15} /></button></div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => setLines((c) => [...c, blankLine()])}>Add another item</Button>
        <div className="flex items-center justify-between rounded-2xl px-5 py-4" style={{ background: 'var(--wash)' }}>
          <span className="text-[13px] text-ink-2">Order total</span>
          <span className="text-[24px] font-semibold tracking-[-0.03em] tabular">{money(total)}</span>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={total <= 0}>Create order</Button>
        </div>
      </form>
    </Modal>
  );
}

function ReceiveOrder({ orderId, onClose, onDone }) {
  const [order, setOrder] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.purchaseOrders.get(orderId).then((data) => {
      setOrder(data);
      // The common case is everything outstanding arriving; reduce any line for a part delivery.
      setQuantities(Object.fromEntries(data.items.map((i) => [i.id, Math.max(0, Number(i.quantity) - Number(i.quantity_received))])));
    }).catch((err) => setError(err.message));
  }, [orderId]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const items = Object.entries(quantities).filter(([, q]) => Number(q) > 0).map(([id, quantity]) => ({ id: Number(id), quantity: Number(quantity) }));
      if (!items.length) throw new Error('Enter how many of at least one item arrived.');
      await onDone(await api.purchaseOrders.receive(orderId, items));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Receive delivery" subtitle={order ? `${order.reference}${order.supplier_name ? ` from ${order.supplier_name}` : ''}` : null} icon={PackageCheck} onClose={onClose} size="lg">
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      {!order && !error && <div className="grid h-40 place-items-center text-ink-3"><Spinner /></div>}
      {order && (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-[13.5px] text-ink-2">Enter what actually arrived. Stock goes up by exactly this, and each line is recorded in its product's stock ledger.</p>
          <ul className="space-y-2">
            {order.items.map((item) => {
              const outstanding = Number(item.quantity) - Number(item.quantity_received);
              const value = Number(quantities[item.id] ?? 0);
              const pct = Math.min((Number(item.quantity_received) + value) / Number(item.quantity), 1);
              return (
                <li key={item.id} className="rounded-2xl p-4" style={{ background: 'var(--wash)' }}>
                  <div className="flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium">{item.description}</p>
                      <p className="text-[12px] text-ink-3 tabular">{Number(item.quantity_received)} of {Number(item.quantity)} received{outstanding > 0 ? ` · ${outstanding} to come` : ' · complete'}</p>
                    </div>
                    <div className="flex items-center">
                      <button type="button" className="btn-secondary btn-icon btn-sm" disabled={outstanding <= 0} onClick={() => setQuantities({ ...quantities, [item.id]: Math.max(value - 1, 0) })} aria-label="Less"><Minus size={13} /></button>
                      <input className="input-field mx-1 w-20 min-h-[34px] text-center tabular" type="number" min="0" max={outstanding} step="any" value={quantities[item.id] ?? 0} disabled={outstanding <= 0} onChange={(e) => setQuantities({ ...quantities, [item.id]: e.target.value })} />
                      <button type="button" className="btn-secondary btn-icon btn-sm" disabled={outstanding <= 0 || value >= outstanding} onClick={() => setQuantities({ ...quantities, [item.id]: Math.min(value + 1, outstanding) })} aria-label="More"><Plus size={13} /></button>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--chart-track)' }}>
                    <motion.div className="h-full rounded-full" style={{ background: pct >= 1 ? 'var(--status-good)' : 'var(--series-1)' }} animate={{ width: `${pct * 100}%` }} transition={{ type: 'spring', stiffness: 160, damping: 20 }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" icon={PackageCheck} loading={busy}>Add to stock</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function RestockModal({ suggestion, onClose, onDone }) {
  const [groupIndex, setGroupIndex] = useState(0);
  const [quantities, setQuantities] = useState(() => Object.fromEntries(suggestion.items.map((i) => [i.productId, i.suggestedQuantity])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { money } = useSettings();

  const group = suggestion.bySupplier[groupIndex];
  if (!group) return null;
  const total = group.items.reduce((sum, i) => sum + Number(quantities[i.productId] || 0) * i.unitCost, 0);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const items = group.items.filter((i) => Number(quantities[i.productId]) > 0).map((i) => ({ product_id: i.productId, quantity: Number(quantities[i.productId]), unit_cost: i.unitCost }));
      if (!items.length) throw new Error('Set a quantity for at least one item.');
      await onDone(await api.purchaseOrders.create({ supplier_id: group.supplierId || null, status: 'ordered', items }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Restock what's running low" subtitle={`${suggestion.count} item${suggestion.count === 1 ? ' is' : 's are'} at or below the reorder level`} icon={Sparkles} onClose={onClose} size="lg">
      <div className="space-y-4">
        <ErrorNote error={error} onDismiss={() => setError(null)} />
        <Notice tone="info">One order per supplier. Quantities top each item back up to twice its reorder level - change anything you like.</Notice>
        {suggestion.bySupplier.length > 1 && (
          <SegmentedControl size="sm" value={groupIndex} onChange={setGroupIndex} options={suggestion.bySupplier.map((g, i) => [i, g.supplierName || 'No supplier', null, g.items.length])} ariaLabel="Supplier" />
        )}
        <ul className="space-y-2">
          {group.items.map((item) => (
            <li key={item.productId} className="flex items-center gap-4 rounded-2xl px-4 py-3" style={{ background: 'var(--wash)' }}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{item.name}</p>
                <p className="text-[12px] text-ink-3 tabular">{item.stockQuantity} left · reorder at {item.reorderLevel} · {money(item.unitCost)} each</p>
              </div>
              <input className="input-field w-24 text-center tabular" type="number" min="0" step="1" value={quantities[item.productId] ?? 0} onChange={(e) => setQuantities({ ...quantities, [item.productId]: e.target.value })} />
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between rounded-2xl px-5 py-4" style={{ background: 'rgb(var(--c-surface))', boxShadow: '0 0 0 1px var(--line)' }}>
          <span className="text-[13px] text-ink-2">Order total</span>
          <span className="text-[22px] font-semibold tabular">{money(total)}</span>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={create} loading={busy}>Order from {group.supplierName || 'no supplier'}</Button>
        </div>
      </div>
    </Modal>
  );
}
