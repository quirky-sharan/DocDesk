import { motion } from 'motion/react';
import { EASE_OUT, fadeUp, fadeUpLight, staggerContainer } from '../../lib/motion';

const VIEWPORT = { once: true, margin: '0px 0px -8% 0px' };

/**
 * Fades an element up into place the first time it scrolls into view.
 * `light` skips the blur, for anything repeated many times on a page.
 */
export function Reveal({ as = 'div', delay = 0, y = 14, light = false, className, children, ...rest }) {
  const Component = motion[as] || motion.div;
  const hidden = light ? { opacity: 0, y } : { opacity: 0, y, filter: 'blur(6px)' };
  const shown = light ? { opacity: 1, y: 0 } : { opacity: 1, y: 0, filter: 'blur(0px)' };
  return (
    <Component
      className={className}
      initial={hidden}
      whileInView={shown}
      viewport={VIEWPORT}
      transition={{ duration: light ? 0.5 : 0.75, ease: EASE_OUT, delay }}
      {...rest}
    >
      {children}
    </Component>
  );
}

/** A group whose RevealItem children arrive one after another. */
export function RevealGroup({ as = 'div', gap = 0.06, delay = 0, className, children, ...rest }) {
  const Component = motion[as] || motion.div;
  return (
    <Component
      className={className}
      variants={staggerContainer(gap, delay)}
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
      {...rest}
    >
      {children}
    </Component>
  );
}

export function RevealItem({ as = 'div', light = false, className, children, ...rest }) {
  const Component = motion[as] || motion.div;
  return (
    <Component className={className} variants={light ? fadeUpLight : fadeUp} {...rest}>
      {children}
    </Component>
  );
}
