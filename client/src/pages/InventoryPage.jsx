import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useList } from '../hooks/useList';
import {
  PageHeader, ErrorNote, Table, Modal, Field, Badge, Money,
  ConfirmButton, ExportButtons, SearchInput, Select, Pagination,
} from '../components/ui';
import ProductDetail from '../components/ProductDetail';
import AskBar from '../components/AskBar';
import { useAskOutcome } from '../hooks/useAskOutcome';

const BLANK = {
  name: '', sku: '', category: '', unit: 'unit',
  cost_price: '', sale_price: '', stock_quantity: '', reorder_level: '', description: '',
};

const STOCK_FILTERS = [
  ['in', 'In stock'],
  ['low', 'Running low'],
  ['out', 'Out of stock'],
];

function stockTone(product) {
  if (product.stock_quantity <= 0) return { tone: 'red', label: 'Out of stock' };
  if (product.reorder_level > 0 && product.stock_quantity <= product.reorder_level) {
    return { tone: 'amber', label: 'Low' };
  }
  return { tone: 'green', label: 'In stock' };
}

export default function InventoryPage() {
  const [stock, setStock] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState(null);
  const [editing, setEditing] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [importing, setImporting] = useState(false);
  const [viewing, setViewing] = useState(null);

  const fetcher = useCallback((params) => api.products.list(params), []);
  const list = useList(fetcher, { initialSort: 'name', filters: { stock, category } });

  const refreshAside = useCallback(async () => {
    const [sum, cats] = await Promise.all([api.products.summary(), api.products.categories()]);
    setSummary(sum);
    setCategories(cats);
  }, []);

  useEffect(() => {
    refreshAside().catch(() => {});
  }, [refreshAside, list.meta.total]);

  async function afterChange() {
    await Promise.all([list.reload(), refreshAside()]);
  }

  // This page has a real category control, so a filter on that column drives
  // the dropdown rather than falling back to a text search.
  const handleAsk = useAskOutcome(list, {
    onChanged: afterChange,
    filterHandlers: { category: (value) => setCategory(String(value)) },
  });

  async function save(form) {
    try {
      if (form.id) await api.products.update(form.id, form);
      else await api.products.create(form);
      setEditing(null);
      await afterChange();
    } catch (err) {
      list.setError(err.message);
      throw err;
    }
  }

  async function remove(id) {
    try {
      await api.products.remove(id);
      await afterChange();
    } catch (err) {
      list.setError(err.message);
    }
  }

  const columns = [
    { key: 'name', label: 'Product', render: (p) => (
      <button type="button" className="text-left" onClick={() => setViewing(p.id)}>
        <div className="font-medium link hover:underline">{p.name}</div>
        {p.sku && <div className="text-xs subtle">{p.sku}</div>}
      </button>
    ) },
    { key: 'category', label: 'Category', render: (p) => p.category || '—' },
    { key: 'supplier_name', label: 'Supplier', render: (p) => p.supplier_name || '—' },
    { key: 'stock_quantity', label: 'In stock', align: 'right', render: (p) => {
      const { tone, label } = stockTone(p);
      return (
        <div className="flex items-center justify-end gap-2">
          <span className="font-medium">{p.stock_quantity}</span>
          <Badge tone={tone}>{label}</Badge>
        </div>
      );
    } },
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
        <ExportButtons table="products" params={{ search: list.search, sort: list.sort, dir: list.dir }} />
        <button className="btn-secondary" onClick={() => setImporting(true)}>Import from file</button>
        <button className="btn-primary" onClick={() => setEditing({ ...BLANK })}>Add product</button>
      </PageHeader>

      <ErrorNote error={list.error} onDismiss={() => list.setError(null)} />

      <AskBar table="products" onView={handleAsk} />

      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Products" value={summary.total} onClick={() => setStock('')} active={!stock} />
          <Stat label="Low stock" value={summary.lowStock} tone="amber"
                onClick={() => setStock('low')} active={stock === 'low'} />
          <Stat label="Out of stock" value={summary.outOfStock} tone="red"
                onClick={() => setStock('out')} active={stock === 'out'} />
          <Stat label="Stock value" value={Number(summary.stockValue).toFixed(2)} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name, code, category…" />
        <Select value={category} onChange={setCategory} options={categories} placeholder="All categories" />
        <Select value={stock} onChange={setStock} options={STOCK_FILTERS} placeholder="Any stock level" />
        {(stock || category || list.search) && (
          <button className="btn-secondary" onClick={() => {
            setStock('');
            setCategory('');
            list.setSearch('');
          }}>
            Clear filters
          </button>
        )}
        {list.loading && <span className="text-sm subtle">Loading…</span>}
      </div>

      <Table
        columns={columns}
        rows={list.rows}
        sort={list.sort}
        dir={list.dir}
        onSort={list.toggleSort}
        empty={list.search || stock || category ? 'No products match that.' : 'No products yet. Add one, or import a spreadsheet.'}
      />
      <Pagination meta={list.meta} page={list.page} onPage={list.setPage} loading={list.loading} />

      {editing && <ProductForm initial={editing} onSave={save} onClose={() => setEditing(null)} />}
      {adjusting && (
        <StockForm
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={async () => {
            setAdjusting(null);
            await afterChange();
          }}
          onError={list.setError}
        />
      )}
      {viewing && (
        <ProductDetail
          productId={viewing}
          onClose={() => setViewing(null)}
          onEdit={(product) => {
            setViewing(null);
            setEditing(product);
          }}
        />
      )}
      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onDone={async () => {
            setImporting(false);
            await afterChange();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone, onClick, active }) {
  const toneClass = tone === 'amber' ? 'text-warning' : tone === 'red' ? 'text-danger' : '';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`rounded-lg border p-4 text-left transition-colors ${
        active ? 'border-token-strong bg-surface' : 'border-token bg-surface hover:border-token-strong'
      } ${onClick ? '' : 'cursor-default'}`}
    >
      <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
      <p className="text-sm muted">{label}</p>
    </button>
  );
}

function ImportModal({ onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  async function choose(selected) {
    if (!selected) return;
    setFile(selected);
    setPreview(null);
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', selected);
      setPreview(await api.products.importPreview(form));
    } catch (err) {
      setError(err.message);
      setFile(null);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      setResult(await api.products.importCommit(form));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Import products from a spreadsheet" onClose={onClose} wide>
      <ErrorNote error={error} onDismiss={() => setError(null)} />

      {result ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-success bg-success-soft p-4 text-success">
            <p className="font-semibold">Import finished</p>
            <p className="mt-1 text-sm">
              {result.created} added, {result.updated} updated
              {result.skipped ? `, ${result.skipped} skipped` : ''}.
            </p>
          </div>
          {result.problems?.length > 0 && (
            <div className="rounded-lg border border-warning bg-warning-soft p-4 text-sm text-warning">
              <p className="font-semibold">Rows that were skipped</p>
              <ul className="mt-2 space-y-1">
                {result.problems.map((p) => (
                  <li key={p.line}>Line {p.line}: {p.message}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <button className="btn-primary" onClick={onDone}>Done</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm muted">
            Export your spreadsheet as a <strong>.csv</strong> file, then choose it here.
            Column headings are matched automatically — "Price", "Rate" and "MRP" all work.
            Products with a code you already use will be updated rather than duplicated.
          </p>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => choose(e.target.files?.[0])}
          />
          <button className="btn-secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy && !preview ? 'Reading…' : file ? `Chosen: ${file.name}` : 'Choose a CSV file'}
          </button>

          {preview && (
            <div className="space-y-3">
              <div className="rounded-lg border border-token p-4 text-sm">
                <p className="font-medium">
                  Found {preview.readyCount} product{preview.readyCount === 1 ? '' : 's'}
                  {preview.problemCount > 0 && ` · ${preview.problemCount} row(s) will be skipped`}
                </p>
                <p className="mt-2 muted">
                  Matched columns:{' '}
                  {Object.entries(preview.detectedColumns)
                    .map(([field, heading]) => `${heading} → ${field.replace(/_/g, ' ')}`)
                    .join(', ')}
                </p>
                {preview.ignoredColumns.length > 0 && (
                  <p className="mt-1 subtle">
                    Ignored: {preview.ignoredColumns.join(', ')}
                  </p>
                )}
              </div>

              {preview.sample.length > 0 && (
                <Table
                  columns={[
                    { key: 'name', label: 'Name' },
                    { key: 'sku', label: 'Code' },
                    { key: 'sale_price', label: 'Price', align: 'right' },
                    { key: 'stock_quantity', label: 'Stock', align: 'right' },
                  ]}
                  rows={preview.sample}
                  empty="Nothing to preview."
                />
              )}

              {preview.problems.length > 0 && (
                <div className="rounded-lg border border-warning bg-warning-soft p-4 text-sm text-warning">
                  <p className="font-semibold">These rows will be skipped</p>
                  <ul className="mt-2 space-y-1">
                    {preview.problems.map((p) => (
                      <li key={p.line}>Line {p.line}: {p.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button
              className="btn-primary"
              onClick={commit}
              disabled={busy || !preview || preview.readyCount === 0}
            >
              {busy ? 'Importing…' : preview ? `Import ${preview.readyCount} products` : 'Import'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ProductForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial);
  const [suppliers, setSuppliers] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  useEffect(() => {
    api.suppliers.list({ pageSize: 200 }).then((d) => setSuppliers(d.rows)).catch(() => {});
  }, []);

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
        <Field label="Supplier">
          <select className="input-field" value={form.supplier_id || ''} onChange={set('supplier_id')}>
            <option value="">— None —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
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
        <p className="text-sm muted">
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
          <p className={`text-sm ${result < 0 ? 'text-danger' : 'muted'}`}>
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
