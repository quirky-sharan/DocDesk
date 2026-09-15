import { motion, useReducedMotion } from 'motion/react';

/**
 * Stock against its reorder level, as a short track. The fill carries the state
 * (critical when out, warning at or under the reorder line, good above) and a
 * thin tick marks where the reorder line sits.
 */
export default function Meter({ value = 0, max = 1, marker, width = 72, height = 6 }) {
  const reduced = useReducedMotion();
  const top = Math.max(max, value, 1);
  const pct = Math.min(Math.max(value / top, 0), 1) * 100;
  const markerPct = marker ? Math.min(marker / top, 1) * 100 : null;
  const tone = value <= 0 ? 'var(--status-critical)' : marker && value <= marker ? 'var(--status-warning)' : 'var(--status-good)';

  return (
    <span className="relative inline-block overflow-hidden rounded-full align-middle" style={{ width, height, background: 'var(--chart-track)' }} aria-hidden="true">
      <motion.span
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ background: tone }}
        initial={reduced ? false : { width: 0 }}
        animate={{ width: `${Math.max(pct, value > 0 ? 4 : 0)}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      />
      {markerPct !== null && (
        <span className="absolute inset-y-0 w-[2px]" style={{ left: `calc(${markerPct}% - 1px)`, background: 'rgb(var(--c-text) / 0.45)' }} />
      )}
    </span>
  );
}
