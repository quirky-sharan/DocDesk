import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { springSoft } from '../../lib/motion';
import { useEscapeLayer, useFocusTrap } from '../../hooks/useLayer';
import { useScrollLock } from '../shell/SmoothScroll';

const WIDTHS = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl', full: 'sm:max-w-6xl' };

/**
 * A dialog. Rises and settles with a spring over a blurred backdrop; on a phone
 * it becomes a sheet from the bottom. Rendered in a portal, traps focus, closes
 * on Escape or a click on the backdrop. Wrap the conditional that mounts it in
 * <AnimatePresence> to get the exit animation too.
 */
export default function Modal({ title, subtitle, icon: Icon, onClose, children, wide = false, size, footer, className, bodyClassName }) {
  const panelRef = useRef(null);
  const titleId = useId();
  const width = WIDTHS[size || (wide ? 'lg' : 'md')];

  useScrollLock(true);
  useEscapeLayer(onClose, true);
  useFocusTrap(panelRef, true);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6">
      <motion.div
        className="absolute inset-0"
        style={{ background: 'rgb(0 0 0 / 0.32)', WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.2 } }}
        transition={{ duration: 0.3 }}
        onMouseDown={onClose}
        aria-hidden="true"
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.98, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
        transition={springSoft}
        className={cn(
          'relative flex max-h-[94vh] w-full flex-col rounded-t-[28px] outline-none sm:max-h-[88vh] sm:rounded-[28px]',
          width,
          className
        )}
        style={{
          background: 'rgb(var(--c-elevated))',
          boxShadow: '0 0 0 1px var(--line), var(--shadow-xl), var(--edge-highlight)',
        }}
      >
        <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-[var(--line-strong)] sm:hidden" aria-hidden="true" />
        <header className="flex items-start gap-3 px-6 pb-4 pt-4 sm:pt-5">
          {Icon && (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-accent-ink">
              <Icon size={18} strokeWidth={2} />
            </span>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id={titleId} className="text-[17px] font-semibold leading-snug tracking-[-0.022em]">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-2">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost btn-icon btn-sm -mr-2 -mt-0.5"
            aria-label="Close"
          >
            <X size={17} strokeWidth={2.2} />
          </button>
        </header>
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 pb-6', bodyClassName)} data-lenis-prevent>
          {children}
        </div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t px-6 py-4" style={{ borderColor: 'var(--line)' }}>
            {footer}
          </footer>
        )}
      </motion.div>
    </div>,
    document.body
  );
}
