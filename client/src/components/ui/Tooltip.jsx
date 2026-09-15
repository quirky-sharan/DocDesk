import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';

/**
 * A small label that appears after a short pause on hover or keyboard focus.
 * Used where an icon stands alone (the collapsed sidebar, icon buttons).
 */
export default function Tooltip({ label, side = 'top', delay = 350, disabled = false, children, className }) {
  const ref = useRef(null);
  const timer = useRef(null);
  const [position, setPosition] = useState(null);

  const show = useCallback(() => {
    if (disabled || !label) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 10;
      const positions = {
        top: { left: rect.left + rect.width / 2, top: rect.top - gap, transform: 'translate(-50%, -100%)' },
        bottom: { left: rect.left + rect.width / 2, top: rect.bottom + gap, transform: 'translate(-50%, 0)' },
        right: { left: rect.right + gap, top: rect.top + rect.height / 2, transform: 'translate(0, -50%)' },
        left: { left: rect.left - gap, top: rect.top + rect.height / 2, transform: 'translate(-100%, -50%)' },
      };
      setPosition(positions[side]);
    }, delay);
  }, [delay, disabled, label, side]);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setPosition(null);
  }, []);

  const offset = { top: { y: 4 }, bottom: { y: -4 }, right: { x: -4 }, left: { x: 4 } }[side];

  return (
    <span
      ref={ref}
      className={className || 'inline-flex'}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
      onPointerDown={hide}
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {position && (
            <motion.div
              role="tooltip"
              className="pointer-events-none fixed z-[90]"
              style={{ left: position.left, top: position.top, transform: position.transform }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9, ...offset }}
                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.08 } }}
                transition={{ type: 'spring', stiffness: 600, damping: 35 }}
                className="whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-medium shadow-lg"
                style={{ background: 'rgb(var(--c-text))', color: 'rgb(var(--c-surface))' }}
              >
                {label}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </span>
  );
}
