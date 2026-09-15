import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Boxes, CircleAlert, CircleX, FileSpreadsheet, LayoutGrid, Package, PackagePlus, Pencil, Rows3, SlidersHorizontal,
  Trash2, Upload, Wallet,
} from 'lucide-react';
import { api } from '../api/client';
import { useList } from '../hooks/useList';
import { useTheme } from '../hooks/useTheme';
import { useSettings } from '../lib/settings';
import {
  Badge, Button, Card, CardHeader, ConfirmButton, ErrorNote, ExportMenu, Field, Modal, PageHeader, Pagination,
  SearchInput, SegmentedControl, Select, Table, useToast,
} from '../components/ui';
import { Meter, StatTile } from '../components/charts';
import { Reveal, RevealGroup, RevealItem } from '../components/motion/Reveal';
import ProductDetail from '../components/ProductDetail';
import Scene3D from '../components/three/Scene3D';
import { useAssistantView } from '../assistant/useAssistantView';
import { useShell } from '../components/shell/ShellProvider';
import { cn } from '../lib/cn';

const loadCity = () => import('../components/three/StockCity3D');

const BLANK = {
  name: '', sku: '', category: '', unit: 'unit',
  cost_price: '', sale_price: '', stock_quantity: '', reorder_level: '', description: '', supplier_id: '',
};

const STOCK_FILTERS = [
  ['', 'All'],
  ['in', 'In stock'],
  ['low', 'Running low', CircleAlert],
  ['out', 'Out of stock', CircleX],
];

function stockState(product) {
  if (product.stock_quantity <= 0) return { tone: 'red', label: 'Out of stock' };
  if (product.reorder_level > 0 && product.stock_quantity <= product.reorder_level) return { tone: 'amber', label: 'Low' };
  return { tone: 'green', label: 'In stock' };
}

export default function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const [stock, setStock] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState(null);
  const [editing, setEditing] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [importing, setImporting] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [cityProducts, setCityProducts] = useState(null);
  const [showCity, setShowCity] = useState(() => {
    try {
      return localStorage.getItem('docdesk.inventory.city') !== '0';
    } catch {
      return true;
    }
  });
  const { isDark } = useTheme();
  const { money, compactMoney } = useSettings();
  const shell = useShell();
  const toast = useToast();

  const fetcher = useCallback((p) => api.products.list(p), []);
  const list = useList(fetcher, { initialSort: 'name', filters: { stock, category } });

  const refreshAside = useCallback(async () => {
    const [sum, cats, all] = await Promise.all([
      api.products.summary(),
      api.products.categories(),
      api.products.list({ pageSize: 200, sort: 'name' }),
    ]);
    setSummary(sum);
    setCategories(cats);
    setCityProducts(all.rows);
  }, []);

  useEffect(() => {
    refreshAside().catch(() => {});
  }, [refreshAside]);

  // Deep links from Spotlight, the dashboard and the assistant.
  useEffect(() => {
    const view = params.get('view');
    if (params.get('new')) setEditing({ ...BLANK });
    if (params.get('import')) setImporting(true);
    if (view) setViewing(Number(view));
    if (params.get('new') || params.get('import') || view) setParams({}, { replace: true });
  }, [params, setParams]);

  async function afterChange() {
    await Promise.all([list.reload(), refreshAside()]);
    shell.refreshCounts();
  }

  useAssistantView('products', list, { category: setCategory, stock: setStock }, {
    defaultSort: 'name',
    onChange: () => refreshAside().catch(() => {}),
  });

  async function save(form) {
    const saved = form.id ? await api.products.update(form.id, form) : await api.products.create(form);
    setEditing(null);
    toast.success(form.id ? 'Product saved' : 'Product added', { description: saved.name });
    await afterChange();
  }

  async function remove(product) {
    try {
      await api.products.remove(product.id);
      toast.success('Product deleted', { description: product.name });
      await afterChange();
    } catch (err) {
      list.setError(err.message);
    }
  }

  function toggleCity() {
    setShowCity((v) => {
      try {
        localStorage.setItem('docdesk.inventory.city', v ? '0' : '1');
      } catch {
        // Remembering is optional.
      }
      return !v;
    });
  }

  const columns = [
    {
      key: 'name',
      label: 'Product',
      render: (p) => (
        <button type="button" className="group/name flex items-center gap-3 text-left" onClick={(e) => { e.stopPropagation(); setViewing(p.id); }}>
          <ProductGlyph product={p} />
          <span className="min-w-0">
            <span className="block truncate font-medium transition-colors group-hover/name:text-accent-ink">{p.name}</span>
            <span className="block truncate text-[12px] text-ink-3">{[p.sku, p.supplier_name].filter(Boolean).join(' · ') || '—'}</span>
          </span>
        </button>
      ),
    },
    { key: 'category', label: 'Category', render: (p) => (p.category ? <Badge>{p.category}</Badge> : <span className="text-ink-3">—</span>) },
    {
      key: 'stock_quantity',
      label: 'Stock',
      align: 'right',
      render: (p) => {
        const state = stockState(p);
        return (
          <div className="flex items-center justify-end gap-3">
            <Meter value={Number(p.stock_quantity)} max={Math.max(Number(p.reorder_level) * 2.5, Number(p.stock_quantity))} marker={Number(p.reorder_level) || undefined} width={56} />
            <span className="w-12 text-right font-semibold tabular">{Number(p.stock_quantity)}</span>
            <span className="w-[92px] text-left"><Badge tone={state.tone} icon>{state.label}</Badge></span>
          </div>
        );
      },
    },
    { key: 'sale_price', label: 'Price', align: 'right', render: (p) => <span className="font-medium tabular">{money(p.sale_price)}</span> },
    {
      key: 'actions',
      label: '',
      sortable: false,
      align: 'right',
      render: (p) => (
        <div className="flex justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn-edit" onClick={() => setAdjusting(p)} title="Adjust stock"><SlidersHorizontal size={14} /> Stock</button>
          <button type="button" className="btn-edit btn-icon" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}><Pencil size={14} /></button>
          <ConfirmButton className="btn-danger btn-icon" icon={Trash2} title={`Delete ${p.name}`} message={`Delete "${p.name}"? Past receipts will still show it.`} onConfirm={() => remove(p)} />
        </div>
      ),
    },
  ];

  const filtered = Boolean(list.search || stock || category);

  return (
    <div>
      <PageHeader title="Inventory" subtitle="What you have, what's running out, and what it's worth." eyebrow="Operations" icon={Boxes}>
        <ExportMenu table="products" params={{ search: list.search, sort: list.sort, dir: list.dir, stock, category }} />
        <Button variant="secondary" icon={Upload} onClick={() => setImporting(true)}>Import</Button>
        <Button icon={PackagePlus} onClick={() => setEditing({ ...BLANK })}>Add product</Button>
      </PageHeader>

      <ErrorNote error={list.error} onDismiss={() => list.setError(null)} />

      {summary && (
        <RevealGroup className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4" gap={0.06}>
          <RevealItem><StatTile label="Products" icon={Package} value={summary.total} footnote={`${Number(summary.units).toLocaleString()} units`} onClick={() => setStock('')} active={!stock} /></RevealItem>
          <RevealItem><StatTile label="Running low" icon={CircleAlert} value={summary.lowStock} tone={summary.lowStock ? 'amber' : undefined} footnote="at or under reorder level" onClick={() => setStock(stock === 'low' ? '' : 'low')} active={stock === 'low'} /></RevealItem>
          <RevealItem><StatTile label="Out of stock" icon={CircleX} value={summary.outOfStock} tone={summary.outOfStock ? 'red' : undefined} footnote="can't be sold right now" onClick={() => setStock(stock === 'out' ? '' : 'out')} active={stock === 'out'} /></RevealItem>
          <RevealItem><StatTile label="Stock value" icon={Wallet} value={summary.stockValue} format={(n) => compactMoney(n)} footnote={`${compactMoney(summary.retailValue)} at sale price`} /></RevealItem>
        </RevealGroup>
      )}

      <Reveal className="mb-6">
        <Card padded={false} className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
            <CardHeader className="mb-0" icon={LayoutGrid} title="Stock at a glance" subtitle="Every product is a tower: height is stock, the glass slab is its reorder level. Click one to open it." />
            <Button variant="ghost" size="sm" onClick={toggleCity}>{showCity ? 'Hide 3D view' : 'Show 3D view'}</Button>
          </div>
          <AnimatePresence initial={false}>
            {showCity && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
                {cityProducts && cityProducts.length > 0 ? (
                  <>
                    <Scene3D load={loadCity} height={400} products={cityProducts} dark={isDark} onSelect={(p) => setViewing(p.id)} fallback={<p className="px-6 py-16 text-center text-[13.5px] text-ink-3">3D isn't available on this device - the table below has everything.</p>} />
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-6 pb-5 text-[12.5px] text-ink-2">
                      <Legend color={isDark ? '#4d86d6' : '#6f9fe0'} label="In stock" />
                      <Legend color="var(--status-warning)" label="Running low" />
                      <Legend color="var(--status-critical)" label="Out of stock" />
                      <span className="flex items-center gap-2"><span className="h-[3px] w-4 rounded-full" style={{ background: 'rgb(var(--c-text) / 0.35)' }} /> Reorder level</span>
                      <span className="ml-auto text-ink-3">Drag to turn · scroll inside to zoom</span>
                    </div>
                  </>
                ) : (
                  <p className="px-6 py-14 text-center text-[13.5px] text-ink-3">Add products to see them here.</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </Reveal>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name, code, supplier…" />
        <SegmentedControl value={stock} onChange={setStock} options={STOCK_FILTERS} ariaLabel="Stock level" size="sm" />
        <Select value={category} onChange={setCategory} options={categories} placeholder="All categories" />
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => { setStock(''); setCategory(''); list.setSearch(''); }}>Clear</Button>
        )}
      </div>

      <Table
        columns={columns}
        rows={list.rows}
        loading={list.loading}
        sort={list.sort}
        dir={list.dir}
        onSort={list.toggleSort}
        onRowClick={(p) => setViewing(p.id)}
        emptyIcon={Package}
        emptyTitle={filtered ? 'Nothing matches' : 'No products yet'}
        empty={filtered ? 'Try a different search or filter.' : 'Add your first product, or import a spreadsheet you already keep.'}
        emptyAction={!filtered && (
          <>
            <Button icon={PackagePlus} onClick={() => setEditing({ ...BLANK })}>Add product</Button>
            <Button variant="secondary" icon={FileSpreadsheet} onClick={() => setImporting(true)}>Import CSV</Button>
          </>
        )}
      />
      <Pagination meta={list.meta} page={list.page} onPage={list.setPage} loading={list.loading} />

      <AnimatePresence>
        {editing && <ProductForm key="edit" initial={editing} onSave={save} onClose={() => setEditing(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {adjusting && (
          <StockForm
            key="adjust"
            product={adjusting}
            onClose={() => setAdjusting(null)}
            onDone={async (result) => {
              setAdjusting(null);
              toast.success('Stock updated', { description: `${result.product.name} is now at ${Number(result.product.stock_quantity)}` });
              await afterChange();
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {viewing && (
          <ProductDetail
            key={`view-${viewing}`}
            productId={viewing}
            onClose={() => setViewing(null)}
            onEdit={(product) => { setViewing(null); setEditing(product); }}
            onAdjust={(product) => { setViewing(null); setAdjusting(product); }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {importing && (
          <ImportModal key="import" onClose={() => setImporting(false)} onDone={async () => { setImporting(false); await afterChange(); }} />
        )}
      </AnimatePresence>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  );
}

function ProductGlyph({ product }) {
  const state = stockState(product);
  const tint = { red: 'var(--danger-soft)', amber: 'var(--warning-soft)', green: 'var(--accent-soft)' }[state.tone];
  const ink = { red: 'rgb(var(--c-danger))', amber: 'rgb(var(--c-warning))', green: 'rgb(var(--c-accent-text))' }[state.tone];
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] text-[13px] font-semibold" style={{ background: tint, color: ink }}>
      {(product.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

function ImportModal({ onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [dragging, setDragging] = useState(false);
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
    <Modal title="Import products" subtitle="From a CSV exported by Excel or Google Sheets" icon={FileSpreadsheet} onClose={onClose} size="lg">
      <ErrorNote error={error} onDismiss={() => setError(null)} />

      {result ? (
        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={{ background: 'var(--success-soft)' }}>
            <p className="text-[15px] font-semibold text-success">Import finished</p>
            <p className="mt-1 text-[14px]">{result.created} added, {result.updated} updated{result.skipped ? `, ${result.skipped} skipped` : ''}. Stock set by the import is recorded in each product's ledger.</p>
          </div>
          {result.problems?.length > 0 && (
            <div className="rounded-2xl p-4 text-[13px]" style={{ background: 'var(--warning-soft)' }}>
              <p className="font-semibold text-warning">Rows that were skipped</p>
              <ul className="mt-2 space-y-1">{result.problems.map((p) => <li key={p.line}>Line {p.line}: {p.message}</li>)}</ul>
            </div>
          )}
          <div className="flex justify-end"><Button onClick={onDone}>Done</Button></div>
        </div>
      ) : (
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files?.[0]); }}
            onClick={() => inputRef.current?.click()}
            className={cn('cursor-pointer rounded-2xl px-6 py-10 text-center transition-all duration-300', dragging && 'scale-[1.01]')}
            style={{ background: dragging ? 'var(--accent-soft)' : 'var(--wash)', boxShadow: `inset 0 0 0 1.5px ${dragging ? 'rgb(var(--c-accent))' : 'var(--line-strong)'}`, borderRadius: 18 }}
          >
            <motion.div animate={{ y: dragging ? -6 : 0 }} className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl" style={{ background: 'rgb(var(--c-elevated))', boxShadow: 'var(--shadow-md)' }}>
              <Upload size={20} className="text-accent-ink" />
            </motion.div>
            <p className="text-[15px] font-medium">{busy && !preview ? 'Reading…' : file ? file.name : 'Drop a CSV here, or click to choose'}</p>
            <p className="mt-1 text-[12.5px] text-ink-3">Headings are matched automatically - "Price", "Rate" and "MRP" all work. Existing codes are updated, not duplicated.</p>
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
          </div>

          {preview && (
            <div className="space-y-3">
              <div className="rounded-2xl p-4 text-[13.5px]" style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                <p className="font-medium">Found {preview.readyCount} product{preview.readyCount === 1 ? '' : 's'}{preview.problemCount > 0 && ` · ${preview.problemCount} row(s) will be skipped`}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(preview.detectedColumns).map(([field, heading]) => (
                    <Badge key={field} tone="blue">{heading} → {field.replace(/_/g, ' ')}</Badge>
                  ))}
                </div>
                {preview.ignoredColumns.length > 0 && <p className="mt-2 text-[12.5px] text-ink-3">Ignored: {preview.ignoredColumns.join(', ')}</p>}
              </div>
              {preview.sample.length > 0 && (
                <Table
                  columns={[
                    { key: 'name', label: 'Name' },
                    { key: 'sku', label: 'Code' },
                    { key: 'category', label: 'Category' },
                    { key: 'sale_price', label: 'Price', align: 'right' },
                    { key: 'stock_quantity', label: 'Stock', align: 'right' },
                  ]}
                  rows={preview.sample.map((r, i) => ({ ...r, id: i }))}
                  minWidth={480}
                  empty="Nothing to preview."
                />
              )}
              {preview.problems.length > 0 && (
                <div className="rounded-2xl p-4 text-[13px]" style={{ background: 'var(--warning-soft)' }}>
                  <p className="font-semibold text-warning">These rows will be skipped</p>
                  <ul className="mt-2 space-y-1">{preview.problems.map((p) => <li key={p.line}>Line {p.line}: {p.message}</li>)}</ul>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={commit} loading={busy && Boolean(preview)} disabled={!preview || preview.readyCount === 0}>
              {preview ? `Import ${preview.readyCount} products` : 'Import'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ProductForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState({ ...BLANK, ...initial, supplier_id: initial.supplier_id ?? '' });
  const [suppliers, setSuppliers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { money } = useSettings();
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  useEffect(() => {
    api.suppliers.list({ pageSize: 200 }).then((d) => setSuppliers(d.rows)).catch(() => {});
    api.products.categories().then(setCategories).catch(() => {});
  }, []);

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

  const margin = Number(form.sale_price) > 0 ? Math.round(((Number(form.sale_price) - Number(form.cost_price || 0)) / Number(form.sale_price)) * 100) : null;

  return (
    <Modal title={form.id ? 'Edit product' : 'Add a product'} subtitle={form.id ? form.name : 'Only the name is required'} icon={form.id ? Pencil : PackagePlus} onClose={onClose} size="lg">
      <form onSubmit={submit} className="space-y-5">
        <ErrorNote error={error} onDismiss={() => setError(null)} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2">
            <input className="input-field" value={form.name} onChange={set('name')} autoFocus required />
          </Field>
          <Field label="Code (SKU)" hint="Optional, but unique">
            <input className="input-field" value={form.sku || ''} onChange={set('sku')} />
          </Field>
          <Field label="Category" hint="Pick one or type a new one">
            <input className="input-field" list="product-categories" value={form.category || ''} onChange={set('category')} />
            <datalist id="product-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
        </div>

        <div className="rounded-2xl p-4" style={{ background: 'var(--wash)' }}>
          <p className="mb-3 text-[13px] font-medium">Pricing</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Cost price" hint="What you pay">
              <input className="input-field" type="number" step="0.01" min="0" value={form.cost_price ?? ''} onChange={set('cost_price')} />
            </Field>
            <Field label="Sale price" hint="What you charge">
              <input className="input-field" type="number" step="0.01" min="0" value={form.sale_price ?? ''} onChange={set('sale_price')} />
            </Field>
            <div className="flex flex-col justify-center rounded-xl px-4 py-2" style={{ background: 'rgb(var(--c-elevated))', boxShadow: '0 0 0 1px var(--line)' }}>
              <span className="text-[12px] text-ink-3">Margin</span>
              <span className={cn('text-[20px] font-semibold tabular', margin !== null && margin < 0 && 'text-danger')}>{margin === null ? '—' : `${margin}%`}</span>
              {margin !== null && <span className="text-[11.5px] text-ink-3">{money(Number(form.sale_price) - Number(form.cost_price || 0))} each</span>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={form.id ? 'In stock' : 'Opening stock'} hint={form.id ? 'Changing this records a correction' : 'Goes in the stock ledger'}>
            <input className="input-field" type="number" step="any" min="0" value={form.stock_quantity ?? ''} onChange={set('stock_quantity')} />
          </Field>
          <Field label="Reorder level" hint="Alert when stock drops to this">
            <input className="input-field" type="number" step="any" min="0" value={form.reorder_level ?? ''} onChange={set('reorder_level')} />
          </Field>
          <Field label="Unit" hint="box, kg, hour…">
            <input className="input-field" value={form.unit || ''} onChange={set('unit')} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Supplier">
            <select className="input-field" value={form.supplier_id || ''} onChange={set('supplier_id')}>
              <option value="">None</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Description">
            <input className="input-field" value={form.description || ''} onChange={set('description')} />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{form.id ? 'Save changes' : 'Add product'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function StockForm({ product, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState('in');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const parsed = Number(amount || 0);
  const change = direction === 'in' ? parsed : -parsed;
  const current = Number(product.stock_quantity);
  const result = Math.round((current + change) * 1000) / 1000;
  const REASONS = direction === 'in' ? ['Delivery', 'Stock count', 'Returned by customer'] : ['Damaged', 'Expired', 'Used in the shop', 'Stock count'];

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await api.products.adjustStock(product.id, change, reason);
      await onDone(response);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Adjust stock" subtitle={product.name} icon={SlidersHorizontal} onClose={onClose}>
      <form onSubmit={submit} className="space-y-5">
        <ErrorNote error={error} onDismiss={() => setError(null)} />
        <SegmentedControl value={direction} onChange={setDirection} options={[['in', 'Add stock'], ['out', 'Remove stock']]} className="w-full [&>button]:flex-1 [&>button]:justify-center" />

        <div className="flex items-center justify-center gap-6 py-2">
          <div className="text-center">
            <p className="text-[12px] text-ink-3">Now</p>
            <p className="text-[32px] font-semibold tracking-[-0.04em] tabular">{current}</p>
          </div>
          <motion.span key={direction} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-[22px] text-ink-3">→</motion.span>
          <div className="text-center">
            <p className="text-[12px] text-ink-3">After</p>
            <motion.p key={result} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={cn('text-[32px] font-semibold tracking-[-0.04em] tabular', result < 0 ? 'text-danger' : direction === 'in' && parsed ? 'text-success' : '')}>
              {amount === '' ? '—' : result}
            </motion.p>
          </div>
        </div>

        <Field label="How many?">
          <input className="input-field text-center text-[18px]" type="number" min="0.001" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
        </Field>

        <Field label="Reason" hint="Recorded in the stock ledger">
          <input className="input-field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={cn('rounded-full px-2.5 py-1 text-[12px] transition-colors', reason === r ? 'bg-[var(--accent-soft)] text-accent-ink' : 'bg-[var(--wash-strong)] text-ink-2 hover:text-ink')}>{r}</button>
            ))}
          </div>
        </Field>

        {result < 0 && <p className="text-[13px] text-danger">You only have {current} - you can't remove {parsed}.</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!amount || result < 0 || parsed <= 0}>Update stock</Button>
        </div>
      </form>
    </Modal>
  );
}
