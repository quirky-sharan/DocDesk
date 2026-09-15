import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import CountUp from '../motion/CountUp';
import Tilt from '../motion/Tilt';
import Sparkline from './Sparkline';
import { cn } from '../../lib/cn';
import { useSpotlight } from '../../hooks/useSpotlight';

/**
 * A headline number: label, value that counts up, an optional change against a
 * named period (arrow and sign as well as colour), and a small trend. Leans
 * toward the pointer; when it is a filter, `active` marks it selected.
 */
export default function StatTile({
  label,
  value,
  format,
  icon: Icon,
  tone,
  delta,
  deltaLabel,
  upIsGood = true,
  footnote,
  spark,
  sparkColor,
  onClick,
  active = false,
  className,
}) {
  const track = useSpotlight();
  const direction = delta === undefined || delta === null ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const good = direction === 'flat' ? null : (direction === 'up') === upIsGood;
  const DeltaIcon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  const Component = onClick ? 'button' : 'div';
  const toneColor = { red: 'rgb(var(--c-danger))', amber: 'rgb(var(--c-warning))', green: 'rgb(var(--c-success))' }[tone];

  return (
    <Tilt max={4} className={cn('h-full rounded-[22px]', className)}>
      <Component
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        onPointerMove={track}
        aria-pressed={onClick ? active : undefined}
        className={cn(
          'spotlight relative flex h-full w-full flex-col overflow-hidden rounded-[22px] p-5 text-left transition-shadow duration-300',
          onClick && 'cursor-pointer'
        )}
        style={{
          background: 'rgb(var(--c-surface))',
          boxShadow: active
            ? '0 0 0 2px rgb(var(--c-accent)), var(--shadow-md)'
            : '0 0 0 1px var(--line), var(--shadow-sm), var(--edge-highlight)',
        }}
      >
        <div className="flex items-center gap-2">
          {Icon && (
            <span className="grid h-7 w-7 place-items-center rounded-[9px]" style={{ background: 'var(--wash-strong)', color: toneColor || 'rgb(var(--c-text-2))' }}>
              <Icon size={15} strokeWidth={2.1} />
            </span>
          )}
          <span className="truncate text-[13px] font-medium text-ink-2">{label}</span>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[28px] font-semibold leading-none tracking-[-0.035em]" style={{ color: toneColor }}>
              {typeof value === 'number' ? <CountUp value={value} format={format} /> : value}
            </p>
          </div>
          {spark && spark.length > 1 && (
            <div className="shrink-0">
              <Sparkline values={spark} width={84} height={30} color={sparkColor || 'var(--series-1)'} />
            </div>
          )}
        </div>

        {(direction || footnote) && (
          <div className="mt-3 flex min-h-[20px] flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            {direction && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold tabular"
                style={{
                  background: good === null ? 'var(--wash-strong)' : good ? 'var(--success-soft)' : 'var(--danger-soft)',
                  color: good === null ? 'rgb(var(--c-text-2))' : good ? 'rgb(var(--c-success))' : 'rgb(var(--c-danger))',
                }}
              >
                <DeltaIcon size={12} strokeWidth={2.6} />
                {Math.abs(delta)}%
              </span>
            )}
            {deltaLabel && <span className="text-ink-3">{deltaLabel}</span>}
            {footnote && <span className="ml-auto truncate text-ink-3">{footnote}</span>}
          </div>
        )}
      </Component>
    </Tilt>
  );
}
