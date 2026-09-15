import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Float, OrbitControls, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { StageCanvas, Studio } from './Studio';

const ORBITS = [
  { radius: 2.05, tilt: [0.35, 0, 0.1], speed: 0.55, color: '#0a84ff' },
  { radius: 2.35, tilt: [-0.5, 0.3, -0.2], speed: -0.4, color: '#bf5af2' },
  { radius: 1.8, tilt: [1.2, 0.4, 0.3], speed: 0.7, color: '#30d158' },
];

/** The classic database symbol - three stacked platters - in glass and light. */
function Platters({ dark, pulse }) {
  const glow = useRef([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    glow.current.forEach((ring, i) => {
      if (ring) ring.emissiveIntensity = 0.8 + Math.sin(t * 2.4 * pulse + i * 1.4) * 0.6;
    });
  });

  const body = dark ? '#2a2f3a' : '#e9eef6';
  return (
    <group>
      {[0.95, 0, -0.95].map((y, i) => (
        <group key={y} position={[0, y, 0]}>
          <mesh>
            <cylinderGeometry args={[1.25, 1.25, 0.72, 96, 1]} />
            <meshPhysicalMaterial color={body} roughness={0.12} metalness={0.25} clearcoat={1} clearcoatRoughness={0.05} />
          </mesh>
          {/* The seam of light around each platter. */}
          <mesh position={[0, 0.37, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.255, 0.022, 16, 128]} />
            <meshStandardMaterial ref={(m) => (glow.current[i] = m)} color="#8fb8ff" emissive={i === 1 ? '#bf5af2' : '#0a84ff'} emissiveIntensity={1} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.362, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[1.23, 96]} />
            <meshPhysicalMaterial color={dark ? '#343b48' : '#f7f9fc'} roughness={0.08} clearcoat={1} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Little packets of light circling the core - one orbit per kind of work, speed follows real activity. */
function Traffic({ pulse }) {
  const packets = useRef([]);
  const layout = useMemo(
    () => ORBITS.flatMap((orbit, o) => Array.from({ length: 5 }, (_, i) => ({ orbit, o, phase: (i / 5) * Math.PI * 2 }))),
    []
  );
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    layout.forEach(({ orbit, phase }, i) => {
      const mesh = packets.current[i];
      if (!mesh) return;
      const angle = phase + t * orbit.speed * pulse;
      mesh.position.set(Math.cos(angle) * orbit.radius, 0, Math.sin(angle) * orbit.radius);
      const s = 0.8 + Math.sin(t * 4 + i) * 0.2;
      mesh.scale.setScalar(s);
    });
  });

  return layout.map(({ orbit, o }, i) => (
    <group key={i} rotation={orbit.tilt}>
      <mesh ref={(m) => (packets.current[i] = m)}>
        <sphereGeometry args={[0.055, 16, 16]} />
        <meshStandardMaterial color={orbit.color} emissive={orbit.color} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      {i % 5 === 0 && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[orbit.radius, 0.004, 8, 180]} />
          <meshBasicMaterial color={ORBITS[o].color} transparent opacity={0.22} />
        </mesh>
      )}
    </group>
  ));
}

function Core({ dark, reduced, activity }) {
  const group = useRef(null);
  // Busier database, faster traffic - clamped so it never becomes frantic.
  const pulse = THREE.MathUtils.clamp(0.6 + (activity || 0) * 0.08, 0.6, 2.2);
  useFrame((state, delta) => {
    if (group.current && !reduced) group.current.rotation.y += delta * 0.18;
  });
  return (
    <Float speed={reduced ? 0 : 1.4} rotationIntensity={reduced ? 0 : 0.25} floatIntensity={reduced ? 0 : 0.6}>
      <group ref={group} rotation={[0.18, 0, 0]} scale={0.82}>
        <Platters dark={dark} pulse={pulse} />
        {!reduced && <Traffic pulse={pulse} />}
      </group>
    </Float>
  );
}

export default function DatabaseCore3D({ active, reduced, dark = false, activity = 0 }) {
  return (
    <StageCanvas active={active} camera={{ position: [0, 1.2, 7.6], fov: 34 }}>
      <group position={[0, 0.1, 0]}>
        <Core dark={dark} reduced={reduced} activity={activity} />
        {!reduced && <Sparkles count={40} scale={[6, 4, 6]} size={2.2} speed={0.3} opacity={dark ? 0.6 : 0.35} color={dark ? '#8fb8ff' : '#5e5ce6'} />}
        <group position={[0, -2.1, 0]}>
          <Studio dark={dark} shadowScale={8} shadowOpacity={dark ? 0.6 : 0.25} />
        </group>
      </group>
      <OrbitControls enablePan={false} enableZoom={false} enableDamping minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 1.9} rotateSpeed={0.5} />
    </StageCanvas>
  );
}
