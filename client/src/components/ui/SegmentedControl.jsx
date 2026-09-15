import { useId, useRef } from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/cn';
import { spring } from '../../lib/motion';

function normalise(option) {
  if (Array.isArray(option)) return { value: option[0], label: option[1], icon: option[2], count: option[3] };
  if (typeof option === 'object') return option;
  return { value: option, label: option };
}

/**
 * A row of mutually exclusive choices with a pill that slides to the selected
 * one. Clearer than a dropdown for three to six options, and one click instead
 * of two. Arrow keys move the selection, as in a native radio group.
 */
export default function SegmentedControl({ value, onChange, options, size = 'md', className, ariaLabel }) {
  const id = useId();
  const refs = useRef([]);
  const items = options.map(normalise);

  function onKeyDown(event, index) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + items.length) % items.length;
    onChange(items[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('scrollbar-none relative inline-flex max-w-full items-center overflow-x-auto rounded-full p-[3px]', className)}
      style={{ background: 'var(--wash-strong)', boxShadow: 'inset 0 0 0 1px var(--line)' }}
    >
      {items.map((item, index) => {
        const active = item.value === value;
        const Icon = item.icon;
        return (
          <button
            key={String(item.value)}
            ref={(el) => (refs.current[index] = el)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'relative isolate inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-colors duration-200',
              size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3.5 text-[13px]',
              active ? 'text-ink' : 'text-ink-2 hover:text-ink'
            )}
          >
            {active && (
              <motion.span
                layoutId={`segment-${id}`}
                className="absolute inset-0 -z-10 rounded-full"
                style={{ background: 'var(--segment-pill)', boxShadow: 'var(--segment-shadow)' }}
                transition={spring}
              />
            )}
            {Icon && <Icon size={size === 'sm' ? 13 : 14} strokeWidth={2.2} />}
            {item.label}
            {item.count !== undefined && item.count !== null && (
              <span className={cn('tabular rounded-full px-1.5 text-[11px] leading-[18px]', active ? 'bg-[var(--wash-strong)]' : 'bg-[var(--wash)]')}>
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
