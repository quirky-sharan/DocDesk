// Shared motion vocabulary. Components pick from these rather than inventing
// their own curves, so everything in the app moves like it belongs together.

export const EASE_OUT = [0.16, 1, 0.3, 1];

/** Snappy - presses, toggles, small pops. */
export const spring = { type: 'spring', stiffness: 420, damping: 32, mass: 0.7 };
/** Soft - panels, sheets, larger surfaces. */
export const springSoft = { type: 'spring', stiffness: 220, damping: 28, mass: 0.9 };
/** A little bounce - things that should feel satisfying to land. */
export const springBouncy = { type: 'spring', stiffness: 480, damping: 22, mass: 0.7 };

export const fadeUp = {
  hidden: { opacity: 0, y: 14, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.75, ease: EASE_OUT } },
};

/** Lighter than fadeUp - for rows and list items where blur would be costly. */
export const fadeUpLight = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

export function staggerContainer(gap = 0.06, delay = 0) {
  return {
    hidden: {},
    show: { transition: { staggerChildren: gap, delayChildren: delay } },
  };
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
