import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, OrbitControls, RoundedBox, useCursor } from '@react-three/drei';
import * as THREE from 'three';
import { StageCanvas, Studio } from './Studio';

const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const CELL = 0.36;

// One hue, light to deep: more always reads as more, as on the flat heatmap.
const LIGHT = [new THREE.Color('#dcebff'), new THREE.Color('#2a78d6')];
const DARK = [new THREE.Color('#1d3350'), new THREE.Color('#5aa2ff')];

function hourLabel(h) {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function Column({ x, z, ratio, dark, delay, reduced, id, hovered, setHovered, tooltip }) {
  const group = useRef(null);
  const material = useRef(null);
  const grown = useRef(reduced ? 1 : 0);
  const height = 0.04 + ratio * 1.9;
  const color = useMemo(() => {
    const [lo, hi] = dark ? DARK : LIGHT;
    return lo.clone().lerp(hi, Math.sqrt(ratio));
  }, [ratio, dark]);
  const isHovered = hovered === id;
  useCursor(isHovered);

  useFrame((state, delta) => {
    if (!group.current) return;
    const target = state.clock.elapsedTime > delay || reduced ? 1 : 0;
    grown.current = THREE.MathUtils.damp(grown.current, target, reduced ? 100 : 5, delta);
    group.current.scale.y = Math.max(grown.current, 0.0001);
    group.current.position.y = THREE.MathUtils.damp(group.current.position.y, isHovered ? 0.08 : 0, 10, delta);
    if (material.current) {
      material.current.emissiveIntensity = THREE.MathUtils.damp(material.current.emissiveIntensity, isHovered ? 0.6 : 0.03, 8, delta);
    }
  });

  return (
    <group position={[x, 0, z]}>
      <group ref={group}>
        <RoundedBox
          args={[CELL * 0.82, height, CELL * 0.82]}
          radius={0.04}
          smoothness={3}
          position={[0, height / 2, 0]}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(id);
          }}
          onPointerOut={() => setHovered((h) => (h === id ? null : h))}
        >
          <meshPhysicalMaterial ref={material} color={color} emissive={color} emissiveIntensity={0.03} roughness={0.22} metalness={0.05} clearcoat={0.9} clearcoatRoughness={0.1} />
        </RoundedBox>
      </group>
      {isHovered && (
        <Html position={[0, height + 0.35, 0]} center distanceFactor={8} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="glass whitespace-nowrap rounded-xl px-3 py-2 text-center" style={{ background: 'var(--glass-strong)' }}>
            <div className="text-[13px] font-semibold text-ink tabular">{tooltip.value}</div>
            <div className="text-[11px] text-ink-2">{tooltip.label}</div>
          </div>
        </Html>
      )}
    </group>
  );
}

function Terrain({ cells, metric, dark, reduced, formatValue, unit }) {
  const root = useRef(null);
  const [hovered, setHovered] = useState(null);

  const { columns, hours, width, depth } = useMemo(() => {
    const map = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c]));
    let lo = 24;
    let hi = -1;
    let peak = 0;
    for (const c of cells) {
      const v = Number(c[metric]) || 0;
      if (v > 0) {
        lo = Math.min(lo, c.hour);
        hi = Math.max(hi, c.hour);
        peak = Math.max(peak, v);
      }
    }
    const start = Math.min(lo, 9);
    const end = Math.max(hi, 18);
    const hourList = [];
    for (let h = start; h <= end; h++) hourList.push(h);
    const list = [];
    DAYS.forEach(([dow, name], row) => {
      hourList.forEach((h, col) => {
        const cell = map.get(`${dow}-${h}`);
        const value = Number(cell?.[metric]) || 0;
        list.push({
          id: `${dow}-${h}`,
          x: (col - (hourList.length - 1) / 2) * CELL,
          z: (row - 3) * CELL,
          ratio: peak ? value / peak : 0,
          delay: 0.1 + (row + col) * 0.025,
          tooltip: { value: `${formatValue(value)}${metric === 'count' ? ` ${unit}` : ''}`, label: `${name} · ${hourLabel(h)}` },
        });
      });
    });
    return { columns: list, hours: hourList, width: hourList.length * CELL, depth: DAYS.length * CELL };
  }, [cells, metric, formatValue, unit]);

  useFrame((state, delta) => {
    if (!root.current || reduced) return;
    const target = hovered === null ? Math.sin(state.clock.elapsedTime * 0.15) * 0.14 - 0.18 : root.current.rotation.y;
    root.current.rotation.y = THREE.MathUtils.damp(root.current.rotation.y, target, 1.6, delta);
  });

  return (
    <group ref={root} position={[0, -0.35, 0.25]} rotation={[0, -0.18, 0]}>
      <RoundedBox args={[width + 0.5, 0.1, depth + 0.5]} radius={0.06} smoothness={4} position={[0, -0.05, 0]}>
        <meshPhysicalMaterial color={dark ? '#1c1c20' : '#f4f5f8'} roughness={0.4} metalness={0.1} clearcoat={0.5} />
      </RoundedBox>
      {columns.map((c) => (
        <Column key={c.id} {...c} dark={dark} reduced={reduced} hovered={hovered} setHovered={setHovered} />
      ))}
      {DAYS.map(([dow, name], row) => (
        <Html key={dow} position={[-width / 2 - 0.45, 0.02, (row - 3) * CELL]} center distanceFactor={5.5} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <span className="text-[10px] font-medium text-ink-3">{name}</span>
        </Html>
      ))}
      {hours.filter((_, i) => i % 3 === 0).map((h) => (
        <Html key={h} position={[(hours.indexOf(h) - (hours.length - 1) / 2) * CELL, 0.02, depth / 2 + 0.42]} center distanceFactor={5.5} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <span className="whitespace-nowrap text-[10px] text-ink-3">{hourLabel(h)}</span>
        </Html>
      ))}
      <Studio dark={dark} shadowY={-0.1} shadowScale={width + 4} />
    </group>
  );
}

/** The week's trade as a landscape: each column an hour on a day, taller is busier. */
export default function BusyHours3D({ active, reduced, cells = [], metric = 'count', dark = false, formatValue = String, unit = 'sales' }) {
  return (
    <StageCanvas active={active} camera={{ position: [0, 4.6, 4.4], fov: 40 }}>
      <Terrain cells={cells} metric={metric} dark={dark} reduced={reduced} formatValue={formatValue} unit={unit} />
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={Math.PI / 5}
        maxPolarAngle={Math.PI / 2.3}
        rotateSpeed={0.5}
      />
    </StageCanvas>
  );
}
