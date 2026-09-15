import { useEffect, useState } from 'react';
import { api, fileContentUrl } from '../api/client';
import { Modal, ErrorNote, Table, Badge, Money } from './ui';
import { Sparkline } from './charts';

/** Everything about one product in one place: how it sells, what is on its way. */
export default function ProductDetail({ productId, onClose, onEdit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.products
      .history(productId)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [productId]);

  const product = data?.product;
  const margin =
    product && Number(product.sale_price) > 0
      ? Math.round(((product.sale_price - product.cost_price) / product.sale_price) * 100)
      : null;

  return (
    <Modal title={product?.name || 'Product'} onClose={onClose} wide>
      <ErrorNote error={error} />
      {!data && !error && <p className="muted">Loading…</p>}

      {data && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            {product.sku && <Badge>{product.sku}</Badge>}
            {product.category && <Badge tone="blue">{product.category}</Badge>}
            <Badge tone={product.stock_quantity <= 0 ? 'red' : product.stock_quantity <= product.reorder_level ? 'amber' : 'green'}>
              {product.stock_quantity} in stock
            </Badge>
            <button className="btn-secondary ml-auto" onClick={() => onEdit(product)}>Edit product</button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Units sold" value={data.unitsSold} />
            <Figure label="Revenue" value={Number(data.revenue).toFixed(2)} />
            <Figure label="Sells for" value={Number(product.sale_price).toFixed(2)}
                    meta={margin !== null ? `${margin}% margin` : null} />
            <Figure label="Costs you" value={Number(product.cost_price).toFixed(2)}
                    meta={`reorder at ${product.reorder_level}`} />
          </div>

          {data.trend.length > 1 && (
            <div className="rounded-lg border border-token p-4">
              <p className="mb-2 text-sm font-medium">Units sold per day</p>
              <Sparkline values={data.trend.map((t) => t.units)} width={560} height={48} />
              <p className="mt-1 text-xs subtle">
                {data.trend[0].day} to {data.trend.at(-1).day}
              </p>
            </div>
          )}

          {data.incoming.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">On its way</p>
              <Table
                columns={[
                  { key: 'reference', label: 'Order' },
                  { key: 'status', label: 'Status', render: (r) => <Badge tone="blue">{r.status}</Badge> },
                  { key: 'expected_date', label: 'Expected', render: (r) => r.expected_date || '—' },
                  {
                    key: 'quantity',
                    label: 'Arriving',
                    align: 'right',
                    render: (r) => `${Number(r.quantity) - Number(r.quantity_received)} of ${r.quantity}`,
                  },
                ]}
                rows={data.incoming}
                empty="Nothing on order."
              />
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-medium">Recent sales</p>
            <Table
              columns={[
                { key: 'reference', label: 'Receipt' },
                { key: 'created_at', label: 'When', render: (r) => new Date(r.created_at).toLocaleDateString() },
                { key: 'quantity', label: 'Qty', align: 'right' },
                { key: 'line_total', label: 'Amount', align: 'right', render: (r) => <Money value={r.line_total} /> },
              ]}
              rows={data.sales}
              empty="This product hasn't sold yet."
            />
          </div>

          {data.files.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">Attached files</p>
              <ul className="space-y-1 text-sm">
                {data.files.map((f) => (
                  <li key={f.id}>
                    <a className="link hover:underline" href={fileContentUrl(f.id)}>
                      {f.original_name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Figure({ label, value, meta }) {
  return (
    <div className="rounded-lg border border-token p-3">
      <p className="text-xl font-semibold">{value}</p>
      <p className="text-sm muted">{label}</p>
      {meta && <p className="mt-1 text-xs subtle">{meta}</p>}
    </div>
  );
}
