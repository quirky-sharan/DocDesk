import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Package, Search } from 'lucide-react';
import { useSettings } from '../../lib/settings';
import { cn } from '../../lib/cn';

/**
 * Type-to-find a product: matches name, code and category as you type, shows
 * stock and price, and works from the keyboard. Choosing "use as a description"
 * turns what you typed into a free-text line (a service, a one-off item).
 */
export default function ProductPicker({ products, value, description, onPick, onDescribe, placeholder = 'Find a product…', disableOutOfStock = true, autoFocus }) {
  const { money } = useSettings();
  const anchor = useRef(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState(null);
  const selected = products.find((p) => String(p.id) === String(value));

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    const list = q
      ? products.filter((p) => `${p.name} ${p.sku || ''} ${p.category || ''}`.toLowerCase().includes(q))
      : products;
    return list.slice(0, 40);
  }, [products, text]);

  useEffect(() => setActive(0), [text]);

  useEffect(() => {
    if (!open) return undefined;
    const update = () => setRect(anchor.current?.getBoundingClientRect() || null);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  function choose(product) {
    onPick(product);
    setText('');
    setOpen(false);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      if (!open) return;
      event.preventDefault();
      if (active < matches.length) {
        const product = matches[active];
        if (product && !(disableOutOfStock && product.stock_quantity <= 0)) choose(product);
      } else if (text.trim()) {
        onDescribe(text.trim());
        setOpen(false);
      }
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
    }
  }

  const shown = open ? text : selected ? selected.name : description || '';

  return (
    <div ref={anchor} className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
      <input
        className="input-field pl-9"
        value={shown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onFocus={() => { setOpen(true); setText(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.ul
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
              className="glass fixed z-[80] max-h-72 overflow-y-auto rounded-2xl p-1.5"
              style={{ top: rect.bottom + 6, left: rect.left, width: Math.max(rect.width, 320), background: 'var(--glass-strong)' }}
              role="listbox"
              data-lenis-prevent
            >
              {matches.map((product, index) => {
                const out = product.stock_quantity <= 0;
                const blocked = disableOutOfStock && out;
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      disabled={blocked}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(product)}
                      className={cn('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors', index === active && 'bg-[rgb(var(--c-accent)/0.12)]', blocked && 'opacity-45')}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: 'var(--wash-strong)' }}>
                        <Package size={14} className="text-ink-2" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{product.name}</span>
                        <span className="block truncate text-[12px] text-ink-3">{[product.sku, product.category].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-[13px] font-semibold tabular">{money(product.sale_price)}</span>
                        <span className={cn('block text-[11.5px] tabular', out ? 'text-danger' : product.reorder_level > 0 && product.stock_quantity <= product.reorder_level ? 'text-warning' : 'text-ink-3')}>
                          {out ? 'Out of stock' : `${Number(product.stock_quantity)} left`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {text.trim() && onDescribe && (
                <li>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(matches.length)}
                    onClick={() => { onDescribe(text.trim()); setOpen(false); }}
                    className={cn('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13.5px]', active === matches.length && 'bg-[rgb(var(--c-accent)/0.12)]')}
                  >
                    <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: 'var(--accent-soft)' }}>+</span>
                    Use "<span className="font-medium">{text.trim()}</span>" as a description
                  </button>
                </li>
              )}
              {!matches.length && !text.trim() && <li className="px-3 py-4 text-center text-[13px] text-ink-3">No products yet.</li>}
            </motion.ul>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
