import { AnimatePresence, motion } from 'motion/react';

/**
 * The readout that follows the pointer on a chart. Value first and strong,
 * label second - the reader already knows which chart they're on and wants the
 * number. Kept inside the chart's box and flipped below the point near the top.
 */
export default function ChartTooltip({ visible, x, y, containerWidth, rows = [], title, align = 'above' }) {
  const width = 176;
  const left = Math.min(Math.max(x - width / 2, 0), Math.max(containerWidth - width, 0));
  const below = align === 'below';
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.94, left, top: y }}
          animate={{ opacity: 1, scale: 1, left, top: y }}
          exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.1 } }}
          transition={{ type: 'spring', stiffness: 700, damping: 45, mass: 0.5 }}
          className="pointer-events-none absolute z-10"
          style={{ width, translateY: below ? 14 : 'calc(-100% - 14px)' }}
        >
          <div className="glass rounded-xl px-3 py-2" style={{ background: 'var(--glass-strong)' }}>
            {title && <p className="mb-1 text-[11.5px] font-medium text-ink-3">{title}</p>}
            {rows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                {row.color && <span className="h-[3px] w-3 shrink-0 rounded-full" style={{ background: row.color }} />}
                <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink tabular">{row.value}</span>
                {row.label && <span className="ml-auto truncate text-[12px] text-ink-2">{row.label}</span>}
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
