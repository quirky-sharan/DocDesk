import { useId, useMemo, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { useMeasure } from '../../hooks/useMeasure';
import { formatCompact, formatDate } from '../../lib/format';
import { labelIndexes, monotonePath, niceTicks } from './scale';
import ChartTooltip from './ChartTooltip';
import { EASE_OUT } from '../../lib/motion';

const PAD = { top: 18, right: 18, bottom: 30, left: 52 };

/**
 * One measure over time. A 2px line on a faint wash, a crosshair that snaps to
 * the nearest day wherever the pointer is (nobody aims at a 2px line), and the
 * same readout from the keyboard with the arrow keys. Draws itself in the first
 * time it scrolls into view.
 */
export default function AreaChart({
  data = [],
  valueKey = 'revenue',
  labelKey = 'day',
  height = 260,
  color = 'var(--series-1)',
  formatValue = (v) => formatCompact(v),
  formatAxis = (v) => formatCompact(v),
  formatLabel = (l) => formatDate(l, { day: 'numeric', month: 'short' }),
  formatTitle = (l) => formatDate(l, { weekday: 'short', day: 'numeric', month: 'short' }),
  title = 'Trend',
  extraRows,
}) {
  const [ref, { width }] = useMeasure();
  const gradientId = useId().replace(/:/g, '');
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const reduced = useReducedMotion();
  const [active, setActive] = useState(null);

  const geometry = useMemo(() => {
    const w = Math.max(width, 240);
    const plotW = w - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const values = data.map((d) => Number(d[valueKey]) || 0);
    const { ticks, top } = niceTicks(Math.max(...values, 0), 4);
    const x = (i) => PAD.left + (data.length > 1 ? (i / (data.length - 1)) * plotW : plotW / 2);
    const y = (v) => PAD.top + plotH - (v / top) * plotH;
    const points = values.map((v, i) => [x(i), y(v)]);
    const line = monotonePath(points);
    const base = PAD.top + plotH;
    const area = points.length ? `${line}L${points.at(-1)[0].toFixed(2)},${base}L${points[0][0].toFixed(2)},${base}Z` : '';
    return { w, plotW, plotH, values, ticks, x, y, points, line, area, base, labels: labelIndexes(data.length, plotW, 86) };
  }, [data, valueKey, width, height]);

  if (!data.length) {
    return <div className="grid place-items-center text-[13px] text-ink-3" style={{ height }}>Not enough data to chart yet.</div>;
  }

  const { w, plotW, values, ticks, x, y, points, line, area, base, labels } = geometry;

  function pick(clientX, rect) {
    const px = clientX - rect.left - PAD.left;
    const index = Math.round((px / plotW) * (data.length - 1));
    setActive(Math.min(Math.max(index, 0), data.length - 1));
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      setActive((i) => Math.min(Math.max((i ?? (step > 0 ? -1 : data.length)) + step, 0), data.length - 1));
    } else if (event.key === 'Escape') setActive(null);
  }

  const hovered = active !== null ? points[active] : null;
  const drawn = inView || reduced;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={w}
          height={height}
          className="block overflow-visible outline-none"
          role="img"
          aria-label={`${title}. Use the left and right arrow keys to read each value.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="70%" stopColor={color} stopOpacity="0.04" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={w - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--chart-grid)" strokeWidth="1" shapeRendering="crispEdges" />
              <text x={PAD.left - 10} y={y(tick) + 4} textAnchor="end" className="tabular" style={{ fontSize: 11, fill: 'var(--chart-axis)' }}>
                {formatAxis(tick)}
              </text>
            </g>
          ))}

          {labels.map((index) => (
            <text
              key={index}
              x={x(index)}
              y={height - 8}
              textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
              style={{ fontSize: 11, fill: 'var(--chart-axis)' }}
            >
              {formatLabel(data[index][labelKey])}
            </text>
          ))}

          <motion.path
            d={area}
            fill={`url(#${gradientId})`}
            initial={false}
            animate={{ d: area, opacity: drawn ? 1 : 0 }}
            transition={{ d: { duration: 0.6, ease: EASE_OUT }, opacity: { duration: 0.9, delay: drawn && !reduced ? 0.5 : 0 } }}
          />
          <motion.path
            key={data.length}
            d={line}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ d: line, pathLength: drawn ? 1 : 0 }}
            transition={{ pathLength: { duration: 1.4, ease: EASE_OUT }, d: { duration: 0.6, ease: EASE_OUT } }}
          />

          {hovered && (
            <g pointerEvents="none">
              <line x1={hovered[0]} x2={hovered[0]} y1={PAD.top} y2={base} stroke="var(--chart-axis)" strokeOpacity="0.5" strokeWidth="1" />
              <motion.circle
                initial={{ r: 0 }}
                animate={{ cx: hovered[0], cy: hovered[1], r: 5 }}
                transition={{ type: 'spring', stiffness: 700, damping: 40 }}
                fill={color}
                stroke="var(--chart-surface)"
                strokeWidth="2.5"
              />
            </g>
          )}

          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={base - PAD.top}
            fill="transparent"
            onPointerMove={(e) => pick(e.clientX, e.currentTarget.ownerSVGElement.getBoundingClientRect())}
            onPointerDown={(e) => pick(e.clientX, e.currentTarget.ownerSVGElement.getBoundingClientRect())}
            onPointerLeave={() => setActive(null)}
            style={{ cursor: 'crosshair' }}
          />
        </svg>
      )}

      <ChartTooltip
        visible={hovered !== null && active !== null}
        x={hovered ? hovered[0] : 0}
        y={hovered ? hovered[1] : 0}
        align={hovered && hovered[1] < 80 ? 'below' : 'above'}
        containerWidth={w}
        title={active !== null ? formatTitle(data[active][labelKey]) : ''}
        rows={
          active !== null
            ? [{ value: formatValue(values[active]), label: '' }, ...(extraRows ? extraRows(data[active]) : [])]
            : []
        }
      />
    </div>
  );
}
