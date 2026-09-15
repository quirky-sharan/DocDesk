import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/cn';
import { useEscapeLayer } from '../../hooks/useLayer';

const MARGIN = 8;

/**
 * A panel anchored to a trigger, rendered in a portal so no card's overflow can
 * clip it. Flips above the trigger when there is no room below, stays inside the
 * window, follows the trigger while anything scrolls, and closes on Escape or a
 * click elsewhere.
 */
export default function Popover({ anchorRef, open, onClose, align = 'end', offset = 8, className, children, role = 'dialog', label }) {
  const panelRef = useRef(null);
  const [position, setPosition] = useState(null);

  const update = useCallback(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;

    let top = anchor.bottom + offset;
    let vertical = 'top';
    if (top + height > window.innerHeight - MARGIN && anchor.top - offset - height > MARGIN) {
      top = anchor.top - offset - height;
      vertical = 'bottom';
    }

    let left =
      align === 'start' ? anchor.left : align === 'center' ? anchor.left + anchor.width / 2 - width / 2 : anchor.right - width;
    left = Math.min(Math.max(left, MARGIN), window.innerWidth - width - MARGIN);

    const horizontal = align === 'start' ? 'left' : align === 'center' ? 'center' : 'right';
    setPosition({ top, left, origin: `${vertical} ${horizontal}` });
  }, [anchorRef, align, offset]);

  useLayoutEffect(() => {
    // The last position is kept after closing, so the exit animation plays in place.
    if (!open) return undefined;
    update();
    const frame = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, update]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (panelRef.current?.contains(event.target) || anchorRef.current?.contains(event.target)) return;
      onClose();
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, onClose, anchorRef]);

  useEscapeLayer(onClose, open);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          role={role}
          aria-label={label}
          initial={{ opacity: 0, scale: 0.94, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
          transition={{ type: 'spring', stiffness: 520, damping: 34, mass: 0.6 }}
          className={cn('glass fixed z-[70] rounded-2xl', className)}
          style={
            position
              ? { top: position.top, left: position.left, transformOrigin: position.origin }
              : { top: 0, left: 0, visibility: 'hidden' }
          }
          data-lenis-prevent
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

/** A simple menu row for use inside a Popover. */
export function MenuItem({ icon: Icon, children, hint, danger = false, onClick, as: Component = 'button', ...rest }) {
  return (
    <Component
      type={Component === 'button' ? 'button' : undefined}
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13.5px] transition-colors',
        danger ? 'text-bad hover:bg-[var(--danger-soft)]' : 'text-ink hover:bg-[var(--wash-strong)]'
      )}
      {...rest}
    >
      {Icon && <Icon size={16} strokeWidth={1.9} className={danger ? '' : 'text-ink-2'} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-[12px] text-ink-3">{hint}</span>}
    </Component>
  );
}
