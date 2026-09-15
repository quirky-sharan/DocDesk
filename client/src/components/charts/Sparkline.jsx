import { useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { monotonePath } from './scale';

/**
 * A tiny trend for a stat tile: shape, not values. History in a quiet line, the
 * latest point marked in the accent.
 */
export default function Sparkline({ values, width = 96, height = 32, color = 'var(--series-1)', fill = true }) {
  const id = useId().replace(/:/g, '');
  const reduced = useReducedMotion();
  if (!values || values.length < 2) return null;

  const pad = 3;
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = (width - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => [pad + i * step, pad + (height - pad * 2) * (1 - (v - min) / span)]);
  const line = monotonePath(points);
  const last = points.at(-1);
  const area = `${line}L${last[0]},${height}L${points[0][0]},${height}Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${id})`} />}
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
      />
      <motion.circle
        cx={last[0]}
        cy={last[1]}
        r="3"
        fill={color}
        stroke="var(--chart-surface)"
        strokeWidth="1.5"
        initial={reduced ? false : { scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 1 }}
      />
    </svg>
  );
}
