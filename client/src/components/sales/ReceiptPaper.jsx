import { motion } from 'motion/react';
import { useSettings } from '../../lib/settings';
import { formatDateTime } from '../../lib/format';

const METHOD = { cash: 'Cash', card: 'Card', upi: 'UPI', bank: 'Bank transfer', other: 'Other' };
const STATUS = { paid: 'Paid', unpaid: 'Unpaid', partial: 'Part paid', refunded: 'Refunded' };

// Zig-zag torn edges, drawn with a mask so the paper sits on any background.
const TORN = {
  WebkitMaskImage:
    'linear-gradient(#000 0 0) center / 100% calc(100% - 20px) no-repeat, conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% calc(100% - 0px) / 16px 10px repeat-x, conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) 50% 0 / 16px 10px repeat-x',
  maskImage:
    'linear-gradient(#000 0 0) center / 100% calc(100% - 20px) no-repeat, conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% calc(100% - 0px) / 16px 10px repeat-x, conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) 50% 0 / 16px 10px repeat-x',
};

/**
 * A receipt that looks like one: warm paper, torn edges, monospace totals. When
 * `printing` it feeds out from the top like a till roll.
 */
export default function ReceiptPaper({ receipt, printing = false, compact = false }) {
  const { money, values } = useSettings();
  const business = receipt.business || { name: values.business_name, address: values.business_address, footer: values.receipt_footer };

  const body = (
    <div className="relative px-6 py-7 text-[#26221c]" style={{ ...TORN, background: 'linear-gradient(180deg, #fffdf7, #fbf6ea)', filter: 'drop-shadow(0 18px 30px rgb(0 0 0 / 0.18))' }}>
      <div className="text-center">
        <p className="text-[17px] font-semibold tracking-[-0.01em]">{business.name || 'Receipt'}</p>
        {business.address && <p className="mt-0.5 whitespace-pre-line text-[11.5px] text-[#6d6557]">{business.address}</p>}
        {(business.phone || business.email) && <p className="text-[11.5px] text-[#6d6557]">{[business.phone, business.email].filter(Boolean).join(' · ')}</p>}
      </div>

      <div className="my-4 border-t border-dashed border-[#d9cfbb]" />
      <div className="flex justify-between font-mono text-[11.5px] text-[#6d6557]">
        <span>{receipt.reference || 'New sale'}</span>
        <span>{receipt.issuedAt ? formatDateTime(receipt.issuedAt) : 'now'}</span>
      </div>
      {receipt.customer?.name && <p className="mt-1 font-mono text-[11.5px] text-[#6d6557]">Billed to {receipt.customer.name}</p>}
      <div className="my-3 border-t border-dashed border-[#d9cfbb]" />

      <ul className={compact ? 'max-h-48 space-y-1.5 overflow-y-auto pr-1' : 'space-y-1.5'} data-lenis-prevent>
        {receipt.items.length === 0 && <li className="py-4 text-center font-mono text-[12px] text-[#a0967f]">Add an item to begin</li>}
        {receipt.items.map((item, i) => (
          <motion.li key={`${item.description}-${i}`} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="font-mono text-[12px]">
            <div className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{item.description}</span>
              <span className="tabular">{money(item.lineTotal)}</span>
            </div>
            <div className="text-[11px] text-[#8a8170]">{item.quantity} × {money(item.unitPrice)}</div>
          </motion.li>
        ))}
      </ul>

      <div className="my-3 border-t border-dashed border-[#d9cfbb]" />
      <dl className="space-y-1 font-mono text-[12px]">
        <Row label="Subtotal" value={money(receipt.totals.subtotal)} />
        {receipt.totals.discount > 0 && <Row label="Discount" value={`−${money(receipt.totals.discount)}`} />}
        {receipt.totals.tax > 0 && <Row label={`Tax${receipt.totals.taxRate ? ` (${receipt.totals.taxRate}%)` : ''}`} value={money(receipt.totals.tax)} />}
      </dl>
      <div className="mt-2 flex items-baseline justify-between border-t border-[#26221c] pt-2">
        <span className="text-[13px] font-semibold uppercase tracking-[0.12em]">Total</span>
        <span className="font-mono text-[20px] font-semibold tabular">{money(receipt.totals.total)}</span>
      </div>
      {receipt.payment && (
        <dl className="mt-2 space-y-1 font-mono text-[11.5px] text-[#6d6557]">
          <Row label={`${STATUS[receipt.payment.status] || receipt.payment.status}${receipt.payment.method ? ` · ${METHOD[receipt.payment.method] || receipt.payment.method}` : ''}`} value={receipt.totals.paid !== undefined ? `paid ${money(receipt.totals.paid)}` : ''} />
          {receipt.totals.balance > 0 && <Row label="Balance due" value={money(receipt.totals.balance)} strong />}
        </dl>
      )}
      {business.footer && <p className="mt-5 text-center text-[11px] leading-relaxed text-[#8a8170]">{business.footer}</p>}
      <div className="mx-auto mt-4 h-8 w-40 opacity-70" style={{ background: 'repeating-linear-gradient(90deg, #26221c 0 2px, transparent 2px 4px, #26221c 4px 5px, transparent 5px 8px)' }} aria-hidden="true" />
    </div>
  );

  if (!printing) return body;
  return (
    <div className="overflow-hidden">
      <motion.div initial={{ y: '-100%' }} animate={{ y: 0 }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}>
        {body}
      </motion.div>
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'font-semibold text-[#26221c]' : ''}`}>
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
