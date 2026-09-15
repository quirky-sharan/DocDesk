import { useCallback, useEffect, useState } from 'react';
import { api, receiptPdfUrl } from '../api/client';
import { useList } from '../hooks/useList';
import {
  PageHeader, ErrorNote, Table, Modal, Field, Badge, Money,
  ConfirmButton, ExportButtons, SearchInput, Select, Pagination,
} from '../components/ui';

const STATUS_TONE = { paid: 'green', unpaid: 'red', partial: 'amber', refunded: 'slate' };

export default function SalesPage() {
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const fetcher = useCallback((params) => api.sales.list(params), []);
  const list = useList(fetcher, {
    initialSort: 'created_at',
    initialDir: 'desc',
    filters: { payment_status: status, from, to },
  });

  async function remove(id) {
    try {
      await api.sales.remove(id);
      await list.reload();
    } catch (err) {
      list.setError(err.message);
    }
  }

  // Settling up is the most common thing anyone does to an existing sale, so it
  // is one click from the list rather than buried in an edit form.
  async function markPaid(sale) {
    try {
      await api.sales.update(sale.id, { payment_status: 'paid' });
      await list.reload();
    } catch (err) {
      list.setError(err.message);
    }
  }

  const columns = [
    { key: 'reference', label: 'Receipt', render: (s) => <span className="font-medium">{s.reference}</span> },
    { key: 'created_at', label: 'When', render: (s) => new Date(s.created_at).toLocaleString() },
    { key: 'customer_name', label: 'Customer', render: (s) => s.customer_name || 'Walk-in' },
    { key: 'payment_status', label: 'Payment', render: (s) => (
      <Badge tone={STATUS_TONE[s.payment_status] || 'slate'}>{s.payment_status}</Badge>
    ) },
    { key: 'total', label: 'Total', align: 'right', render: (s) => <Money value={s.total} /> },
    { key: 'actions', label: '', sortable: false, align: 'right', render: (s) => (
      <div className="flex justify-end gap-2">
        {s.payment_status !== 'paid' && s.payment_status !== 'refunded' && (
          <button className="btn-edit" onClick={() => markPaid(s)}>Mark paid</button>
        )}
        <button className="btn-edit" onClick={() => setViewing(s.id)}>Receipt</button>
        <ConfirmButton
          message={`Delete ${s.reference}? The items will go back into stock.`}
          onConfirm={() => remove(s.id)}
        >
          Delete
        </ConfirmButton>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Sales" subtitle="Every sale, and the receipt for it.">
        <ExportButtons table="sales" params={{ search: list.search, sort: list.sort, dir: list.dir }} />
        <button className="btn-primary" onClick={() => setCreating(true)}>New sale</button>
      </PageHeader>

      <ErrorNote error={list.error} onDismiss={() => list.setError(null)} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search receipt or customer…" />
        <Select
          value={status}
          onChange={setStatus}
          options={[['paid', 'Paid'], ['unpaid', 'Unpaid'], ['partial', 'Part paid'], ['refunded', 'Refunded']]}
          placeholder="Any payment"
        />
        <label className="flex items-center gap-2 text-sm muted">
          From
          <input type="date" className="input-field" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm muted">
          To
          <input type="date" className="input-field" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(status || from || to || list.search) && (
          <button className="btn-secondary" onClick={() => {
            setStatus(''); setFrom(''); setTo(''); list.setSearch('');
          }}>Clear filters</button>
        )}
        {list.loading && <span className="text-sm subtle">Loading…</span>}
      </div>

      <Table
        columns={columns}
        rows={list.rows}
        sort={list.sort}
        dir={list.dir}
        onSort={list.toggleSort}
        empty={list.search || status || from || to ? 'No sales match that.' : 'No sales yet. Record your first one.'}
      />
      <Pagination meta={list.meta} page={list.page} onPage={list.setPage} loading={list.loading} />

      {creating && (
        <NewSale
          onClose={() => setCreating(false)}
          onDone={async (sale) => {
            setCreating(false);
            await list.reload();
            setViewing(sale.id);
          }}
        />
      )}
      {viewing && <ReceiptModal saleId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function NewSale({ onClose, onDone }) {
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [lines, setLines] = useState([{ product_id: '', description: '', quantity: 1, unit_price: '' }]);
  const [customerId, setCustomerId] = useState('');
  const [discount, setDiscount] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('paid');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      api.products.list({ pageSize: 200 }),
      api.customers.list({ pageSize: 200 }),
      api.settings.get(),
    ])
      .then(([p, c, s]) => {
        setProducts(p.rows);
        setCustomers(c.rows);
        // Pre-fill the shop's usual tax rate; still editable per sale.
        const rate = Number(s.values.default_tax_rate || 0);
        if (rate > 0) setTaxRate(String(rate));
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
      // Prefill the price from the catalogue, but leave it editable for
      // discounts negotiated at the counter.
      unit_price: product ? product.sale_price : '',
      description: product ? product.name : '',
    });
  }

  const subtotal = lines.reduce(
    (sum, l) => sum + Number(l.quantity || 0) * Number(l.unit_price || 0),
    0
  );
  const afterDiscount = Math.max(0, subtotal - Number(discount || 0));
  const tax = (afterDiscount * Number(taxRate || 0)) / 100;
  const total = afterDiscount + tax;

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
        payment_method: paymentMethod,
        items: lines
          .filter((l) => l.product_id || l.description)
          .map((l) => ({
            product_id: l.product_id || null,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price === '' ? undefined : l.unit_price,
          })),
      });
      await onDone(sale);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New sale" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <ErrorNote error={error} onDismiss={() => setError(null)} />

        <Field label="Customer" hint="Leave blank for a walk-in">
          <select className="input-field" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Walk-in customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>

        <div>
          <p className="mb-2 text-sm font-medium">Items</p>
          <div className="space-y-2">
            {lines.map((line, index) => {
              const product = products.find((p) => String(p.id) === String(line.product_id));
              const short = product && Number(line.quantity) > product.stock_quantity;
              return (
                <div key={index} className="rounded-lg border border-token p-3">
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-12 sm:col-span-5">
                      <select
                        className="input-field"
                        value={line.product_id}
                        onChange={(e) => pickProduct(index, e.target.value)}
                      >
                        <option value="">— Something not in the list —</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id} disabled={p.stock_quantity <= 0}>
                            {p.name} ({p.stock_quantity} left)
                          </option>
                        ))}
                      </select>
                      {!line.product_id && (
                        <input
                          className="input-field mt-2"
                          placeholder="Describe what was sold"
                          value={line.description}
                          onChange={(e) => updateLine(index, { description: e.target.value })}
                        />
                      )}
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <input
                        className="input-field" type="number" min="0.01" step="any" placeholder="Qty"
                        value={line.quantity}
                        onChange={(e) => updateLine(index, { quantity: e.target.value })}
                      />
                    </div>
                    <div className="col-span-5 sm:col-span-3">
                      <input
                        className="input-field" type="number" min="0" step="0.01" placeholder="Price"
                        value={line.unit_price}
                        onChange={(e) => updateLine(index, { unit_price: e.target.value })}
                      />
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
                  {short && (
                    <p className="mt-2 text-sm text-danger">
                      Only {product.stock_quantity} of {product.name} in stock.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="btn-secondary mt-2"
            onClick={() => setLines([...lines, { product_id: '', description: '', quantity: 1, unit_price: '' }])}
          >
            Add another item
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Discount">
            <input className="input-field" type="number" min="0" step="0.01" value={discount}
                   onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Tax %">
            <input className="input-field" type="number" min="0" max="100" step="0.01" value={taxRate}
                   onChange={(e) => setTaxRate(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Payment">
            <select className="input-field" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Part paid</option>
            </select>
          </Field>
          <Field label="Method">
            <select className="input-field" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="upi">UPI</option>
              <option value="bank">Bank transfer</option>
            </select>
          </Field>
        </div>

        <div className="rounded-lg bg-sunken p-4 text-sm">
          <Row label="Subtotal" value={subtotal} />
          {Number(discount) > 0 && <Row label="Discount" value={-Number(discount)} />}
          {Number(taxRate) > 0 && <Row label={`Tax (${taxRate}%)`} value={tax} />}
          <div className="mt-2 flex justify-between border-t border-token pt-2 text-lg font-semibold">
            <span>Total</span>
            <span>{total.toFixed(2)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || subtotal <= 0}>
            {busy ? 'Recording…' : 'Record sale'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between muted">
      <span>{label}</span>
      <span>{Number(value).toFixed(2)}</span>
    </div>
  );
}

function ReceiptModal({ saleId, onClose }) {
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.sales.receipt(saleId).then(setReceipt).catch((err) => setError(err.message));
  }, [saleId]);

  return (
    <Modal title="Receipt" onClose={onClose}>
      <ErrorNote error={error} />
      {!receipt && !error && <p className="muted">Loading…</p>}
      {receipt && (
        <div>
          <div className="border-b border-token pb-3">
            <p className="text-lg font-semibold">{receipt.reference}</p>
            <p className="text-sm muted">{new Date(receipt.issuedAt).toLocaleString()}</p>
            {receipt.customer && <p className="mt-2 text-sm">Billed to {receipt.customer.name}</p>}
          </div>

          <table className="my-4 w-full text-sm">
            <tbody>
              {receipt.items.map((item, i) => (
                <tr key={i}>
                  <td className="py-1">{item.description}</td>
                  <td className="py-1 text-right muted">
                    {item.quantity} × {item.unitPrice.toFixed(2)}
                  </td>
                  <td className="py-1 text-right">{item.lineTotal.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t border-token pt-3 text-sm">
            <Row label="Subtotal" value={receipt.totals.subtotal} />
            {receipt.totals.discount > 0 && <Row label="Discount" value={-receipt.totals.discount} />}
            {receipt.totals.tax > 0 && <Row label="Tax" value={receipt.totals.tax} />}
            <div className="mt-2 flex justify-between text-lg font-semibold">
              <span>Total</span>
              <span>{receipt.totals.total.toFixed(2)}</span>
            </div>
            <p className="mt-2 muted">
              Paid by {receipt.payment.method || '—'} · {receipt.payment.status}
            </p>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>Close</button>
            <a className="btn-primary" href={receiptPdfUrl(saleId)}>Download PDF</a>
          </div>
        </div>
      )}
    </Modal>
  );
}
