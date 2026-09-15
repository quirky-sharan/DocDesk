import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useList } from '../hooks/useList';
import {
  PageHeader, ErrorNote, Table, Modal, Field, Badge, Money,
  ConfirmButton, ExportButtons, SearchInput, Select, Pagination,
} from '../components/ui';

const STATUS_TONE = {
  draft: 'slate', ordered: 'blue', partial: 'amber', received: 'green', cancelled: 'red',
};

export default function PurchaseOrdersPage() {
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState(null);
  const [status, setStatus] = useState('');

  const fetcher = useCallback((params) => api.purchaseOrders.list(params), []);
  const list = useList(fetcher, {
    initialSort: 'created_at',
    initialDir: 'desc',
    filters: { status },
  });

  async function remove(id) {
    try {
      await api.purchaseOrders.remove(id);
      await list.reload();
    } catch (err) {
      list.setError(err.message);
    }
  }

  const columns = [
    { key: 'reference', label: 'Order', render: (o) => <span className="font-medium">{o.reference}</span> },
    { key: 'supplier_name', label: 'Supplier', render: (o) => o.supplier_name || '—' },
    { key: 'status', label: 'Status', render: (o) => (
      <Badge tone={STATUS_TONE[o.status] || 'slate'}>{o.status}</Badge>
    ) },
    { key: 'expected_date', label: 'Expected', render: (o) => o.expected_date || '—' },
    { key: 'total', label: 'Cost', align: 'right', render: (o) => <Money value={o.total} /> },
    { key: 'actions', label: '', sortable: false, align: 'right', render: (o) => (
      <div className="flex justify-end gap-2">
        {o.status !== 'received' && o.status !== 'cancelled' && (
          <button className="btn-edit" onClick={() => setReceiving(o.id)}>Receive</button>
        )}
        <ConfirmButton message={`Delete ${o.reference}?`} onConfirm={() => remove(o.id)}>Delete</ConfirmButton>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Incoming stock" subtitle="What you've ordered and what's arrived.">
        <ExportButtons table="purchase_orders" params={{ search: list.search, sort: list.sort, dir: list.dir }} />
        <button className="btn-primary" onClick={() => setCreating(true)}>New order</button>
      </PageHeader>

      <ErrorNote error={list.error} onDismiss={() => list.setError(null)} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search orders or supplier…" />
        <Select
          value={status}
          onChange={setStatus}
          options={[['draft', 'Draft'], ['ordered', 'Ordered'], ['partial', 'Part arrived'],
                    ['received', 'Received'], ['cancelled', 'Cancelled']]}
          placeholder="Any status"
        />
        {(status || list.search) && (
          <button className="btn-secondary" onClick={() => { setStatus(''); list.setSearch(''); }}>
            Clear filters
          </button>
        )}
        {list.loading && <span className="text-sm text-slate-400">Loading…</span>}
      </div>

      <Table
        columns={columns}
        rows={list.rows}
        sort={list.sort}
        dir={list.dir}
        onSort={list.toggleSort}
        empty={list.search || status ? 'No orders match that.' : 'No orders yet.'}
      />
      <Pagination meta={list.meta} page={list.page} onPage={list.setPage} loading={list.loading} />

      {creating && (
        <NewOrder onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await list.reload(); }} />
      )}
      {receiving && (
        <ReceiveOrder
          orderId={receiving}
          onClose={() => setReceiving(null)}
          onDone={async () => { setReceiving(null); await list.reload(); }}
        />
      )}
    </div>
  );
}

function NewOrder({ onClose, onDone }) {
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [lines, setLines] = useState([{ product_id: '', description: '', quantity: 1, unit_cost: '' }]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.products.list({ pageSize: 200 }), api.suppliers.list({ pageSize: 200 })])
      .then(([p, s]) => {
        setProducts(p.rows);
        setSuppliers(s.rows);
      })
      .catch((err) => setError(err.message));
  }, []);

  function updateLine(index, patch) {
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function pickProduct(index, productId) {
    const product = products.find((p) => String(p.id) === String(productId));
    updateLine(index, {
      product_id: productId,
      unit_cost: product ? product.cost_price : '',
      description: product ? product.name : '',
    });
  }

  const total = lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.purchaseOrders.create({
        supplier_id: supplierId || null,
        expected_date: expectedDate || null,
        status: 'ordered',
        items: lines
          .filter((l) => l.product_id || l.description)
          .map((l) => ({
            product_id: l.product_id || null,
            description: l.description,
            quantity: l.quantity,
            unit_cost: l.unit_cost === '' ? undefined : l.unit_cost,
          })),
      });
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New order" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <ErrorNote error={error} onDismiss={() => setError(null)} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Supplier">
            <select className="input-field" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— Not specified —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Expected date">
            <input className="input-field" type="date" value={expectedDate}
                   onChange={(e) => setExpectedDate(e.target.value)} />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Items</p>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 rounded-lg border border-slate-200 p-3">
                <div className="col-span-12 sm:col-span-5">
                  <select className="input-field" value={line.product_id}
                          onChange={(e) => pickProduct(index, e.target.value)}>
                    <option value="">— Something not in the list —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {!line.product_id && (
                    <input className="input-field mt-2" placeholder="Describe the item"
                           value={line.description}
                           onChange={(e) => updateLine(index, { description: e.target.value })} />
                  )}
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <input className="input-field" type="number" min="0.01" step="any" placeholder="Qty"
                         value={line.quantity}
                         onChange={(e) => updateLine(index, { quantity: e.target.value })} />
                </div>
                <div className="col-span-5 sm:col-span-3">
                  <input className="input-field" type="number" min="0" step="0.01" placeholder="Unit cost"
                         value={line.unit_cost}
                         onChange={(e) => updateLine(index, { unit_cost: e.target.value })} />
                </div>
                <div className="col-span-3 sm:col-span-2 flex items-center justify-end">
                  {lines.length > 1 && (
                    <button type="button" className="btn-danger"
                            onClick={() => setLines(lines.filter((_, i) => i !== index))}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="btn-secondary mt-2"
                  onClick={() => setLines([...lines, { product_id: '', description: '', quantity: 1, unit_cost: '' }])}>
            Add another item
          </button>
        </div>

        <div className="rounded-lg bg-slate-50 p-4 text-right text-lg font-semibold">
          Total cost: {total.toFixed(2)}
        </div>

        <p className="text-sm text-slate-500">
          Ordering doesn't change your stock. Stock goes up when you mark the goods as received.
        </p>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || total <= 0}>
            {busy ? 'Saving…' : 'Create order'}
          </button>
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
    api.purchaseOrders
      .get(orderId)
      .then((data) => {
        setOrder(data);
        // Default to receiving everything still outstanding, which is the
        // common case; the user can reduce any line for a partial delivery.
        const defaults = {};
        for (const item of data.items) {
          defaults[item.id] = Math.max(0, Number(item.quantity) - Number(item.quantity_received));
        }
        setQuantities(defaults);
      })
      .catch((err) => setError(err.message));
  }, [orderId]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const items = Object.entries(quantities)
        .filter(([, quantity]) => Number(quantity) > 0)
        .map(([id, quantity]) => ({ id: Number(id), quantity: Number(quantity) }));
      if (!items.length) throw new Error('Enter how many of at least one item arrived.');
      await api.purchaseOrders.receive(orderId, items);
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Receive delivery" onClose={onClose}>
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      {!order && !error && <p className="text-slate-500">Loading…</p>}
      {order && (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-slate-500">
            Enter how many actually arrived. Leave a line at 0 if it didn't come.
          </p>
          {order.items.map((item) => {
            const outstanding = Number(item.quantity) - Number(item.quantity_received);
            return (
              <div key={item.id} className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3">
                <div>
                  <p className="font-medium">{item.description}</p>
                  <p className="text-xs text-slate-500">
                    {item.quantity_received} of {item.quantity} received · {outstanding} outstanding
                  </p>
                </div>
                <input
                  className="input-field w-24"
                  type="number" min="0" max={outstanding} step="any"
                  value={quantities[item.id] ?? 0}
                  disabled={outstanding <= 0}
                  onChange={(e) => setQuantities({ ...quantities, [item.id]: e.target.value })}
                />
              </div>
            );
          })}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Add to stock'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
