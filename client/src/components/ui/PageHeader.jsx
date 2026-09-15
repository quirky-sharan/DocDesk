import { motion, useScroll, useTransform } from 'motion/react';
import { useSmoothScroll } from '../shell/SmoothScroll';
import { EASE_OUT } from '../../lib/motion';

/**
 * The large title at the top of each page. As the page scrolls it drifts up and
 * fades while the compact title appears in the top bar - the same hand-off as a
 * large title on iOS or macOS.
 */
export default function PageHeader({ title, subtitle, eyebrow, icon: Icon, children }) {
  const { scrollerRef } = useSmoothScroll();
  const { scrollY } = useScroll({ container: scrollerRef });
  const opacity = useTransform(scrollY, [0, 90], [1, 0]);
  const y = useTransform(scrollY, [0, 90], [0, -10]);

  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pt-2">
      <motion.div style={{ opacity, y }} className="min-w-0">
        {(eyebrow || Icon) && (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE_OUT }}
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-ink"
          >
            {Icon && <Icon size={15} strokeWidth={2.2} />}
            {eyebrow}
          </motion.p>
        )}
        <motion.h1
          initial={{ opacity: 0, y: 10, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.7, ease: EASE_OUT }}
          className="text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[36px]"
        >
          {title}
        </motion.h1>
        {subtitle && (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.06 }}
            className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-2"
          >
            {subtitle}
          </motion.p>
        )}
      </motion.div>
      {children && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.1 }}
          className="flex flex-wrap items-center gap-2"
        >
          {children}
        </motion.div>
      )}
    </header>
  );
}
