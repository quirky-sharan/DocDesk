import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { KeyRound, Link2, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import { MONO_FONT } from './SqlEditor';
import { cn } from '../../lib/cn';

const CARD_W = 232;
const HEAD_H = 46;
const ROW_H = 22;
const GAP_X = 110;
const GAP_Y = 36;
const STORE = 'docdesk.er.positions.v1';

// Columns of the default layout, left to right: who, what, the transactions that
// tie them together, then the tables that support the app itself.
const LAYOUT = [
  ['customers', 'categories', 'suppliers'],
  ['sales', 'products'],
  ['payments', 'sale_items', 'stock_movements'],
  ['purchase_orders', 'purchase_order_items'],
  ['audit_log', 'message_log', 'files'],
  ['settings', 'users', 'schema_migrations'],
];

const GROUP_TINT = {
  customers: '#0a84ff', categories: '#bf5af2', suppliers: '#ff9f0a',
  sales: '#30d158', products: '#5e5ce6', payments: '#30d158', sale_items: '#30d158', stock_movements: '#5e5ce6',
  purchase_orders: '#ff9f0a', purchase_order_items: '#ff9f0a',
};

function readPositions() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}');
  } catch {
    return {};
  }
}

/**
 * The schema as an entity-relationship diagram. Tables are cards listing their
 * columns (keys marked); each foreign key is a line from the referencing column
 * to the referenced key, with crow's-foot ends showing how many rows can be on
 * each side. Drag cards to rearrange, drag the background to pan, and hover a
 * table to trace everything connected to it.
 */
export default function ErDiagram({ data, onOpenTable }) {
  const [keysOnly, setKeysOnly] = useState(false);
  const [custom, setCustom] = useState(readPositions);
  const [view, setView] = useState({ x: 24, y: 24, k: 0.78 });
  const [hovered, setHovered] = useState(null);
  const svgRef = useRef(null);
  const drag = useRef(null);

  const tables = useMemo(() => {
    const byName = new Map(data.tables.map((t) => [t.name, t]));
    const fkCols = new Set(data.relationships.flatMap((r) => r.from.columns.map((c) => `${r.from.table}.${c}`)));
    const visibleColumns = (t) => (keysOnly ? t.columns.filter((c) => c.primaryKey || fkCols.has(`${t.name}.${c.name}`)) : t.columns);
    const placed = new Map();
    const columns = LAYOUT.map((names) => names.filter((n) => byName.has(n)));
    const leftovers = data.tables.map((t) => t.name).filter((n) => !LAYOUT.flat().includes(n));
    if (leftovers.length) columns.push(leftovers);
    columns.forEach((names, col) => {
      let y = 0;
      for (const name of names) {
        const t = byName.get(name);
        const cols = visibleColumns(t);
        const height = HEAD_H + cols.length * ROW_H + 10;
        const pos = custom[name] || { x: col * (CARD_W + GAP_X), y };
        placed.set(name, { ...t, cols, x: pos.x, y: pos.y, height, fk: fkCols });
        y += height + GAP_Y;
      }
    });
    return placed;
  }, [data, keysOnly, custom]);

  const connected = useMemo(() => {
    if (!hovered) return null;
    const set = new Set([hovered]);
    for (const r of data.relationships) {
      if (r.from.table === hovered) set.add(r.to.table);
      if (r.to.table === hovered) set.add(r.from.table);
    }
    return set;
  }, [hovered, data]);

  const rowY = (t, column) => {
    const index = t.cols.findIndex((c) => c.name === column);
    // A column hidden by "keys only" can't be pointed at, so use the header.
    return index === -1 ? t.y + HEAD_H / 2 : t.y + HEAD_H + index * ROW_H + ROW_H / 2;
  };

  const edges = data.relationships.map((r) => {
    const a = tables.get(r.from.table);
    const b = tables.get(r.to.table);
    if (!a || !b) return null;
    const ay = rowY(a, r.from.columns[0]);
    const by = rowY(b, r.to.columns[0]);
    const aCenter = a.x + CARD_W / 2;
    const bCenter = b.x + CARD_W / 2;
    let ax;
    let bx;
    let aDir;
    let bDir;
    if (Math.abs(aCenter - bCenter) < CARD_W * 0.6) {
      ax = a.x + CARD_W;
      bx = b.x + CARD_W;
      aDir = 1;
      bDir = 1;
    } else if (aCenter < bCenter) {
      ax = a.x + CARD_W;
      bx = b.x;
      aDir = 1;
      bDir = -1;
    } else {
      ax = a.x;
      bx = b.x + CARD_W;
      aDir = -1;
      bDir = 1;
    }
    const bend = Math.max(60, Math.abs(bx - ax) * 0.45);
    const path = `M ${ax} ${ay} C ${ax + aDir * bend} ${ay}, ${bx + bDir * bend} ${by}, ${bx} ${by}`;
    return { r, path, ax, ay, bx, by, aDir, bDir };
  }).filter(Boolean);

  // --- Panning, zooming and dragging cards ---------------------------------
  const toWorld = useCallback((clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k };
  }, [view]);

  function onPointerDown(e, table) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (table) {
      e.stopPropagation();
      const p = toWorld(e.clientX, e.clientY);
      const t = tables.get(table);
      drag.current = { kind: 'card', table, dx: p.x - t.x, dy: p.y - t.y, moved: false };
    } else {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    }
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
    } else {
      const p = toWorld(e.clientX, e.clientY);
      d.moved = true;
      setCustom((c) => ({ ...c, [d.table]: { x: Math.round(p.x - d.dx), y: Math.round(p.y - d.dy) } }));
    }
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'card') {
      if (!d.moved) onOpenTable?.(d.table);
      else setCustom((c) => {
        try {
          localStorage.setItem(STORE, JSON.stringify(c));
        } catch {
          // Optional.
        }
        return c;
      });
    }
  }

  function zoom(factor, cx, cy) {
    setView((v) => {
      const k = Math.min(Math.max(v.k * factor, 0.3), 2);
      const rect = svgRef.current.getBoundingClientRect();
      const px = cx ?? rect.width / 2;
      const py = cy ?? rect.height / 2;
      return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
    });
  }

  const fit = useCallback(() => {
    if (!svgRef.current || !tables.size) return;
    const all = [...tables.values()];
    const minX = Math.min(...all.map((t) => t.x));
    const minY = Math.min(...all.map((t) => t.y));
    const maxX = Math.max(...all.map((t) => t.x + CARD_W));
    const maxY = Math.max(...all.map((t) => t.y + t.height));
    const rect = svgRef.current.getBoundingClientRect();
    const k = Math.min((rect.width - 48) / (maxX - minX), (rect.height - 48) / (maxY - minY), 1.2);
    setView({ k, x: (rect.width - (maxX - minX) * k) / 2 - minX * k, y: (rect.height - (maxY - minY) * k) / 2 - minY * k });
  }, [tables]);

  useEffect(() => {
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
    // Fit once on first show and whenever the columns shown change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysOnly, data]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function reset() {
    setCustom({});
    try {
      localStorage.removeItem(STORE);
    } catch {
      // Optional.
    }
    requestAnimationFrame(fit);
  }

  const dim = (name) => connected && !connected.has(name);

  return (
    <div className="relative overflow-hidden rounded-[22px]" style={{ background: 'rgb(var(--c-sunken))', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
        <div className="glass flex items-center gap-0.5 rounded-full p-1" style={{ background: 'var(--glass-strong)', boxShadow: 'var(--shadow-sm)' }}>
          <button type="button" className="btn-ghost btn-sm btn-icon" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out"><Minus size={14} /></button>
          <span className="w-11 text-center text-[12px] text-ink-2 tabular">{Math.round(view.k * 100)}%</span>
          <button type="button" className="btn-ghost btn-sm btn-icon" onClick={() => zoom(1.2)} aria-label="Zoom in"><Plus size={14} /></button>
          <button type="button" className="btn-ghost btn-sm btn-icon" onClick={fit} aria-label="Fit to screen"><Maximize2 size={14} /></button>
          <button type="button" className="btn-ghost btn-sm btn-icon" onClick={reset} aria-label="Reset layout" title="Reset layout"><RotateCcw size={14} /></button>
        </div>
        <label className="glass flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px]" style={{ background: 'var(--glass-strong)', boxShadow: 'var(--shadow-sm)' }}>
          <input type="checkbox" checked={keysOnly} onChange={(e) => setKeysOnly(e.target.checked)} className="accent-[rgb(var(--c-accent))]" />
          Keys only
        </label>
      </div>
      <div className="glass absolute bottom-3 right-3 z-10 hidden items-center gap-4 rounded-full px-4 py-1.5 text-[11.5px] text-ink-2 sm:flex" style={{ background: 'var(--glass-strong)' }}>
        <span className="flex items-center gap-1.5"><KeyRound size={12} className="text-warning" /> primary key</span>
        <span className="flex items-center gap-1.5"><Link2 size={12} className="text-accent" /> foreign key</span>
        <span className="flex items-center gap-1.5">
          <svg width="26" height="12" aria-hidden="true"><path d="M2 6 H24 M18 6 L24 1 M18 6 L24 11" stroke="currentColor" strokeWidth="1.4" fill="none" /></svg> many
        </span>
        <span className="text-ink-3">Ctrl + scroll to zoom · drag to move</span>
      </div>

      <svg
        ref={svgRef}
        className="block h-[520px] w-full touch-none select-none sm:h-[720px]"
        onPointerDown={(e) => onPointerDown(e, null)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{ cursor: drag.current?.kind === 'pan' ? 'grabbing' : 'grab' }}
        role="img"
        aria-label={`Diagram of ${data.tables.length} tables and ${data.relationships.length} relationships`}
      >
        <defs>
          <pattern id="er-dots" width={24 * view.k} height={24 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={1} cy={1} r={1} fill="var(--line-strong)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#er-dots)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {edges.map(({ r, path, ax, ay, bx, by, aDir, bDir }) => {
            const active = hovered && (r.from.table === hovered || r.to.table === hovered);
            const faded = hovered && !active;
            const stroke = active ? 'rgb(var(--c-accent))' : 'rgb(var(--c-text-3) / 0.75)';
            const optional = r.cardinality.includes('zero');
            return (
              <g key={r.name} style={{ opacity: faded ? 0.18 : 1, transition: 'opacity 200ms' }}>
                <path d={path} fill="none" stroke={stroke} strokeWidth={active ? 2 : 1.5} strokeDasharray={optional ? '5 4' : undefined} />
                {active && (
                  <circle r="3.5" fill="rgb(var(--c-accent))">
                    <animateMotion dur="1.6s" repeatCount="indefinite" path={path} />
                  </circle>
                )}
                {/* many end: crow's foot */}
                <path d={`M ${ax} ${ay - 6} L ${ax + aDir * 12} ${ay} L ${ax} ${ay + 6} M ${ax} ${ay} H ${ax + aDir * 14}`} stroke={stroke} strokeWidth="1.5" fill="none" />
                {/* one end: a bar, with a circle when the reference is optional */}
                <path d={`M ${bx + bDir * 8} ${by - 6} V ${by + 6}`} stroke={stroke} strokeWidth="1.5" />
                {optional ? <circle cx={bx + bDir * 17} cy={by} r="4" fill="rgb(var(--c-sunken))" stroke={stroke} strokeWidth="1.5" /> : <path d={`M ${bx + bDir * 13} ${by - 6} V ${by + 6}`} stroke={stroke} strokeWidth="1.5" />}
                {active && (
                  <text x={(ax + bx) / 2} y={(ay + by) / 2 - 8} textAnchor="middle" fontSize="11" fill="rgb(var(--c-accent))" style={{ paintOrder: 'stroke', stroke: 'rgb(var(--c-sunken))', strokeWidth: 4 }}>
                    on delete {r.onDelete}
                  </text>
                )}
              </g>
            );
          })}

          {[...tables.values()].map((t) => {
            const tint = GROUP_TINT[t.name] || '#8e8e93';
            return (
              <g
                key={t.name}
                transform={`translate(${t.x} ${t.y})`}
                onPointerDown={(e) => onPointerDown(e, t.name)}
                onPointerEnter={() => setHovered(t.name)}
                onPointerLeave={() => setHovered((h) => (h === t.name ? null : h))}
                style={{ cursor: 'pointer', opacity: dim(t.name) ? 0.35 : 1, transition: 'opacity 200ms' }}
              >
                <rect width={CARD_W} height={t.height} rx="14" fill="rgb(var(--c-surface))" stroke={hovered === t.name ? 'rgb(var(--c-accent))' : 'var(--line)'} strokeWidth={hovered === t.name ? 2 : 1} style={{ filter: 'drop-shadow(0 6px 14px rgb(0 0 0 / 0.08))' }} />
                <rect x="0" y="0" width={CARD_W} height={HEAD_H - 6} rx="14" fill={tint} opacity="0.12" />
                <rect x="14" y="14" width="10" height="10" rx="3" fill={tint} />
                <text x="32" y="23" fontSize="13.5" fontWeight="600" fill="rgb(var(--c-text))" style={{ fontFamily: MONO_FONT }}>{t.name}</text>
                <text x={CARD_W - 14} y="23" fontSize="11" textAnchor="end" fill="rgb(var(--c-text-3))">{Number(t.rows ?? 0).toLocaleString()} rows</text>
                {t.cols.map((c, i) => {
                  const isFk = t.fk.has(`${t.name}.${c.name}`);
                  const y = HEAD_H + i * ROW_H;
                  return (
                    <g key={c.name} transform={`translate(0 ${y})`}>
                      {c.primaryKey ? (
                        <path transform="translate(12 4) scale(0.55)" d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" fill="none" stroke="rgb(var(--c-warning))" strokeWidth="2.4" />
                      ) : isFk ? (
                        <path transform="translate(12 4) scale(0.55)" d="M9 17H7A5 5 0 0 1 7 7h2 M15 7h2a5 5 0 1 1 0 10h-2 M8 12h8" fill="none" stroke="rgb(var(--c-accent))" strokeWidth="2.4" strokeLinecap="round" />
                      ) : (
                        <circle cx="18.5" cy="11" r="2" fill="var(--line-strong)" />
                      )}
                      <text x="32" y="15" fontSize="12" fill={c.primaryKey || isFk ? 'rgb(var(--c-text))' : 'rgb(var(--c-text-2))'} fontWeight={c.primaryKey ? 600 : 400} style={{ fontFamily: MONO_FONT }}>
                        {c.name}
                      </text>
                      <text x={CARD_W - 14} y="15" fontSize="10.5" textAnchor="end" fill="rgb(var(--c-text-3))" style={{ fontFamily: MONO_FONT }}>
                        {String(c.type).replace('timestamp with time zone', 'timestamptz').replace('character varying', 'varchar').slice(0, 16)}{c.nullable ? '?' : ''}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cn('pointer-events-none absolute bottom-3 left-4 text-[11.5px] text-ink-3')}>
        Dashed lines are optional references · click a table to open it
      </motion.p>
    </div>
  );
}
