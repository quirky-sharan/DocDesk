import { useEffect, useRef } from 'react';

// Dialogs, popovers and the command palette stack. Escape should close only the
// top one, so each registers here and only the most recent layer hears the key.
const stack = [];

export function useEscapeLayer(onEscape, active = true) {
  const handler = useRef(onEscape);
  handler.current = onEscape;

  useEffect(() => {
    if (!active) return undefined;
    const token = {};
    stack.push(token);

    function onKey(event) {
      if (event.key !== 'Escape' || stack[stack.length - 1] !== token) return;
      event.preventDefault();
      event.stopPropagation();
      handler.current?.(event);
    }

    // Capture phase, so the top layer handles it before anything underneath.
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const index = stack.indexOf(token);
      if (index !== -1) stack.splice(index, 1);
    };
  }, [active]);
}

/** True while any layer (dialog, popover, palette) is open. */
export function hasOpenLayer() {
  return stack.length > 0;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab inside a dialog while it is open and hands focus back to whatever
 * opened it on close - so keyboard users never get lost behind the backdrop.
 */
export function useFocusTrap(ref, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const previous = document.activeElement;
    const node = ref.current;

    const focusFirst = () => {
      if (!node || node.contains(document.activeElement)) return;
      const auto = node.querySelector('[autofocus], [data-autofocus]');
      (auto || node.querySelector(FOCUSABLE) || node).focus?.({ preventScroll: true });
    };
    const timer = setTimeout(focusFirst, 30);

    function onKey(event) {
      if (event.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [ref, active]);
}
