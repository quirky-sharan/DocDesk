import { useEffect, useRef } from 'react';
import { gsap, playWhenVisible, reduced, useGsap } from '../../lib/gsap';

/**
 * The schema, drawn.
 *
 * Five of the real tables and the foreign keys between them, as hairlines on a
 * 640x440 grid. The lines draw themselves in as the section arrives and a mark
 * then travels down the path a sale actually takes - sale, line, stock movement
 * - which is the point the section is making: the relationships are the
 * product, not an implementation detail.
 *
 * It is vector, not an image: it stays sharp at any size, follows the theme
 * because every stroke is currentColor, and costs nothing to download.
 */

const TABLES = [
  { id: 'products', label: 'products', rows: ['id', 'name', 'stock', 'reorder_level'], x: 24, y: 150 },
  { id: 'sales', label: 'sales', rows: ['id', 'customer_id', 'total', 'status'], x: 246, y: 24 },
  { id: 'sale_items', label: 'sale_items', rows: ['sale_id', 'product_id', 'qty'], x: 246, y: 186 },
  { id: 'payments', label: 'payments', rows: ['sale_id', 'method', 'amount'], x: 468, y: 24 },
  { id: 'stock_movements', label: 'stock_movements', rows: ['product_id', 'delta', 'reason'], x: 440, y: 300 },
];

const WIDTH = 150;
const HEADER = 26;
const ROW = 20;

function height(table) {
  return HEADER + table.rows.length * ROW + 8;
}

const BY_ID = Object.fromEntries(TABLES.map((t) => [t.id, t]));

/** An elbow between two tables, leaving one side and arriving at the other. */
function elbow(fromId, toId, fromSide, toSide) {
  const a = BY_ID[fromId];
  const b = BY_ID[toId];
  const ax = fromSide === 'right' ? a.x + WIDTH : a.x;
  const ay = a.y + height(a) / 2;
  const bx = toSide === 'right' ? b.x + WIDTH : b.x;
  const by = b.y + height(b) / 2;
  const mid = ax + (bx - ax) / 2;
  return `M ${ax} ${ay} H ${mid} V ${by} H ${bx}`;
}

const LINKS = [
  { id: 'l1', d: elbow('products', 'sale_items', 'right', 'left') },
  { id: 'l2', d: elbow('sale_items', 'sales', 'right', 'right') },
  { id: 'l3', d: elbow('sales', 'payments', 'right', 'left') },
  { id: 'l4', d: elbow('products', 'stock_movements', 'right', 'left') },
];

export default function SchemaGraphic() {
  const pulse = useRef(null);

  const scope = useGsap(() => {
    const paths = gsap.utils.toArray('[data-link]');
    gsap.set(paths, { strokeDasharray: (i, el) => el.getTotalLength(), strokeDashoffset: (i, el) => el.getTotalLength() });
    gsap.set('[data-table]', { opacity: 0, y: 14 });

    const timeline = gsap.timeline({ paused: true });
    timeline
      .to('[data-table]', { opacity: 1, y: 0, duration: 0.8, stagger: 0.09, ease: 'expo.out' })
      .to(paths, { strokeDashoffset: 0, duration: 1.1, stagger: 0.12, ease: 'power2.inOut' }, '-=0.5');
    playWhenVisible(document.querySelector('[data-schema]'), timeline, 'top 78%');
  }, []);

  // The travelling mark runs on its own loop once the graphic exists, so it
  // keeps going after the scroll animation has finished.
  useEffect(() => {
    if (reduced() || !pulse.current) return undefined;
    const path = document.querySelector('[data-link="l1"]');
    const second = document.querySelector('[data-link="l4"]');
    if (!path || !second) return undefined;

    const length = path.getTotalLength();
    const length2 = second.getTotalLength();
    const state = { t: 0 };
    const tween = gsap.to(state, {
      t: 1,
      duration: 3.4,
      ease: 'none',
      repeat: -1,
      repeatDelay: 0.6,
      onUpdate: () => {
        // First half of the loop travels product -> sale_items, second half
        // product -> stock_movements: one sale, both of its consequences.
        const leg = state.t < 0.5 ? path : second;
        const local = state.t < 0.5 ? state.t * 2 : (state.t - 0.5) * 2;
        const point = leg.getPointAtLength(local * (leg === path ? length : length2));
        gsap.set(pulse.current, { attr: { cx: point.x, cy: point.y }, opacity: local < 0.06 || local > 0.94 ? 0 : 1 });
      },
    });
    return () => tween.kill();
  }, []);

  return (
    <div ref={scope} className="w-full">
      <svg
        data-schema
        viewBox="0 0 640 440"
        className="w-full"
        role="img"
        aria-label="Five DocDesk tables - products, sales, sale items, payments and stock movements - joined by their foreign keys"
      >
        <g stroke="currentColor" fill="none" opacity="0.45">
          {LINKS.map((link) => (
            <path key={link.id} data-link={link.id} d={link.d} strokeWidth="1" />
          ))}
        </g>

        <circle ref={pulse} r="4" fill="rgb(var(--c-accent))" opacity="0" />

        {TABLES.map((table) => (
          <g key={table.id} data-table>
            <rect
              x={table.x}
              y={table.y}
              width={WIDTH}
              height={height(table)}
              fill="rgb(var(--c-surface))"
              stroke="currentColor"
              strokeOpacity="0.5"
              strokeWidth="1"
            />
            <line
              x1={table.x}
              y1={table.y + HEADER}
              x2={table.x + WIDTH}
              y2={table.y + HEADER}
              stroke="currentColor"
              strokeOpacity="0.5"
              strokeWidth="1"
            />
            <text
              x={table.x + 11}
              y={table.y + 17}
              fill="currentColor"
              fontSize="11"
              fontWeight="600"
              letterSpacing="0.04em"
            >
              {table.label}
            </text>
            {table.rows.map((row, i) => (
              <text
                key={row}
                x={table.x + 11}
                y={table.y + HEADER + 14 + i * ROW}
                fill="currentColor"
                fillOpacity="0.55"
                fontSize="10.5"
                fontFamily="ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
              >
                {row}
              </text>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
