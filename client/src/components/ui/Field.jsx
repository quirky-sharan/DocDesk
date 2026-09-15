import { useRef } from 'react';
import { Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/cn';

export function Field({ label, hint, error, className, children }) {
  return (
    <label className={cn('block', className)}>
      {label && <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>}
      {children}
      {error ? (
        <span className="mt-1.5 block text-[12px] text-bad">{error}</span>
      ) : (
        hint && <span className="mt-1.5 block text-[12px] text-ink-3">{hint}</span>
      )}
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className, autoFocus }) {
  const ref = useRef(null);
  return (
    <div className={cn('relative w-full max-w-xs flex-1', className)}>
      <Search size={15} strokeWidth={2.2} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
      <input
        ref={ref}
        type="search"
        className="input-field rounded-full pl-10 pr-9"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.stopPropagation();
            onChange('');
          }
        }}
      />
      <AnimatePresence>
        {value && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            onClick={() => {
              onChange('');
              ref.current?.focus();
            }}
            className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:bg-[var(--wash-strong)] hover:text-ink"
            aria-label="Clear search"
          >
            <X size={13} strokeWidth={2.5} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Select({ value, onChange, options, placeholder, className }) {
  return (
    <select className={cn('input-field w-auto min-w-[150px] max-w-[220px] rounded-full', className)} value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => {
        const [val, label] = Array.isArray(opt) ? opt : [opt, opt];
        return (
          <option key={val} value={val}>
            {label}
          </option>
        );
      })}
    </select>
  );
}
