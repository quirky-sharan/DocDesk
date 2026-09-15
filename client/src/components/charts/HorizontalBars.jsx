import { useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { formatNumber } from '../../lib/format';
import { cn } from '../../lib/cn';

/**
 * Magnitude across named things (products, categories). One hue - the names are
 * labelled, so colour would only decorate. Value sits at the end of each label;
 * bars grow in one after another the first time they're seen.
 */
export default function HorizontalBars({
  rows = [],
  labelKey = 'label',
  valueKey = 'value',
  formatValue = formatNumber,
  meta,
  color = 'var(--series-1)',
  onSelect,
  limit,
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const reduced = useReducedMotion();
  const [active, setActive] = useState(null);
  const shownRows = limit ? rows.slice(0, limit) : rows;

  if (!shownRows.length) {
    return <div className="grid h-32 place-items-center text-[13px] text-ink-3">Not enough data to chart yet.</div>;
  }

  const max = Math.max(...shownRows.map((r) => Number(r[valueKey]) || 0), 1);

  return (
    <ul ref={ref} className="space-y-3.5">
      {shownRows.map((row, i) => {
        const value = Number(row[valueKey]) || 0;
        const pct = Math.max((value / max) * 100, value > 0 ? 1.5 : 0);
        const Component = onSelect ? 'button' : 'div';
        return (
          <li key={`${row[labelKey]}-${i}`}>
            <Component
              type={onSelect ? 'button' : undefined}
              onClick={onSelect ? () => onSelect(row) : undefined}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              className={cn('block w-full text-left', onSelect && 'rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--c-accent)/0.5)]')}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13.5px]">
                <span className={cn('min-w-0 truncate transition-colors', active === i ? 'text-ink' : 'text-ink-2')}>
                  {row[labelKey]}
                  {meta && <span className="ml-2 text-[12px] text-ink-3">{meta(row)}</span>}
                </span>
                <span className="shrink-0 font-medium text-ink tabular">{formatValue(value)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-r-full" style={{ background: 'var(--chart-track)' }}>
                <motion.div
                  className="h-full rounded-r-[4px]"
                  style={{ background: color, opacity: active === null || active === i ? 1 : 0.5, transition: 'opacity 200ms' }}
                  initial={reduced ? false : { width: 0 }}
                  animate={{ width: inView || reduced ? `${pct}%` : 0 }}
                  transition={{ type: 'spring', stiffness: 90, damping: 20, delay: reduced ? 0 : 0.08 + i * 0.06 }}
                />
              </div>
            </Component>
          </li>
        );
      })}
    </ul>
  );
}
