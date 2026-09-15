import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowDownLeft, ArrowUpRight, Bot, ClipboardList, Database, FileText, History, Package, PackageCheck,
  Pencil, Receipt, RotateCcw, SlidersHorizontal, Truck, Upload, UserRound,
} from 'lucide-react';
import { api, fileContentUrl } from '../api/client';
import { Badge, Button, ErrorNote, Modal, SegmentedControl, Spinner } from './ui';
import { AreaChart, ColumnChart } from './charts';
import { useSettings } from '../lib/settings';
import { formatDate, formatDateTime, formatRelative } from '../lib/format';

const KIND = {
  opening: { label: 'Opening stock', icon: Package },
  sale: { label: 'Sold', icon: Receipt },
  sale_void: { label: 'Sale deleted', icon: RotateCcw },
  purchase_receipt: { label: 'Delivery received', icon: Truck },
  adjustment: { label: 'Adjusted', icon: SlidersHorizontal },
  correction: { label: 'Corrected', icon: Pencil },
  import: { label: 'Imported', icon: Upload },
};

const ACTORS = { web: 'You', assistant: 'Assistant', 'sql-console': 'SQL console', import: 'Import', system: 'DocDesk', 'sample-data': 'Sample data', 'integrity-check': 'Integrity check', restore: 'Restore' };

/** Everything about one product: how it sells, its stock ledger, what's on order and every change made to it. */
export default function ProductDetail({ productId, onClose, onEdit, onAdjust }) {
  const [data, setData] = useState(null);
  const [changes, setChanges] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const { money } = useSettings();

  useEffect(() => {
    api.products.history(productId).then(setData).catch((err) => setError(err.message));
  }, [productId]);

  useEffect(() => {
    if (tab === 'changes' && changes === null) {
      api.db.history('products', productId).then(setChanges).catch(() => setChanges([]));
    }
  }, [tab, changes, productId]);

  const product = data?.product;
  const margin = product && Number(product.sale_price) > 0
    ? Math.round(((product.sale_price - product.cost_price) / product.sale_price) * 100)
    : null;
  const status = !product ? null : product.stock_quantity <= 0 ? 'out' : product.reorder_level > 0 && product.stock_quantity <= product.reorder_level ? 'low' : 'ok';

  // The ledger, oldest first, as a balance line.
  const balance = useMemo(
    () => (data?.movements || []).slice().reverse().map((m) => ({ day: m.created_at, balance: Number(m.balance_after) })),
    [data]
  );

  return (
    <Modal title={product?.name || 'Product'} subtitle={product ? [product.sku, product.category, product.supplier_name].filter(Boolean).join(' · ') : null} icon={Package} onClose={onClose} size="xl">
      <ErrorNote error={error} />
      {!data && !error && (
        <div className="grid h-72 place-items-center text-ink-3"><Spinner size={22} /></div>
      )}

      {data && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status === 'out' ? 'red' : status === 'low' ? 'amber' : 'green'} icon>
              {status === 'out' ? 'Out of stock' : status === 'low' ? 'Running low' : 'In stock'}
            </Badge>
            <span className="text-[13px] text-ink-2 tabular">{Number(product.stock_quantity)} {product.unit} · reorder at {Number(product.reorder_level)}</span>
            <div className="ml-auto flex gap-2">
              {onAdjust && <Button variant="secondary" size="sm" icon={SlidersHorizontal} onClick={() => onAdjust(product)}>Adjust stock</Button>}
              <Button variant="secondary" size="sm" icon={Pencil} onClick={() => onEdit(product)}>Edit</Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Units sold" value={data.unitsSold} meta={`${data.saleCount} sales`} />
            <Figure label="Revenue" value={money(data.revenue)} />
            <Figure label="Gross profit" value={money(data.profit)} meta={margin !== null ? `${margin}% margin now` : null} />
            <Figure label="Price" value={money(product.sale_price)} meta={`costs ${money(product.cost_price)}`} />
          </div>

          <SegmentedControl
            value={tab}
            onChange={setTab}
            options={[['overview', 'Sales', Receipt], ['ledger', 'Stock ledger', ClipboardList], ['changes', 'Change history', History]]}
            ariaLabel="Product details"
          />

          {tab === 'overview' && (
            <motion.div key="overview" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <section className="rounded-2xl p-4" style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                <p className="mb-3 text-[13px] font-medium">Units sold per day · last 30 days</p>
                <ColumnChart data={data.trend} valueKey="units" labelKey="day" height={170} formatLabel={(d) => formatDate(d, { day: 'numeric' })} formatTitle={(d) => formatDate(d, { weekday: 'short', day: 'numeric', month: 'short' })} formatValue={(v) => `${v} sold`} />
              </section>

              {data.incoming.length > 0 && (
                <section>
                  <p className="mb-2 text-[13px] font-medium">On its way</p>
                  <ul className="space-y-2">
                    {data.incoming.map((o) => (
                      <li key={o.reference} className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'var(--wash)' }}>
                        <Truck size={16} className="text-accent-ink" />
                        <span className="text-[14px] font-medium">{o.reference}</span>
                        <Badge tone="blue">{o.status}</Badge>
                        <span className="ml-auto text-[13px] text-ink-2 tabular">
                          {Number(o.quantity) - Number(o.quantity_received)} of {Number(o.quantity)} arriving {o.expected_date ? `· ${formatDate(o.expected_date)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <p className="mb-2 text-[13px] font-medium">Recent sales</p>
                {data.sales.length === 0 ? (
                  <p className="text-[13.5px] text-ink-3">This product hasn't sold yet.</p>
                ) : (
                  <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
                    {data.sales.slice(0, 8).map((s) => (
                      <li key={`${s.id}-${s.created_at}`} className="flex items-center justify-between py-2.5 text-[13.5px]" style={{ borderColor: 'var(--line)' }}>
                        <span className="font-medium">{s.reference}</span>
                        <span className="text-ink-3">{formatRelative(s.created_at)}</span>
                        <span className="tabular text-ink-2">{Number(s.quantity)} × {money(s.unit_price)}</span>
                        <span className="font-semibold tabular">{money(s.line_total)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {data.files.length > 0 && (
                <section>
                  <p className="mb-2 text-[13px] font-medium">Attached files</p>
                  <div className="flex flex-wrap gap-2">
                    {data.files.map((f) => (
                      <a key={f.id} href={fileContentUrl(f.id)} target="_blank" rel="noreferrer" className="btn-secondary btn-sm"><FileText size={14} /> {f.original_name}</a>
                    ))}
                  </div>
                </section>
              )}
            </motion.div>
          )}

          {tab === 'ledger' && (
            <motion.div key="ledger" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
              {balance.length > 1 && (
                <section className="rounded-2xl p-4" style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                  <p className="mb-1 text-[13px] font-medium">Stock level over time</p>
                  <p className="mb-3 text-[12px] text-ink-3">Every point is a recorded movement; the database keeps this and the stock level in step.</p>
                  <AreaChart data={balance} valueKey="balance" labelKey="day" height={180} color="var(--series-3)" formatValue={(v) => `${v} in stock`} formatAxis={(v) => v} formatTitle={(d) => formatDateTime(d)} />
                </section>
              )}
              <ol className="relative space-y-1">
                <span className="absolute bottom-3 left-[17px] top-3 w-px" style={{ background: 'var(--line)' }} aria-hidden="true" />
                {data.movements.map((m, i) => {
                  const kind = KIND[m.kind] || { label: m.kind, icon: Package };
                  const Icon = kind.icon;
                  const up = Number(m.change) > 0;
                  return (
                    <motion.li key={m.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }} className="relative flex items-center gap-3 rounded-xl py-2 pr-2">
                      <span className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: 'rgb(var(--c-elevated))', boxShadow: '0 0 0 1px var(--line)' }}>
                        <Icon size={15} className="text-ink-2" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium">{kind.label}{m.note ? <span className="font-normal text-ink-2"> · {m.note}</span> : null}</p>
                        <p className="text-[12px] text-ink-3">{formatDateTime(m.created_at)} · {ACTORS[m.actor] || m.actor}</p>
                      </div>
                      <span className={`inline-flex items-center gap-0.5 text-[13.5px] font-semibold tabular ${up ? 'text-success' : 'text-danger'}`}>
                        {up ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                        {up ? '+' : ''}{Number(m.change)}
                      </span>
                      <span className="w-16 text-right text-[12.5px] text-ink-3 tabular">→ {Number(m.balance_after)}</span>
                    </motion.li>
                  );
                })}
              </ol>
              {data.movements.length >= 40 && <p className="text-center text-[12px] text-ink-3">Showing the latest 40 movements.</p>}
            </motion.div>
          )}

          {tab === 'changes' && (
            <motion.div key="changes" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              {changes === null ? (
                <div className="grid h-40 place-items-center text-ink-3"><Spinner /></div>
              ) : changes.length === 0 ? (
                <p className="py-8 text-center text-[13.5px] text-ink-3">No recorded changes yet.</p>
              ) : (
                <ol className="space-y-3">
                  {changes.map((entry) => <ChangeEntry key={entry.id} entry={entry} />)}
                </ol>
              )}
            </motion.div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function ChangeEntry({ entry }) {
  const ActorIcon = entry.actor === 'assistant' ? Bot : entry.actor === 'sql-console' ? Database : entry.actor === 'web' ? UserRound : PackageCheck;
  const fields = entry.action === 'UPDATE' ? entry.changed_fields || [] : [];
  const show = (value) => (value === null || value === undefined || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value));
  return (
    <li className="rounded-2xl p-4" style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}>
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: 'var(--wash-strong)' }}>
          <ActorIcon size={14} className="text-ink-2" />
        </span>
        <span className="text-[13.5px] font-medium">{entry.action === 'INSERT' ? 'Created' : entry.action === 'DELETE' ? 'Deleted' : 'Changed'}</span>
        <span className="text-[12.5px] text-ink-3">by {ACTORS[entry.actor] || entry.actor}</span>
        <span className="ml-auto text-[12px] text-ink-3">{formatDateTime(entry.created_at)}</span>
      </div>
      {fields.length > 0 && (
        <dl className="mt-3 space-y-1.5">
          {fields.map((field) => (
            <div key={field} className="grid grid-cols-[120px_1fr] items-baseline gap-3 text-[13px]">
              <dt className="truncate text-ink-3">{field.replace(/_/g, ' ')}</dt>
              <dd className="min-w-0 truncate">
                <span className="rounded-md px-1.5 py-0.5 text-ink-2 line-through decoration-[rgb(var(--c-danger)/0.5)]" style={{ background: 'var(--danger-soft)' }}>{show(entry.old_data?.[field])}</span>
                <span className="mx-1.5 text-ink-3">→</span>
                <span className="rounded-md px-1.5 py-0.5 font-medium" style={{ background: 'var(--success-soft)' }}>{show(entry.new_data?.[field])}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

function Figure({ label, value, meta }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--wash)' }}>
      <p className="text-[12.5px] text-ink-2">{label}</p>
      <p className="mt-1 truncate text-[20px] font-semibold tracking-[-0.025em]">{value}</p>
      {meta && <p className="mt-0.5 text-[12px] text-ink-3">{meta}</p>}
    </div>
  );
}
