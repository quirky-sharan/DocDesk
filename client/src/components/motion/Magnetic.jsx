import { useRef } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react';

/** Drifts gently toward the pointer while hovered, then springs home. */
export default function Magnetic({ strength = 0.25, className, children, ...rest }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const x = useSpring(useMotionValue(0), { stiffness: 260, damping: 18, mass: 0.5 });
  const y = useSpring(useMotionValue(0), { stiffness: 260, damping: 18, mass: 0.5 });

  function onPointerMove(event) {
    if (reduced || event.pointerType !== 'mouse' || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    x.set((event.clientX - (rect.left + rect.width / 2)) * strength);
    y.set((event.clientY - (rect.top + rect.height / 2)) * strength);
  }

  function reset() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div ref={ref} className={className} style={{ x, y }} onPointerMove={onPointerMove} onPointerLeave={reset} {...rest}>
      {children}
    </motion.div>
  );
}
