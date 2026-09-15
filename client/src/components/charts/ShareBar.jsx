import { useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { formatNumber } from '../../lib/format';

// Fixed slot order, never cycled; a fifth category folds into "Other".
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
export const OTHER_COLOR = 'var(--series-other)';

export function seriesColor(index) {
  return index < SERIES.length ? SERIES[index] : OTHER_COLOR;
}

/**
 * Share of a whole as one stacked bar. A 2px gap in the surface colour separates
 * segments; every segment is named with its percentage in the legend, so
 * identity never rests on colour alone (two of the light-mode slots sit under
 * 3:1 contrast - the labels are the relief). Hovering a segment or its legend
 * row isolates it.
 */
export default function ShareBar({ rows = [], labelKey = 'label', valueKey = 'value', formatValue = formatNumber }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const reduced = useReducedMotion();
  const [active, setActive] = useState(null);

  const total = rows.reduce((sum, r) => sum + (Number(r[valueKey]) || 0), 0);
  if (!rows.length || total <= 0) {
    return <div className="grid h-24 place-items-center text-[13px] text-ink-3">Not enough data to chart yet.</div>;
  }

  const shown = rows.slice(0, 4);
  const rest = rows.slice(4);
  const segments = rest.length
    ? [...shown, { [labelKey]: 'Other', [valueKey]: rest.reduce((s, r) => s + (Number(r[valueKey]) || 0), 0) }]
    : shown;

  return (
    <div ref={ref}>
      <div className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Share of total">
        {segments.map((seg, i) => {
          const pct = ((Number(seg[valueKey]) || 0) / total) * 100;
          const label = seg[labelKey];
          return (
            <motion.div
              key={label}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ background: i < 4 ? seriesColor(i) : OTHER_COLOR, opacity: active && active !== label ? 0.35 : 1, transition: 'opacity 200ms' }}
              initial={reduced ? false : { width: 0 }}
              animate={{ width: inView || reduced ? `${pct}%` : 0 }}
              transition={{ type: 'spring', stiffness: 80, damping: 20, delay: reduced ? 0 : i * 0.08 }}
              onPointerEnter={() => setActive(label)}
              onPointerLeave={() => setActive(null)}
              title={`${label}: ${formatValue(seg[valueKey])} (${pct.toFixed(0)}%)`}
            />
          );
        })}
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {segments.map((seg, i) => {
          const pct = ((Number(seg[valueKey]) || 0) / total) * 100;
          const label = seg[labelKey];
          return (
            <li
              key={label}
              className="flex items-center gap-2.5 rounded-lg text-[13px] transition-opacity"
              style={{ opacity: active && active !== label ? 0.5 : 1 }}
              onPointerEnter={() => setActive(label)}
              onPointerLeave={() => setActive(null)}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: i < 4 ? seriesColor(i) : OTHER_COLOR }} />
              <span className="min-w-0 flex-1 truncate capitalize text-ink-2">{label}</span>
              <span className="shrink-0 text-ink-3 tabular">{formatValue(seg[valueKey])}</span>
              <span className="w-10 shrink-0 text-right font-medium text-ink tabular">{pct.toFixed(0)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
