import { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import { useSpotlight } from '../../hooks/useSpotlight';

/**
 * The basic surface. `spotlight` adds the soft light that follows the pointer;
 * `hover` lifts it slightly, for cards that are links or buttons.
 */
export const Card = forwardRef(function Card({ as: Component = 'section', padded = true, spotlight = false, hover = false, className, children, onPointerMove, ...rest }, ref) {
  const track = useSpotlight();
  return (
    <Component
      ref={ref}
      className={cn(padded ? 'card' : 'panel', spotlight && 'spotlight', hover && 'card-hover', className)}
      onPointerMove={spotlight ? (e) => { track(e); onPointerMove?.(e); } : onPointerMove}
      {...rest}
    >
      {children}
    </Component>
  );
});

export function CardHeader({ title, subtitle, icon: Icon, action, className }) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="flex min-w-[min(14rem,100%)] flex-1 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[var(--accent-soft)] text-accent-ink">
            <Icon size={16} strokeWidth={2} />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold leading-snug tracking-[-0.018em]">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-ink-2">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex max-w-full flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
