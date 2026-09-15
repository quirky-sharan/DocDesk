import { useMemo, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { useMeasure } from '../../hooks/useMeasure';
import { formatCompact } from '../../lib/format';
import { labelIndexes, niceTicks } from './scale';
import ChartTooltip from './ChartTooltip';

const PAD = { top: 16, right: 12, bottom: 30, left: 48 };
const MAX_BAR = 24;

/**
 * Magnitude across a sequence (days of the week, weeks, months). Thin columns
 * capped at 24px with a rounded cap and a square foot, growing up from the
 * baseline one after another. Each column is its own hover target, wider than
 * the painted bar.
 */
export default function ColumnChart({
  data = [],
  valueKey = 'value',
  labelKey = 'label',
  height = 220,
  color = 'var(--series-1)',
  highlight,
  formatValue = (v) => formatCompact(v),
  formatLabel = (l) => l,
  formatTitle = (l) => l,
  extraRows,
}) {
  const [ref, { width }] = useMeasure();
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const reduced = useReducedMotion();
  const [active, setActive] = useState(null);

  const geometry = useMemo(() => {
    const w = Math.max(width, 200);
    const plotW = w - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const values = data.map((d) => Number(d[valueKey]) || 0);
    const { ticks, top } = niceTicks(Math.max(...values, 0), 4);
    const band = data.length ? plotW / data.length : plotW;
    const barWidth = Math.max(Math.min(MAX_BAR, band * 0.62), 3);
    return { w, plotW, plotH, values, ticks, top, band, barWidth, labels: labelIndexes(data.length, plotW, 44) };
  }, [data, valueKey, width, height]);

  if (!data.length) {
    return <div className="grid place-items-center text-[13px] text-ink-3" style={{ height }}>Not enough data to chart yet.</div>;
  }

  const { w, plotH, values, ticks, top, band, barWidth, labels } = geometry;
  const base = PAD.top + plotH;
  const y = (v) => base - (v / top) * plotH;
  const shown = inView || reduced;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={w} height={height} className="block overflow-visible" role="img" aria-label="Column chart">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={w - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--chart-grid)" strokeWidth="1" shapeRendering="crispEdges" />
              <text x={PAD.left - 10} y={y(tick) + 4} textAnchor="end" className="tabular" style={{ fontSize: 11, fill: 'var(--chart-axis)' }}>
                {formatCompact(tick)}
              </text>
            </g>
          ))}

          {data.map((row, i) => {
            const cx = PAD.left + band * i + band / 2;
            const value = values[i];
            const h = Math.max((value / top) * plotH, value > 0 ? 2 : 0);
            const r = Math.min(4, barWidth / 2, h);
            const x0 = cx - barWidth / 2;
            // Rounded data end, square foot on the baseline.
            const d = h
              ? `M${x0},${base}V${base - h + r}Q${x0},${base - h} ${x0 + r},${base - h}H${x0 + barWidth - r}Q${x0 + barWidth},${base - h} ${x0 + barWidth},${base - h + r}V${base}Z`
              : '';
            const isActive = active === i;
            const dim = active !== null && !isActive;
            const fill = highlight && highlight(row, i) ? color : highlight ? 'var(--series-other)' : color;
            return (
              <g key={i}>
                {d && (
                  <motion.path
                    d={d}
                    fill={fill}
                    style={{ transformOrigin: `${cx}px ${base}px` }}
                    initial={reduced ? false : { scaleY: 0 }}
                    animate={{ scaleY: shown ? 1 : 0, opacity: dim ? 0.45 : 1 }}
                    transition={{ scaleY: { type: 'spring', stiffness: 180, damping: 22, delay: reduced ? 0 : i * 0.035 }, opacity: { duration: 0.2 } }}
                  />
                )}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  tabIndex={0}
                  aria-label={`${formatTitle(row[labelKey])}: ${formatValue(value)}`}
                  style={{ outline: 'none' }}
                />
              </g>
            );
          })}

          {labels.map((i) => (
            <text key={i} x={PAD.left + band * i + band / 2} y={height - 8} textAnchor="middle" style={{ fontSize: 11, fill: 'var(--chart-axis)' }}>
              {formatLabel(data[i][labelKey])}
            </text>
          ))}
        </svg>
      )}
      <ChartTooltip
        visible={active !== null}
        x={active !== null ? PAD.left + band * active + band / 2 : 0}
        y={active !== null ? y(values[active]) : 0}
        align={active !== null && y(values[active]) < 70 ? 'below' : 'above'}
        containerWidth={w}
        title={active !== null ? formatTitle(data[active][labelKey]) : ''}
        rows={active !== null ? [{ value: formatValue(values[active]) }, ...(extraRows ? extraRows(data[active]) : [])] : []}
      />
    </div>
  );
}
