import { useCallback } from 'react';

/**
 * Pointer position as CSS variables (--mx, --my) on the element, for the soft
 * `.spotlight` light that follows the cursor across a card. Written straight to
 * the style, so moving the mouse never re-renders anything.
 */
export function useSpotlight() {
  return useCallback((event) => {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    el.style.setProperty('--my', `${event.clientY - rect.top}px`);
  }, []);
}
