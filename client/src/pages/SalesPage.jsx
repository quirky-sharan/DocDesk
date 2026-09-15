import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Banknote, CalendarDays, CircleDollarSign, CreditCard, Download, Landmark, Minus, Plus, Receipt, RotateCcw,
  ShoppingBag, Smartphone, Trash2, TrendingUp, UserRound, Wallet, X,
} from 'lucide-react';
import { api, receiptPdfUrl } from '../api/client';
import { useList } from '../hooks/useList';
import { useAssistantView } from '../assistant/useAssistantView';
import { useSettings } from '../lib/settings';
import { useShell } from '../components/shell/ShellProvider';
import {
  Avatar, Badge, Button, ConfirmButton, ErrorNote, ExportMenu, Field, Modal, PageHeader, Pagination, SearchInput,
  SegmentedControl, Spinner, Table, useToast,
} from '../components/ui';
import { StatTile } from '../components/charts';
import { RevealGroup, RevealItem } from '../components/motion/Reveal';
import CountUp from '../components/motion/CountUp';
import ProductPicker from '../components/sales/ProductPicker';
import ReceiptPaper from '../components/sales/ReceiptPaper';
import { formatDate, formatDateTime, formatRelative } from '../lib/format';
import { cn } from '../lib/cn';

const STATUS_TONE = { paid: 'green', unpaid: 'red', partial: 'amber', refunded: 'slate' };
const STATUS_LABEL = { paid: 'Paid', unpaid: 'Unpaid', partial: 'Part paid', refunded: 'Refunded' };
const METHODS = [['cash', 'Cash', Banknote], ['upi', 'UPI', Smartphone], ['card', 'Card', CreditCard], ['bank', 'Bank', Landmark]];
const METHOD_LABEL = { cash: 'Cash', card: 'Card', upi: 'UPI', bank: 'Bank transfer', other: 'Other' };

function dateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString('en-CA');
}

const PRESETS = [['all', 'All time'], ['today', 'Today'], ['7', '7 days'], ['30', '30 days']];

export default function SalesPage() {
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [paying, setPaying] = useState(null);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preset, setPreset] = useState('all');
  const [kpis, setKpis] = useState(null);
  const { money, compactMoney } = useSettings();
  const shell = useShell();
  const toast = useToast();

  const fetcher = useCallback((p) => api.sales.list(p), []);
  const list = useList(fetcher, { initialSort: 'created_at', initialDir: 'desc', filters: { payment_status: status, from, to } });

  useAssistantView('sales', list, { payment_status: setStatus, from: setFrom, to: setTo }, { defaultSort: 'created_at', defaultDir: 'desc' });

  const loadKpis = useCallback(async () => {
    const [pulse, month] = await Promise.all([api.reports.pulse(), api.reports.summary({ days: 30 })]);
    setKpis({ pulse, month });
  }, []);

  useEffect(() => {
    loadKpis().catch(() => {});
  }, [loadKpis]);

  useEffect(() => {
    const receipt = params.get('receipt');
    if (params.get('new')) setCreating(true);
    if (receipt) setViewing(Number(receipt));
    if (params.get('status')) setStatus(params.get('status'));
    if (params.get('new') || receipt || params.get('status')) setParams({}, { replace: true });
  }, [params, setParams]);

  function applyPreset(value) {
    setPreset(value);
    if (value === 'all') { setFrom(''); setTo(''); }
    if (value === 'today') { setFrom(dateDaysAgo(0)); setTo(dateDaysAgo(0)); }
    if (value === '7') { setFrom(dateDaysAgo(6)); setTo(dateDaysAgo(0)); }
    if (value === '30') { setFrom(dateDaysAgo(29)); setTo(dateDaysAgo(0)); }
  }

  async function refresh() {
    await Promise.all([list.reload(), loadKpis()]);
    shell.refreshCounts();
  }

  async function remove(sale) {
    try {
      await api.sales.remove(sale.id);
      toast.success('Sale deleted', { description: `${sale.reference} - items are back in stock` });
      await refresh();
    } catch (err) {
      list.setError(err.message);
    }
  }

  const columns = [
    {
      key: 'reference',
      label: 'Receipt',
      render: (s) => (
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-[12px]" style={{ background: 'var(--accent-soft)' }}><Receipt size={16} className="text-accent-ink" /></span>
          <div>
            <p className="font-medium">{s.reference}</p>
            <p className="text-[12px] text-ink-3" title={formatDateTime(s.created_at)}>{formatRelative(s.created_at)}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'customer_name',
      label: 'Customer',
      render: (s) => (
        <div className="flex items-center gap-2.5">
          {s.customer_name ? <Avatar name={s.customer_name} size={28} /> : <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: 'var(--wash-strong)' }}><UserRound size={13} className="text-ink-3" /></span>}
          <span className={s.customer_name ? '' : 'text-ink-3'}>{s.customer_name || 'Walk-in'}</span>
        </div>
      ),
    },
    {
      key: 'payment_status',
      label: 'Payment',
      render: (s) => (
        <div className="flex flex-col items-start gap-0.5">
          <Badge tone={STATUS_TONE[s.payment_status]} icon>{STATUS_LABEL[s.payment_status]}</Badge>
          {s.balance_due > 0 && s.payment_status !== 'refunded' && <span className="text-[11.5px] text-ink-3 tabular">{money(s.balance_due)} owed</span>}
        </div>
      ),
    },
    { key: 'payment_method', label: 'Method', render: (s) => <span className="text-ink-2">{METHOD_LABEL[s.payment_method] || '—'}</span> },
    { key: 'total', label: 'Total', align: 'right', render: (s) => <span className="text-[15px] font-semibold tabular">{money(s.total)}</span> },
    {
      key: 'actions',
      label: '',
      sortable: false,
      align: 'right',
      render: (s) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          {s.payment_status !== 'paid' && s.payment_status !== 'refunded' && (
            <button type="button" className="btn-edit" onClick={() => setPaying(s)}><Wallet size={14} /> Record payment</button>
          )}
          <a className="btn-edit btn-icon" href={receiptPdfUrl(s.id)} title="Download PDF receipt" aria-label={`Download ${s.reference}`}><Download size={14} /></a>
          <ConfirmButton className="btn-danger btn-icon" icon={Trash2} title={`Delete ${s.reference}`} message={`Delete ${s.reference}? Its items go back into stock and its payments are removed.`} onConfirm={() => remove(s)} />
        </div>
      ),
    },
  ];

  const filtered = Boolean(status || from || to || list.search);

  return (
    <div>
      <PageHeader title="Sales" subtitle="Every sale, its receipt, and who still owes what." eyebrow="Operations" icon={ShoppingBag}>
        <ExportMenu table="sales" params={{ search: list.search, sort: list.sort, dir: list.dir, payment_status: status, from, to }} />
        <Button icon={Plus} onClick={() => setCreating(true)}>New sale</Button>
      </PageHeader>

      <ErrorNote error={list.error} onDismiss={() => list.setError(null)} />

      {kpis && (
        <RevealGroup className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4" gap={0.06}>
          <RevealItem><StatTile label="Today" icon={CircleDollarSign} value={kpis.pulse.today.revenue} format={(n) => money(n)} delta={kpis.pulse.dayChangePercent} deltaLabel="vs yesterday" footnote={`${kpis.pulse.today.saleCount} sales`} /></RevealItem>
          <RevealItem><StatTile label="Last 7 days" icon={TrendingUp} value={kpis.pulse.thisWeek.revenue} format={(n) => compactMoney(n)} delta={kpis.pulse.weekChangePercent} deltaLabel="vs week before" /></RevealItem>
          <RevealItem><StatTile label="Owed to you" icon={Wallet} value={kpis.month.outstanding.amount} format={(n) => compactMoney(n)} tone={kpis.month.outstanding.count ? 'amber' : undefined} footnote={`${kpis.month.outstanding.count} sales`} onClick={() => setStatus(status === 'unpaid' ? '' : 'unpaid')} active={status === 'unpaid'} /></RevealItem>
          <RevealItem><StatTile label="Average sale" icon={Receipt} value={kpis.month.averageSale} format={(n) => money(n)} footnote="last 30 days" /></RevealItem>
        </RevealGroup>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search receipt or customer…" />
        <SegmentedControl size="sm" value={status} onChange={setStatus} options={[['', 'Any'], ['paid', 'Paid'], ['unpaid', 'Unpaid'], ['partial', 'Part paid'], ['refunded', 'Refunded']]} ariaLabel="Payment status" />
        <SegmentedControl size="sm" value={preset} onChange={applyPreset} options={PRESETS} ariaLabel="Date range" />
        <div className="flex items-center gap-1.5 text-[13px] text-ink-3">
          <CalendarDays size={15} />
          <input type="date" className="input-field h-8 min-h-0 w-[140px] rounded-full py-0 text-[13px]" value={from} onChange={(e) => { setFrom(e.target.value); setPreset(''); }} aria-label="From" />
          <span>–</span>
          <input type="date" className="input-field h-8 min-h-0 w-[140px] rounded-full py-0 text-[13px]" value={to} onChange={(e) => { setTo(e.target.value); setPreset(''); }} aria-label="To" />
        </div>
        {filtered && <Button variant="ghost" size="sm" onClick={() => { setStatus(''); applyPreset('all'); list.setSearch(''); }}>Clear</Button>}
      </div>

      <Table
        columns={columns}
        rows={list.rows}
        loading={list.loading}
        sort={list.sort}
        dir={list.dir}
        onSort={list.toggleSort}
        onRowClick={(s) => setViewing(s.id)}
        emptyIcon={Receipt}
        emptyTitle={filtered ? 'No sales match' : 'No sales yet'}
        empty={filtered ? 'Try another filter or date range.' : 'Record your first sale - stock and receipts are handled for you.'}
        emptyAction={!filtered && <Button icon={Plus} onClick={() => setCreating(true)}>New sale</Button>}
      />
      <Pagination meta={list.meta} page={list.page} onPage={list.setPage} loading={list.loading} />

      <AnimatePresence>
        {creating && (
          <NewSale
            key="new"
            onClose={() => setCreating(false)}
            onDone={async (sale) => {
              setCreating(false);
              toast.success(`Sale ${sale.reference} recorded`, { description: `${money(sale.total)} · ${STATUS_LABEL[sale.payment_status]}` });
              await refresh();
              setViewing({ id: sale.id, fresh: true });
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {viewing && (
          <ReceiptModal
            key={`receipt-${viewing.id || viewing}`}
            saleId={viewing.id || viewing}
            fresh={Boolean(viewing.fresh)}
            onClose={() => setViewing(null)}
            onPay={(sale) => { setViewing(null); setPaying(sale); }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {paying && (
          <PaymentModal
            key="pay"
            sale={paying}
            onClose={() => setPaying(null)}
            onDone={async (sale) => {
              setPaying(null);
              toast.success('Payment recorded', { description: `${sale.reference} is now ${STATUS_LABEL[sale.payment_status].toLowerCase()}` });
              await refresh();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

let lineSeq = 0;
const newLine = () => ({ key: ++lineSeq, product_id: '', description: '', quantity: 1, unit_price: '' });

function NewSale({ onClose, onDone }) {
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [lines, setLines] = useState([newLine()]);
  const [customerId, setCustomerId] = useState('');
  const [discount, setDiscount] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('paid');
  const [amountPaid, setAmountPaid] = useState('');
  const [method, setMethod] = useState('cash');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { values } = useSettings();

  useEffect(() => {
    Promise.all([api.products.list({ pageSize: 200, sort: 'name' }), api.customers.list({ pageSize: 200, sort: 'name' })])
      .then(([p, c]) => {
        setProducts(p.rows);
        setCustomers(c.rows);
      })
      .catch((err) => setError(err.message));
    const rate = Number(values.default_tax_rate || 0);
    if (rate > 0) setTaxRate(String(rate));
  }, [values.default_tax_rate]);

  const update = (key, patch) => setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const items = lines.filter((l) => l.product_id || l.description).map((l) => {
    const product = products.find((p) => String(p.id) === String(l.product_id));
    const quantity = Number(l.quantity || 0);
    const unitPrice = Number(l.unit_price || 0);
    return { ...l, product, quantity, unitPrice, lineTotal: Math.round(quantity * unitPrice * 100) / 100, description: product ? product.name : l.description };
  });
  const subtotal = items.reduce((sum, l) => sum + l.lineTotal, 0);
  const discountValue = Math.min(Number(discount || 0), subtotal);
  const tax = Math.round(((subtotal - discountValue) * Number(taxRate || 0)) / 100 * 100) / 100;
  const total = Math.round((subtotal - discountValue + tax) * 100) / 100;
  const shortages = items.filter((l) => l.product && l.quantity > Number(l.product.stock_quantity));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const sale = await api.sales.create({
        customer_id: customerId || null,
        discount: discount || 0,
        tax_rate: taxRate || 0,
        payment_status: paymentStatus,
        amount_paid: paymentStatus === 'partial' ? amountPaid : undefined,
        payment_method: method,
        items: items.map((l) => ({ product_id: l.product_id || null, description: l.description, quantity: l.quantity, unit_price: l.unit_price === '' ? undefined : l.unit_price })),
      });
      await onDone(sale);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const customer = customers.find((c) => String(c.id) === String(customerId));
  const preview = {
    items: items.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
    totals: { subtotal, discount: discountValue, tax, taxRate: Number(taxRate || 0), total, paid: paymentStatus === 'paid' ? total : paymentStatus === 'partial' ? Number(amountPaid || 0) : 0, balance: paymentStatus === 'paid' ? 0 : Math.max(total - (paymentStatus === 'partial' ? Number(amountPaid || 0) : 0), 0) },
    payment: { status: paymentStatus, method },
    customer: customer ? { name: customer.name } : null,
  };

  return (
    <Modal title="New sale" subtitle="Stock moves and the receipt is made when you record it" icon={ShoppingBag} onClose={onClose} size="full" bodyClassName="pb-0">
      <form onSubmit={submit} className="grid grid-cols-1 gap-6 pb-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          <ErrorNote error={error} onDismiss={() => setError(null)} />

          <Field label="Customer" hint="Leave as walk-in if you don't need their details">
            <select className="input-field" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Walk-in customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
            </select>
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-medium">Items</p>
              <p className="text-[12px] text-ink-3">Type to find a product, or describe a service</p>
            </div>
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {lines.map((line, index) => {
                  const product = products.find((p) => String(p.id) === String(line.product_id));
                  const short = product && Number(line.quantity) > Number(product.stock_quantity);
                  return (
                    <motion.li key={line.key} layout initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }} className="rounded-2xl p-3" style={{ background: 'var(--wash)' }}>
                      <div className="grid grid-cols-12 items-center gap-2">
                        <div className="col-span-12 sm:col-span-6">
                          <ProductPicker
                            products={products}
                            value={line.product_id}
                            description={line.description}
                            autoFocus={index === 0 && lines.length === 1}
                            onPick={(p) => update(line.key, { product_id: p.id, description: p.name, unit_price: p.sale_price })}
                            onDescribe={(text) => update(line.key, { product_id: '', description: text })}
                          />
                        </div>
                        <div className="col-span-5 flex items-center sm:col-span-3">
                          <button type="button" className="btn-secondary btn-icon btn-sm shrink-0" onClick={() => update(line.key, { quantity: Math.max(Number(line.quantity || 0) - 1, 1) })} aria-label="Less"><Minus size={13} /></button>
                          <input className="input-field mx-1 min-h-[34px] px-1 text-center tabular" type="number" min="0.001" step="any" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} aria-label="Quantity" />
                          <button type="button" className="btn-secondary btn-icon btn-sm shrink-0" onClick={() => update(line.key, { quantity: Number(line.quantity || 0) + 1 })} aria-label="More"><Plus size={13} /></button>
                        </div>
                        <div className="col-span-5 sm:col-span-2">
                          <input className="input-field min-h-[34px] text-right tabular" type="number" min="0" step="0.01" placeholder="Price" value={line.unit_price} onChange={(e) => update(line.key, { unit_price: e.target.value })} aria-label="Price" />
                        </div>
                        <div className="col-span-2 flex justify-end sm:col-span-1">
                          <button type="button" className="btn-ghost btn-icon btn-sm" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))} aria-label="Remove item"><X size={15} /></button>
                        </div>
                      </div>
                      {short && <p className="mt-2 text-[12.5px] text-danger">Only {Number(product.stock_quantity)} of {product.name} in stock.</p>}
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
            <Button variant="ghost" size="sm" icon={Plus} className="mt-2" onClick={() => setLines((current) => [...current, newLine()])}>Add another item</Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Discount"><input className="input-field" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></Field>
            <Field label="Tax %"><input className="input-field" type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="0" /></Field>
          </div>

          <div className="space-y-3 rounded-2xl p-4" style={{ background: 'var(--wash)' }}>
            <p className="text-[13px] font-medium">Payment</p>
            <SegmentedControl value={paymentStatus} onChange={setPaymentStatus} options={[['paid', 'Paid now'], ['partial', 'Part paid'], ['unpaid', 'Pay later']]} ariaLabel="Payment" />
            <AnimatePresence initial={false}>
              {paymentStatus === 'partial' && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <Field label="Amount paid now" className="pt-1">
                    <input className="input-field" type="number" min="0.01" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} required />
                  </Field>
                </motion.div>
              )}
            </AnimatePresence>
            {paymentStatus !== 'unpaid' && <SegmentedControl size="sm" value={method} onChange={setMethod} options={METHODS} ariaLabel="Method" />}
          </div>
        </div>

        <aside className="lg:sticky lg:top-0 lg:self-start">
          <ReceiptPaper receipt={preview} compact />
          <div className="mt-4 rounded-2xl p-4" style={{ background: 'rgb(var(--c-surface))', boxShadow: '0 0 0 1px var(--line), var(--shadow-md)' }}>
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] text-ink-2">To charge</span>
              <span className="text-[28px] font-semibold tracking-[-0.035em]"><TotalFigure value={paymentStatus === 'partial' ? Number(amountPaid || 0) : paymentStatus === 'paid' ? total : 0} /></span>
            </div>
            <Button type="submit" size="lg" className="mt-3 w-full" loading={busy} disabled={total <= 0 || shortages.length > 0 || (paymentStatus === 'partial' && !(Number(amountPaid) > 0 && Number(amountPaid) < total))}>
              Record sale
            </Button>
          </div>
        </aside>
      </form>
    </Modal>
  );
}

function TotalFigure({ value }) {
  const { money } = useSettings();
  return <CountUp value={value} format={(n) => money(n)} duration={0.4} />;
}

function ReceiptModal({ saleId, fresh, onClose, onPay }) {
  const [receipt, setReceipt] = useState(null);
  const [sale, setSale] = useState(null);
  const [error, setError] = useState(null);
  const { money } = useSettings();

  useEffect(() => {
    Promise.all([api.sales.receipt(saleId), api.sales.get(saleId)])
      .then(([r, s]) => { setReceipt(r); setSale(s); })
      .catch((err) => setError(err.message));
  }, [saleId]);

  return (
    <Modal title={receipt ? `Receipt ${receipt.reference}` : 'Receipt'} subtitle={receipt ? formatDateTime(receipt.issuedAt) : null} icon={Receipt} onClose={onClose} size="lg">
      <ErrorNote error={error} />
      {!receipt && !error && <div className="grid h-72 place-items-center text-ink-3"><Spinner size={22} /></div>}
      {receipt && sale && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_220px]">
          <div className="mx-auto w-full max-w-[380px]">
            <ReceiptPaper receipt={receipt} printing={fresh} />
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl p-4" style={{ background: 'var(--wash)' }}>
              <p className="text-[12px] text-ink-3">Status</p>
              <div className="mt-1"><Badge tone={STATUS_TONE[sale.payment_status]} icon>{STATUS_LABEL[sale.payment_status]}</Badge></div>
              {sale.balance_due > 0 && sale.payment_status !== 'refunded' && <p className="mt-2 text-[20px] font-semibold tabular">{money(sale.balance_due)}<span className="ml-1 text-[12px] font-normal text-ink-3">owed</span></p>}
            </div>
            {sale.payments.length > 0 && (
              <div>
                <p className="mb-2 text-[12.5px] font-medium text-ink-2">Payments</p>
                <ol className="space-y-2">
                  {sale.payments.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 text-[13px]">
                      {p.amount < 0 ? <RotateCcw size={14} className="text-warning" /> : <Wallet size={14} className="text-success" />}
                      <span className="flex-1">{METHOD_LABEL[p.method]} <span className="text-ink-3">· {formatDate(p.paid_at)}</span></span>
                      <span className={cn('font-medium tabular', p.amount < 0 && 'text-warning')}>{money(p.amount)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {sale.payment_status !== 'paid' && sale.payment_status !== 'refunded' && <Button icon={Wallet} onClick={() => onPay(sale)}>Record payment</Button>}
              <a className="btn-secondary" href={receiptPdfUrl(saleId)}><Download size={15} /> Download PDF</a>
              <Button variant="ghost" onClick={onClose}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function PaymentModal({ sale, onClose, onDone }) {
  const { money } = useSettings();
  const balance = Math.round((Number(sale.total) - Number(sale.amount_paid || 0)) * 100) / 100;
  const [mode, setMode] = useState('payment');
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState(sale.payment_method || 'cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const paid = Number(sale.amount_paid || 0);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const value = Number(amount);
      const updated = await api.sales.addPayment(sale.id, { amount: mode === 'refund' ? -value : value, method, note: note || (mode === 'refund' ? 'Refund' : undefined) });
      await onDone(updated);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const max = mode === 'refund' ? paid : balance;
  const after = mode === 'refund' ? paid - Number(amount || 0) : paid + Number(amount || 0);

  return (
    <Modal title={mode === 'refund' ? 'Refund' : 'Record a payment'} subtitle={`${sale.reference} · total ${money(sale.total)}`} icon={Wallet} onClose={onClose}>
      <form onSubmit={submit} className="space-y-5">
        <ErrorNote error={error} onDismiss={() => setError(null)} />
        {paid > 0 && (
          <SegmentedControl value={mode} onChange={(m) => { setMode(m); setAmount(String(m === 'refund' ? paid : balance)); }} options={[['payment', 'Payment'], ['refund', 'Refund']]} />
        )}
        <div className="grid grid-cols-3 gap-2 text-center">
          <Mini label="Total" value={money(sale.total)} />
          <Mini label="Paid so far" value={money(paid)} />
          <Mini label="Still owed" value={money(balance)} strong />
        </div>
        <Field label={mode === 'refund' ? 'Amount to refund' : 'Amount received'}>
          <input className="input-field text-center text-[22px] font-semibold tabular" type="number" min="0.01" max={max} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {mode === 'payment' && [balance, Math.round(balance / 2), 100, 500].filter((v, i, a) => v > 0 && v <= balance && a.indexOf(v) === i).map((v) => (
              <button key={v} type="button" onClick={() => setAmount(String(v))} className="rounded-full px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:text-ink" style={{ background: 'var(--wash-strong)' }}>{v === balance ? `All ${money(v)}` : money(v)}</button>
            ))}
          </div>
        </Field>
        <SegmentedControl size="sm" value={method} onChange={setMethod} options={METHODS} ariaLabel="Method" />
        <Field label="Note" hint="Optional"><input className="input-field" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <p className="text-center text-[13px] text-ink-2">
          After this: <span className="font-semibold text-ink">{money(after)}</span> paid{mode === 'payment' && after >= Number(sale.total) ? ' - fully settled' : ''}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={mode === 'refund' ? 'danger' : 'primary'} loading={busy} disabled={!(Number(amount) > 0) || Number(amount) > max + 0.001}>
            {mode === 'refund' ? 'Refund' : 'Record payment'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Mini({ label, value, strong }) {
  return (
    <div className="rounded-2xl px-2 py-3" style={{ background: 'var(--wash)' }}>
      <p className="text-[11.5px] text-ink-3">{label}</p>
      <p className={cn('mt-0.5 truncate text-[14px] tabular', strong ? 'font-semibold' : 'font-medium')}>{value}</p>
    </div>
  );
}
