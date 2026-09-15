import { AnimatePresence, motion } from 'motion/react';
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '../../lib/cn';

const TONES = {
  info: { bg: 'var(--accent-soft)', fg: 'rgb(var(--c-accent-text))', icon: Info },
  success: { bg: 'var(--success-soft)', fg: 'rgb(var(--c-success))', icon: CircleCheck },
  warning: { bg: 'var(--warning-soft)', fg: 'rgb(var(--c-warning))', icon: TriangleAlert },
  danger: { bg: 'var(--danger-soft)', fg: 'rgb(var(--c-danger))', icon: TriangleAlert },
};

export function Notice({ tone = 'info', title, children, action, onDismiss, className }) {
  const style = TONES[tone] || TONES.info;
  const Icon = style.icon;
  return (
    <div className={cn('mb-5 flex items-start gap-3 rounded-2xl px-4 py-3.5 text-[13.5px]', className)} style={{ background: style.bg }}>
      <Icon size={17} strokeWidth={2.2} className="mt-px shrink-0" style={{ color: style.fg }} />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <p className="font-semibold" style={{ color: style.fg }}>{title}</p>}
        <div className={cn('text-ink', title && 'mt-0.5')}>{children}</div>
        {action && <div className="mt-2.5">{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-[var(--wash-strong)]" aria-label="Dismiss">
          <X size={14} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

/** An error, in words a person can act on. Animates in and out of the layout. */
export function ErrorNote({ error, onDismiss }) {
  return (
    <AnimatePresence initial={false}>
      {error && (
        <motion.div
          key="error"
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          style={{ overflow: 'hidden' }}
        >
          <Notice tone="danger" title="Something went wrong" onDismiss={onDismiss}>
            {error}
          </Notice>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
