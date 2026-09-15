import { useId, useMemo, useState } from 'react';

// Fixed slot order, never cycled. A fifth category folds into "Other" rather
// than inventing a hue - see the palette note in index.css.
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
export const OTHER_COLOR = 'var(--series-other)';

export function seriesColor(index) {
  return index < SERIES.length ? SERIES[index] : OTHER_COLOR;
}

function formatCompact(n) {
  const value = Number(n || 0);
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

function niceCeiling(max) {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / magnitude) * magnitude;
}

/**
 * Revenue over time. One series, so no legend - the heading names it.
 * Crosshair and tooltip follow the pointer across the whole plot rather than
 * requiring a hit on the 1px line.
 */
export function AreaChart({ series, height = 220, valueKey = 'revenue', labelKey = 'day', formatValue }) {
  const gradientId = useId();
  const [hover, setHover] = useState(null);

  const format = formatValue || ((v) => Number(v).toFixed(2));
  const width = 720;
  const pad = { top: 12, right: 12, bottom: 26, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const { points, max, ticks } = useMemo(() => {
    const values = series.map((d) => Number(d[valueKey]) || 0);
    const ceiling = niceCeiling(Math.max(...values, 0));
    const step = series.length > 1 ? plotW / (series.length - 1) : 0;
    return {
      max: ceiling,
      points: series.map((d, i) => ({
        ...d,
        x: pad.left + i * step,
        y: pad.top + plotH - ((Number(d[valueKey]) || 0) / ceiling) * plotH,
      })),
      ticks: [0, 0.25, 0.5, 0.75, 1].map((t) => ({
        value: ceiling * t,
        y: pad.top + plotH - plotH * t,
      })),
    };
  }, [series, valueKey, plotW, plotH, pad.left, pad.top]);

  if (!series.length) return <Empty />;

  const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${points.at(-1).x.toFixed(1)},${pad.top + plotH} L${points[0].x.toFixed(1)},${pad.top + plotH} Z`;

  function handleMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    let nearest = points[0];
    for (const p of points) {
      if (Math.abs(p.x - x) < Math.abs(nearest.x - x)) nearest = p;
    }
    setHover(nearest);
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Revenue over time"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t.y}>
            <line x1={pad.left} x2={width - pad.right} y1={t.y} y2={t.y}
                  stroke="var(--chart-grid)" strokeWidth="1" />
            <text x={pad.left - 8} y={t.y + 4} textAnchor="end"
                  className="fill-slate-400" style={{ fontSize: 10 }}>
              {formatCompact(t.value)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={linePath} fill="none" stroke="var(--series-1)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />

        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={pad.top} y2={pad.top + plotH}
                  stroke="var(--chart-axis)" strokeWidth="1" strokeDasharray="3 3" />
            {/* 2px surface ring so the marker reads against the fill beneath it */}
            <circle cx={hover.x} cy={hover.y} r="5" fill="var(--series-1)"
                    stroke="var(--chart-surface)" strokeWidth="2" />
          </g>
        )}

        {points.length > 1 && (
          <>
            <text x={pad.left} y={height - 8} className="fill-slate-400" style={{ fontSize: 10 }}>
              {points[0][labelKey]}
            </text>
            <text x={width - pad.right} y={height - 8} textAnchor="end"
                  className="fill-slate-400" style={{ fontSize: 10 }}>
              {points.at(-1)[labelKey]}
            </text>
          </>
        )}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{ left: `${(hover.x / width) * 100}%`, top: `${(hover.y / height) * 100}%` }}
        >
          <div className="font-medium">{hover[labelKey]}</div>
          <div className="text-slate-300">{format(hover[valueKey])}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Magnitude across named categories. One hue, because the categories are
 * labelled - colour would be decoration, not information.
 */
export function HorizontalBars({ rows, labelKey = 'label', valueKey = 'value', formatValue, color = 'var(--series-1)' }) {
  const format = formatValue || ((v) => Number(v).toFixed(2));
  if (!rows.length) return <Empty />;
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);

  return (
    <ul className="space-y-2.5">
      {rows.map((row, i) => {
        const value = Number(row[valueKey]) || 0;
        const pct = (value / max) * 100;
        return (
          <li key={row[labelKey] ?? i}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-slate-700">{row[labelKey]}</span>
              <span className="shrink-0 font-medium text-slate-900">{format(value)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${Math.max(pct, 1.5)}%`, background: color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Share of a whole, as one stacked bar. Segments carry a 2px surface gap so
 * adjacent fills stay separable, and every segment is named in the legend -
 * identity is never colour alone.
 */
export function ShareBar({ rows, labelKey = 'label', valueKey = 'value', formatValue }) {
  const [hover, setHover] = useState(null);
  const format = formatValue || ((v) => Number(v).toFixed(2));

  const total = rows.reduce((sum, r) => sum + (Number(r[valueKey]) || 0), 0);
  if (!rows.length || total <= 0) return <Empty />;

  // Beyond four named slots, the tail folds into one "Other" rather than
  // inventing hues that no longer separate.
  const shown = rows.slice(0, 4);
  const rest = rows.slice(4);
  const segments = rest.length
    ? [...shown, { [labelKey]: 'Other', [valueKey]: rest.reduce((s, r) => s + Number(r[valueKey] || 0), 0) }]
    : shown;

  return (
    <div>
      <div className="flex h-8 w-full gap-[2px] overflow-hidden rounded-lg">
        {segments.map((seg, i) => {
          const pct = ((Number(seg[valueKey]) || 0) / total) * 100;
          return (
            <div
              key={seg[labelKey]}
              className="h-full transition-opacity first:rounded-l-lg last:rounded-r-lg"
              style={{
                width: `${pct}%`,
                background: i < 4 ? seriesColor(i) : OTHER_COLOR,
                opacity: hover && hover !== seg[labelKey] ? 0.45 : 1,
              }}
              onMouseEnter={() => setHover(seg[labelKey])}
              onMouseLeave={() => setHover(null)}
              title={`${seg[labelKey]}: ${format(seg[valueKey])}`}
            />
          );
        })}
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {segments.map((seg, i) => {
          const pct = ((Number(seg[valueKey]) || 0) / total) * 100;
          return (
            <li
              key={seg[labelKey]}
              className="flex items-center gap-2 text-sm"
              onMouseEnter={() => setHover(seg[labelKey])}
              onMouseLeave={() => setHover(null)}
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: i < 4 ? seriesColor(i) : OTHER_COLOR }}
              />
              <span className="truncate capitalize text-slate-600">{seg[labelKey]}</span>
              <span className="ml-auto shrink-0 font-medium text-slate-900">{pct.toFixed(0)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Tiny trend line for a stat tile. No axes - it shows shape, not values. */
export function Sparkline({ values, width = 120, height = 32, tone = 'var(--series-1)' }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / (values.length - 1);

  const path = values
    .map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <path d={path} fill="none" stroke={tone} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Empty() {
  return (
    <div className="flex h-32 items-center justify-center text-sm text-slate-400">
      Not enough data to chart yet.
    </div>
  );
}
