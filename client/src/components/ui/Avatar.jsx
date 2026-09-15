import { hueFor, initials } from '../../lib/format';
import { cn } from '../../lib/cn';

/** Initials on a soft gradient that is always the same for the same name. */
export default function Avatar({ name, size = 32, className, square = false }) {
  const hue = hueFor(name);
  return (
    <span
      className={cn('inline-flex shrink-0 select-none items-center justify-center font-semibold text-white', square ? 'rounded-[10px]' : 'rounded-full', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.36),
        background: `linear-gradient(140deg, hsl(${hue} 72% 62%), hsl(${(hue + 36) % 360} 68% 48%))`,
        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.25), 0 1px 2px rgb(0 0 0 / 0.12)',
        letterSpacing: '0.01em',
      }}
      aria-hidden="true"
    >
      {initials(name, '·')}
    </span>
  );
}
