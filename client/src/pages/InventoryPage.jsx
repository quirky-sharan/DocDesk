import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  PageHeader, ErrorNote, Table, Modal, Field, Badge, Money,
  ConfirmButton, ExportButtons, SearchInput,
} from '../components/ui';

const BLANK = {
  name: '', sku: '', category: '', unit: 'unit',
  cost_price: '', sale_price: '', stock_quantity: '', reorder_level: '', description: '',
};

function stockTone(product) {
  if (product.stock_quantity <= 0) return { tone: 'red', label: 'Out of stock' };
  if (product.reorder_level > 0 && product.stock_quantity <= product.reorder_level) {
    return { tone: 'amber', label: 'Low' };
  }
  return { tone: 'green', label: 'In stock' };
}

export default function InventoryPage() {
  const [products, setProducts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [sort, setSort] = useState('name');
  const [dir, setDir] = useState('asc');

  const [editing, setEditing] = useState(null);
  const [adjusting, setAdjusting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        api.products.list({ search, sort, dir, stock: stockFilter }),
        api.products.summary(),
      ]);
      setProducts(list.rows);
      setSummary(sum);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, sort, dir, stockFilter]);

  useEffect(() => {
    // Debounced so typing in the search box doesn't fire a request per keystroke.
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
      if (form.id) await api.products.update(form.id, form);
      else await api.products.create(form);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  async function remove(id) {
    try {
      await api.products.remove(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const columns = [
    { key: 'name', label: 'Product', render: (p) => (
      <div>
        <div className="font-medium">{p.name}</div>
        {p.sku && <div className="text-xs text-slate-400">{p.sku}</div>}
      </div>
    ) },
    { key: 'category', label: 'Category', render: (p) => p.category || '—' },
    { key: 'stock_quantity', label: 'In stock', align: 'right', render: (p) => {
      const { tone, label } = stockTone(p);
      return (
        <div className="flex items-center justify-end gap-2">
          <span className="font-medium">{p.stock_quantity}</span>
          <Badge tone={tone}>{label}</Badge>
        </div>
      );
    } },
    { key: 'reorder_level', label: 'Reorder at', align: 'right' },
    { key: 'sale_price', label: 'Price', align: 'right', render: (p) => <Money value={p.sale_price} /> },
    { key: 'actions', label: '', sortable: false, align: 'right', render: (p) => (
      <div className="flex justify-end gap-2">
        <button className="btn-edit" onClick={() => setAdjusting(p)}>Stock</button>
        <button className="btn-edit" onClick={() => setEditing(p)}>Edit</button>
        <ConfirmButton
          message={`Delete "${p.name}"? Past receipts will still show it.`}
          onConfirm={() => remove(p.id)}
        >
          Delete
        </ConfirmButton>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Inventory" subtitle="What you have, what's running out, what it's worth.">
        <ExportButtons table="products" params={{ search, sort, dir }} />
        <button className="btn-primary" onClick={() => setEditing({ ...BLANK })}>Add product</button>
      </PageHeader>

      <ErrorNote error={error} onDismiss={() => setError(null)} />

      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Products" value={summary.total} onClick={() => setStockFilter('')} active={!stockFilter} />
          <Stat label="Low stock" value={summary.lowStock} tone="amber"
                onClick={() => setStockFilter('low')} active={stockFilter === 'low'} />
          <Stat label="Out of stock" value={summary.outOfStock} tone="red"
                onClick={() => setStockFilter('out')} active={stockFilter === 'out'} />
          <Stat label="Stock value" value={Number(summary.stockValue).toFixed(2)} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search products…" />
        {stockFilter && (
          <button className="btn-secondary" onClick={() => setStockFilter('')}>
            Clear filter
          </button>
        )}
        {loading && <span className="text-sm text-slate-400">Loading…</span>}
      </div>

      <Table
        columns={columns}
        rows={products}
        sort={sort}
        dir={dir}
        onSort={toggleSort}
        empty={search || stockFilter ? 'No products match that.' : 'No products yet. Add your first one.'}
      />

      {editing && <ProductForm initial={editing} onSave={save} onClose={() => setEditing(null)} />}
      {adjusting && (
        <StockForm
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={async () => {
            setAdjusting(null);
            await load();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone, onClick, active }) {
  const toneClass = tone === 'amber' ? 'text-amber-600' : tone === 'red' ? 'text-red-600' : '';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`rounded-lg border p-4 text-left transition-colors ${
        active ? 'border-slate-400 bg-white' : 'border-slate-200 bg-white hover:border-slate-300'
      } ${onClick ? '' : 'cursor-default'}`}
    >
      <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
    </button>
  );
}

function ProductForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(form);
    } catch {
      // The page shows the message; keep the form open so nothing is retyped.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={form.id ? 'Edit product' : 'Add product'} onClose={onClose} wide>
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Name">
            <input className="input-field" value={form.name} onChange={set('name')} autoFocus required />
          </Field>
        </div>
        <Field label="SKU / code" hint="Optional, but must be unique">
          <input className="input-field" value={form.sku || ''} onChange={set('sku')} />
        </Field>
        <Field label="Category">
          <input className="input-field" value={form.category || ''} onChange={set('category')} />
        </Field>
        <Field label="Cost price" hint="What you pay">
          <input className="input-field" type="number" step="0.01" min="0" value={form.cost_price ?? ''} onChange={set('cost_price')} />
        </Field>
        <Field label="Sale price" hint="What you charge">
          <input className="input-field" type="number" step="0.01" min="0" value={form.sale_price ?? ''} onChange={set('sale_price')} />
        </Field>
        <Field label="Quantity in stock">
          <input className="input-field" type="number" step="1" value={form.stock_quantity ?? ''} onChange={set('stock_quantity')} />
        </Field>
        <Field label="Reorder level" hint="Warn when stock drops to this">
          <input className="input-field" type="number" step="1" min="0" value={form.reorder_level ?? ''} onChange={set('reorder_level')} />
        </Field>
        <Field label="Unit" hint="box, kg, hour…">
          <input className="input-field" value={form.unit || ''} onChange={set('unit')} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <textarea className="input-field" rows="2" value={form.description || ''} onChange={set('description')} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function StockForm({ product, onClose, onDone, onError }) {
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState('in');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = Number(amount || 0);
  const change = direction === 'in' ? parsed : -parsed;
  const result = product.stock_quantity + change;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.products.adjustStock(product.id, change, reason);
      await onDone();
    } catch (err) {
      onError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Adjust stock — ${product.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-500">
          Currently <strong>{product.stock_quantity}</strong> in stock.
        </p>

        <div className="flex gap-2">
          <button type="button" onClick={() => setDirection('in')}
            className={direction === 'in' ? 'btn-primary flex-1' : 'btn-secondary flex-1'}>
            Add stock
          </button>
          <button type="button" onClick={() => setDirection('out')}
            className={direction === 'out' ? 'btn-primary flex-1' : 'btn-secondary flex-1'}>
            Remove stock
          </button>
        </div>

        <Field label="How many?">
          <input className="input-field" type="number" min="1" step="1" value={amount}
                 onChange={(e) => setAmount(e.target.value)} autoFocus required />
        </Field>

        <Field label="Reason" hint="Optional — delivery, breakage, stock count…">
          <input className="input-field" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        {amount !== '' && (
          <p className={`text-sm ${result < 0 ? 'text-red-600' : 'text-slate-600'}`}>
            {result < 0
              ? `You only have ${product.stock_quantity} — you can't remove ${parsed}.`
              : `New total will be ${result}.`}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || !amount || result < 0}>
            {busy ? 'Saving…' : 'Update stock'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
