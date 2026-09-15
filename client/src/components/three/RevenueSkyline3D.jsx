import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, OrbitControls, RoundedBox, useCursor } from '@react-three/drei';
import * as THREE from 'three';
import { StageCanvas, Studio } from './Studio';

const LOW = new THREE.Color('#3aa0ff');
const HIGH = new THREE.Color('#8e6cf0');
const DARK_LOW = new THREE.Color('#2f8cff');
const DARK_HIGH = new THREE.Color('#a78bfa');

function Bar({ index, count, value, max, label, meta, dark, hovered, setHovered, delay, reduced, today }) {
  const group = useRef(null);
  const material = useRef(null);
  const grown = useRef(reduced ? 1 : 0);
  const ratio = max > 0 ? value / max : 0;
  const height = 0.12 + ratio * 2.5;
  const spacing = 0.52;
  const x = (index - (count - 1) / 2) * spacing;
  // A gentle arc, so the row reads as a sculpture rather than a chart.
  const z = -Math.pow(index - (count - 1) / 2, 2) * 0.018;
  const color = useMemo(
    () => (dark ? DARK_LOW.clone().lerp(DARK_HIGH, ratio) : LOW.clone().lerp(HIGH, ratio)),
    [ratio, dark]
  );
  const isHovered = hovered === index;
  useCursor(isHovered);

  useFrame((state, delta) => {
    if (!group.current) return;
    const elapsed = state.clock.elapsedTime;
    const target = elapsed > delay || reduced ? 1 : 0;
    grown.current = THREE.MathUtils.damp(grown.current, target, reduced ? 100 : 4.2, delta);
    const lift = isHovered ? 0.1 : 0;
    group.current.scale.y = Math.max(grown.current, 0.0001);
    group.current.position.y = THREE.MathUtils.damp(group.current.position.y, lift, 8, delta);
    if (material.current) {
      material.current.emissiveIntensity = THREE.MathUtils.damp(material.current.emissiveIntensity, isHovered ? 0.55 : today ? 0.25 : 0.04, 6, delta);
      material.current.opacity = THREE.MathUtils.damp(material.current.opacity, hovered === null || isHovered ? 1 : 0.55, 6, delta);
    }
  });

  return (
    <group position={[x, 0, z]}>
      <group ref={group}>
        <RoundedBox
          args={[0.34, height, 0.34]}
          radius={0.06}
          smoothness={4}
          position={[0, height / 2, 0]}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(index);
          }}
          onPointerOut={() => setHovered((h) => (h === index ? null : h))}
        >
          <meshPhysicalMaterial
            ref={material}
            color={color}
            emissive={color}
            emissiveIntensity={0.04}
            roughness={0.16}
            metalness={0.08}
            clearcoat={1}
            clearcoatRoughness={0.08}
            transparent
          />
        </RoundedBox>
      </group>
      {today && <TodayMarker height={height} />}
      {isHovered && (
        <Html position={[0, height + 0.45, 0]} center distanceFactor={9} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="glass whitespace-nowrap rounded-xl px-3 py-2 text-center" style={{ background: 'var(--glass-strong)' }}>
            <div className="text-[13px] font-semibold text-ink tabular">{meta}</div>
            <div className="text-[11px] text-ink-2">{label}</div>
          </div>
        </Html>
      )}
    </group>
  );
}

function TodayMarker({ height }) {
  const ref = useRef(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.position.y = height + 0.32 + Math.sin(t * 2.2) * 0.06;
    ref.current.rotation.y = t * 1.2;
  });
  return (
    <mesh ref={ref} position={[0, height + 0.32, 0]}>
      <octahedronGeometry args={[0.09, 0]} />
      <meshStandardMaterial color="#ffffff" emissive="#8fb8ff" emissiveIntensity={1.4} roughness={0.2} />
    </mesh>
  );
}

function Sculpture({ data, dark, reduced, formatValue, formatLabel }) {
  const root = useRef(null);
  const [hovered, setHovered] = useState(null);
  const max = Math.max(...data.map((d) => d.value), 0);

  useFrame((state, delta) => {
    if (!root.current || reduced) return;
    // A slow, breathing sway - the scene is alive without asking for attention.
    const target = Math.sin(state.clock.elapsedTime * 0.18) * 0.28 + (hovered !== null ? 0 : 0);
    root.current.rotation.y = THREE.MathUtils.damp(root.current.rotation.y, hovered === null ? target : root.current.rotation.y, 2, delta);
  });

  const width = data.length * 0.52 + 0.8;
  return (
    <group ref={root} position={[1.1, -1.55, 0]}>
      <RoundedBox args={[width, 0.12, 1.5]} radius={0.05} smoothness={4} position={[0, -0.06, -0.12]}>
        <meshPhysicalMaterial color={dark ? '#1c1c20' : '#f4f5f8'} roughness={0.35} metalness={0.1} clearcoat={0.6} />
      </RoundedBox>
      {data.map((d, i) => (
        <Bar
          key={d.key}
          index={i}
          count={data.length}
          value={d.value}
          max={max}
          label={formatLabel(d)}
          meta={formatValue(d.value)}
          dark={dark}
          hovered={hovered}
          setHovered={setHovered}
          delay={0.15 + i * 0.045}
          reduced={reduced}
          today={i === data.length - 1}
        />
      ))}
      <Studio dark={dark} shadowY={-0.12} shadowScale={width + 4} />
    </group>
  );
}

/** Daily revenue as a row of glass columns. The 2D chart beside it carries the exact values. */
export default function RevenueSkyline3D({ active, reduced, data = [], dark = false, formatValue = String, formatLabel = (d) => d.key }) {
  return (
    <StageCanvas active={active} camera={{ position: [0, 1.5, 9.2], fov: 34 }}>
      <Sculpture data={data} dark={dark} reduced={reduced} formatValue={formatValue} formatLabel={formatLabel} />
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={Math.PI / 2.9}
        maxPolarAngle={Math.PI / 2.05}
        minAzimuthAngle={-0.7}
        maxAzimuthAngle={0.7}
        rotateSpeed={0.5}
      />
    </StageCanvas>
  );
}
