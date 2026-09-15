import { useEffect, useLayoutEffect, useRef } from 'react';
import { animate, useInView, useReducedMotion } from 'motion/react';

/**
 * A number that counts up the first time it is seen, and glides to its new value
 * whenever the value changes afterwards. Text is written straight to the DOM on
 * each frame, so a counting figure never re-renders React.
 */
export default function CountUp({ value, format = (n) => Math.round(n).toLocaleString(), duration = 1.1, className, style }) {
  const ref = useRef(null);
  // The number currently on screen - may be mid-animation.
  const shown = useRef(null);
  const formatRef = useRef(format);
  formatRef.current = format;

  const inView = useInView(ref, { once: true, margin: '0px 0px -5% 0px' });
  const reduced = useReducedMotion();
  const target = Number(value) || 0;

  // Re-draw with the latest formatter on every render, so a currency symbol that
  // loads after the first paint still shows up on a number that has settled.
  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = formatRef.current(shown.current ?? (reduced ? target : 0));
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    if (reduced) {
      shown.current = target;
      node.textContent = formatRef.current(target);
      return undefined;
    }
    // Hold the starting frame until it is actually on screen.
    if (!inView) return undefined;

    const from = shown.current ?? 0;
    if (from === target) {
      shown.current = target;
      node.textContent = formatRef.current(target);
      return undefined;
    }

    const controls = animate(from, target, {
      duration: shown.current === null ? duration : 0.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        shown.current = latest;
        node.textContent = formatRef.current(latest);
      },
    });
    return () => controls.stop();
  }, [target, inView, reduced, duration]);

  return <span ref={ref} className={className} style={style} />;
}
