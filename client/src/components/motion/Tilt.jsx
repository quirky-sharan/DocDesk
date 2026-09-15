import { useRef } from 'react';
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';

const finePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;

/**
 * A card that leans toward the pointer in 3D, with a soft highlight sliding
 * across its surface like light on glass. Off for touch and reduced motion,
 * where it is just the card.
 */
export default function Tilt({ max = 6, glare = true, className = '', style, children, ...rest }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const hovering = useMotionValue(0);

  const springConfig = { stiffness: 180, damping: 18, mass: 0.6 };
  const rotateX = useSpring(useTransform(py, [0, 1], [max, -max]), springConfig);
  const rotateY = useSpring(useTransform(px, [0, 1], [-max, max]), springConfig);
  const glow = useSpring(hovering, { stiffness: 120, damping: 20 });
  const gx = useTransform(px, (v) => `${v * 100}%`);
  const gy = useTransform(py, (v) => `${v * 100}%`);
  const background = useMotionTemplate`radial-gradient(420px circle at ${gx} ${gy}, rgb(255 255 255 / 0.16), transparent 55%)`;

  const enabled = finePointer && !reduced;

  function onPointerMove(event) {
    if (!enabled || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    px.set((event.clientX - rect.left) / rect.width);
    py.set((event.clientY - rect.top) / rect.height);
    hovering.set(1);
  }

  function onPointerLeave() {
    px.set(0.5);
    py.set(0.5);
    hovering.set(0);
  }

  return (
    <motion.div
      ref={ref}
      className={`relative ${className}`}
      style={enabled ? { ...style, rotateX, rotateY, transformPerspective: 1000, transformStyle: 'preserve-3d' } : style}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      {...rest}
    >
      {children}
      {enabled && glare && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{ background, opacity: glow, mixBlendMode: 'soft-light' }}
        />
      )}
    </motion.div>
  );
}
