import { useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';

/**
 * Concentric progress rings, one per goal - today against a typical day. Each
 * ring is a meter: its own hue on a faint track of the same hue, and every ring
 * is named with its number in the legend, so nothing depends on telling the
 * colours apart. Past 100% the ring laps itself.
 */
export default function Rings({ rings = [], size = 172, stroke = 15, gap = 5, children }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const reduced = useReducedMotion();
  const center = size / 2;

  return (
    <div ref={ref} className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={rings.map((r) => `${r.label} ${Math.round((r.value / (r.target || 1)) * 100)}%`).join(', ')}>
        {rings.map((ring, i) => {
          const radius = center - stroke / 2 - i * (stroke + gap);
          if (radius <= stroke / 2) return null;
          const circumference = 2 * Math.PI * radius;
          const ratio = ring.target > 0 ? Math.max(ring.value / ring.target, 0) : 0;
          const first = Math.min(ratio, 1);
          const lap = Math.min(Math.max(ratio - 1, 0), 0.95);
          const delay = reduced ? 0 : 0.15 + i * 0.12;
          return (
            <g key={ring.key || ring.label} transform={`rotate(-90 ${center} ${center})`}>
              <circle cx={center} cy={center} r={radius} fill="none" stroke={ring.color} strokeOpacity="0.16" strokeWidth={stroke} />
              <motion.circle
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={ring.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                initial={reduced ? false : { strokeDashoffset: circumference }}
                animate={{ strokeDashoffset: inView || reduced ? circumference * (1 - Math.max(first, 0.001)) : circumference }}
                transition={{ type: 'spring', stiffness: 40, damping: 14, delay }}
              />
              {lap > 0 && (
                <motion.circle
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={ring.color}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  style={{ filter: 'drop-shadow(0 0 3px rgb(0 0 0 / 0.45))' }}
                  initial={reduced ? false : { strokeDashoffset: circumference }}
                  animate={{ strokeDashoffset: inView || reduced ? circumference * (1 - lap) : circumference }}
                  transition={{ type: 'spring', stiffness: 40, damping: 14, delay: delay + 0.7 }}
                />
              )}
            </g>
          );
        })}
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-center">{children}</div>}
    </div>
  );
}

/** The legend that always accompanies the rings: name, number, and share of goal. */
export function RingsLegend({ rings = [] }) {
  return (
    <ul className="min-w-0 flex-1 space-y-3.5">
      {rings.map((ring) => {
        const pct = ring.target > 0 ? Math.round((ring.value / ring.target) * 100) : 0;
        return (
          <li key={ring.key || ring.label} className="flex items-center gap-3">
            <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: ring.color }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] text-ink-2">{ring.label}</p>
              <p className="text-[17px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                {ring.display}
                <span className="ml-1.5 text-[12.5px] font-medium text-ink-3">{ring.targetDisplay}</span>
              </p>
            </div>
            <span className="shrink-0 text-[13px] font-semibold text-ink tabular">{pct}%</span>
          </li>
        );
      })}
    </ul>
  );
}
