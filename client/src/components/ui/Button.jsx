import { forwardRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';
import Spinner from './Spinner';

const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger-solid',
  quiet: 'btn-edit',
  'danger-quiet': 'btn-danger',
};

const swap = {
  initial: { opacity: 0, scale: 0.5, filter: 'blur(3px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, scale: 0.5, filter: 'blur(3px)' },
  transition: { type: 'spring', stiffness: 520, damping: 30 },
};

/**
 * The one button. Presses spring (CSS) and ripple (lib/press.js); `loading`
 * swaps the icon for a spinner and `success` morphs it into a check, so saving
 * something has a small, satisfying finish.
 */
const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight, loading = false, success = false, className, children, type = 'button', disabled, ...rest },
  ref
) {
  const iconSize = size === 'lg' ? 18 : size === 'sm' ? 14 : 16;
  const lead = loading ? 'loading' : success ? 'success' : Icon ? 'icon' : null;

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(VARIANTS[variant] || VARIANTS.primary, size === 'sm' && 'btn-sm', size === 'lg' && 'btn-lg', !children && 'btn-icon', className)}
      {...rest}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {lead && (
          <motion.span key={lead} className="inline-flex" {...swap}>
            {lead === 'loading' && <Spinner size={iconSize} />}
            {lead === 'success' && <Check size={iconSize} strokeWidth={2.6} />}
            {lead === 'icon' && <Icon size={iconSize} strokeWidth={2} />}
          </motion.span>
        )}
      </AnimatePresence>
      {children}
      {IconRight && <IconRight size={iconSize} strokeWidth={2} />}
    </button>
  );
});

export default Button;
