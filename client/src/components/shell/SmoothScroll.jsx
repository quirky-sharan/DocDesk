import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Lenis from 'lenis';
import { useLocation } from 'react-router-dom';

const ScrollContext = createContext(null);

/**
 * The app's one scrolling surface, with Lenis smoothing the wheel so scrolling
 * glides instead of stepping. Touch keeps its native feel, reduced-motion users
 * get plain scrolling (Lenis honours the setting), and anything that scrolls on
 * its own - the assistant, modals, wide tables - keeps working through
 * `allowNestedScroll`.
 */
export function SmoothScrollProvider({ children }) {
  const scrollerRef = useRef(null);
  const contentRef = useRef(null);
  const lenisRef = useRef(null);
  const locks = useRef(0);
  const [scroller, setScroller] = useState(null);
  const { pathname } = useLocation();

  useEffect(() => {
    const wrapper = scrollerRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return undefined;
    setScroller(wrapper);

    const lenis = new Lenis({
      wrapper,
      content,
      lerp: 0.115,
      wheelMultiplier: 0.95,
      smoothWheel: true,
      autoRaf: true,
      allowNestedScroll: true,
      stopInertiaOnNavigate: true,
      prevent: (node) => Boolean(node.closest?.('[data-lenis-prevent]')),
    });
    lenisRef.current = lenis;
    return () => {
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  // A new page starts at the top, instantly - a smooth scroll back up on every
  // navigation would feel like lag.
  useEffect(() => {
    if (lenisRef.current) lenisRef.current.scrollTo(0, { immediate: true, force: true });
    else if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [pathname]);

  const lock = useCallback(() => {
    locks.current += 1;
    lenisRef.current?.stop();
  }, []);

  const unlock = useCallback(() => {
    locks.current = Math.max(0, locks.current - 1);
    if (locks.current === 0) lenisRef.current?.start();
  }, []);

  const scrollTo = useCallback((target, options) => {
    if (lenisRef.current) lenisRef.current.scrollTo(target, { offset: -80, duration: 1.1, ...options });
    else if (typeof target === 'number') scrollerRef.current?.scrollTo({ top: target, behavior: 'smooth' });
    else target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, []);

  const value = useMemo(
    () => ({ scrollerRef, contentRef, scroller, lock, unlock, scrollTo }),
    [scroller, lock, unlock, scrollTo]
  );

  return <ScrollContext.Provider value={value}>{children}</ScrollContext.Provider>;
}

export function useSmoothScroll() {
  const context = useContext(ScrollContext);
  if (!context) throw new Error('useSmoothScroll must be used inside SmoothScrollProvider');
  return context;
}

/** Stops the page behind from scrolling while something (a dialog) is open. */
export function useScrollLock(active) {
  const context = useContext(ScrollContext);
  useEffect(() => {
    if (!active || !context) return undefined;
    context.lock();
    return () => context.unlock();
  }, [active, context]);
}
