import { motion } from 'motion/react';
import { Inbox } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * What a list shows when there is nothing in it: a floating glass tile, one line
 * saying why, and the action that fixes it.
 */
export default function Empty({ icon: Icon = Inbox, title, message, action, compact = false, className }) {
  return (
    <div
      className={cn('panel flex flex-col items-center justify-center text-center', compact ? 'px-6 py-10' : 'px-6 py-16', className)}
    >
      <div className="relative mb-5" aria-hidden="true">
        <motion.div
          animate={{ y: [0, -6, 0], rotate: [0, -2, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          className="relative grid h-16 w-16 place-items-center rounded-[20px]"
          style={{
            background: 'linear-gradient(160deg, rgb(var(--c-elevated)), rgb(var(--c-sunken)))',
            boxShadow: '0 0 0 1px var(--line), var(--shadow-lg), var(--edge-highlight)',
          }}
        >
          <Icon size={26} strokeWidth={1.7} className="text-ink-3" />
        </motion.div>
        <motion.div
          animate={{ scaleX: [1, 0.82, 1], opacity: [0.5, 0.3, 0.5] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          className="mx-auto mt-3 h-2 w-12 rounded-full"
          style={{ background: 'radial-gradient(closest-side, rgb(0 0 0 / 0.18), transparent)' }}
        />
      </div>
      {title && <p className="text-[15px] font-semibold tracking-[-0.015em]">{title}</p>}
      {message && <p className={cn('max-w-sm text-[13.5px] leading-relaxed text-ink-2', title && 'mt-1')}>{message}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
