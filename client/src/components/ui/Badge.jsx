import { Check, CircleAlert, CircleX, Clock, Minus } from 'lucide-react';
import { cn } from '../../lib/cn';

const TONES = {
  slate: { bg: 'var(--wash-strong)', fg: 'rgb(var(--c-text-2))', dot: 'rgb(var(--c-text-3))' },
  green: { bg: 'var(--success-soft)', fg: 'rgb(var(--c-success))', dot: 'var(--success-solid)' },
  amber: { bg: 'var(--warning-soft)', fg: 'rgb(var(--c-warning))', dot: 'var(--warning-solid)' },
  red: { bg: 'var(--danger-soft)', fg: 'rgb(var(--c-danger))', dot: 'var(--danger-solid)' },
  blue: { bg: 'var(--accent-soft)', fg: 'rgb(var(--c-accent-text))', dot: 'rgb(var(--c-accent))' },
  violet: { bg: 'rgb(var(--c-violet) / 0.14)', fg: 'rgb(var(--c-violet))', dot: 'rgb(var(--c-violet))' },
};

// State is never carried by colour alone: each tone that means something has a
// shape to go with it.
const ICONS = { green: Check, amber: CircleAlert, red: CircleX, blue: Clock, slate: Minus };

export default function Badge({ tone = 'slate', icon = false, dot = false, className, children }) {
  const colours = TONES[tone] || TONES.slate;
  const Icon = icon === true ? ICONS[tone] : icon || null;
  return (
    <span
      className={cn('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[12px] font-medium capitalize leading-none', className)}
      style={{ background: colours.bg, color: colours.fg }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: colours.dot, boxShadow: `0 0 0 3px ${colours.bg}` }} />}
      {Icon && <Icon size={12} strokeWidth={2.5} />}
      {children}
    </span>
  );
}
