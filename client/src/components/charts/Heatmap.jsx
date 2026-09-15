import { useMemo, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { formatNumber } from '../../lib/format';

const DAYS = [
  [1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun'],
];
const STEPS = 6;

function hourLabel(hour) {
  const h = hour % 24;
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

/**
 * When the shop is busy: days down the side, hours across, darker is busier. One
 * sequential hue, so more always reads as more; the empty step recedes into the
 * surface. Every cell reads out on hover, and the numbers are also in the table
 * view on the Reports page.
 */
export default function Heatmap({ cells = [], metric = 'count', formatValue = formatNumber, unit = 'sales' }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const reduced = useReducedMotion();
  const [active, setActive] = useState(null);

  const { grid, hours, max } = useMemo(() => {
    const map = new Map();
    let lo = 24;
    let hi = -1;
    let peak = 0;
    for (const cell of cells) {
      const value = Number(cell[metric]) || 0;
      map.set(`${cell.dow}-${cell.hour}`, cell);
      if (value > 0) {
        lo = Math.min(lo, cell.hour);
        hi = Math.max(hi, cell.hour);
        peak = Math.max(peak, value);
      }
    }
    // Always show a sensible working day, widened to cover any late or early trade.
    const start = Math.min(lo, 9);
    const end = Math.max(hi, 18);
    const hourList = [];
    for (let h = start; h <= end; h++) hourList.push(h);
    return { grid: map, hours: hourList, max: peak };
  }, [cells, metric]);

  const step = (value) => (value <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((value / max) * STEPS)));
  const activeCell = active ? grid.get(active) : null;
  const [activeDow, activeHour] = active ? active.split('-').map(Number) : [];

  return (
    <div ref={ref} className="relative">
      <div className="overflow-x-auto pb-1">
        <div
          className="grid min-w-[520px] gap-[3px]"
          style={{ gridTemplateColumns: `40px repeat(${hours.length}, minmax(0, 1fr))` }}
          role="grid"
          aria-label={`Sales by day of week and hour`}
          onPointerLeave={() => setActive(null)}
        >
          <div />
          {hours.map((h, i) => (
            <div key={h} className="pb-1 text-center text-[10.5px] text-ink-3 tabular">
              {i % 2 === 0 ? hourLabel(h) : ''}
            </div>
          ))}

          {DAYS.map(([dow, name], row) => (
            <div key={dow} className="contents" role="row">
              <div className="flex items-center text-[11.5px] font-medium text-ink-3">{name}</div>
              {hours.map((h, col) => {
                const key = `${dow}-${h}`;
                const cell = grid.get(key);
                const value = Number(cell?.[metric]) || 0;
                const s = step(value);
                const isActive = active === key;
                return (
                  <motion.button
                    key={key}
                    type="button"
                    role="gridcell"
                    aria-label={`${name} ${hourLabel(h)}: ${formatValue(value)} ${unit}`}
                    onPointerEnter={() => setActive(key)}
                    onFocus={() => setActive(key)}
                    onBlur={() => setActive(null)}
                    initial={reduced ? false : { opacity: 0, scale: 0.4 }}
                    animate={inView || reduced ? { opacity: 1, scale: isActive ? 1.12 : 1 } : { opacity: 0, scale: 0.4 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 26, delay: isActive || reduced ? 0 : (row + col) * 0.012 }}
                    className="relative h-7 rounded-[5px] outline-none"
                    style={{
                      background: `var(--seq-${s})`,
                      boxShadow: isActive ? '0 0 0 2px rgb(var(--c-text)), 0 4px 12px -2px rgb(0 0 0 / 0.25)' : 'inset 0 0 0 1px var(--line)',
                      zIndex: isActive ? 2 : 1,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-h-[20px] text-[13px]">
          {activeCell || active ? (
            <span>
              <span className="font-semibold text-ink tabular">{formatValue(Number(activeCell?.[metric]) || 0)}</span>{' '}
              <span className="text-ink-2">
                {unit} · {DAYS.find(([d]) => d === activeDow)?.[1]} {hourLabel(activeHour)}–{hourLabel(activeHour + 1)}
                {activeCell && metric !== 'count' && activeCell.count !== undefined ? ` · ${activeCell.count} sales` : ''}
              </span>
            </span>
          ) : (
            <span className="text-ink-3">Hover a square to read it.</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
          Quiet
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className="h-3 w-3 rounded-[3px]" style={{ background: `var(--seq-${i + 1})` }} />
          ))}
          Busy
        </div>
      </div>
    </div>
  );
}
