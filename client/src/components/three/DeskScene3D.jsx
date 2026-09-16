import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Edges, Line, MeshTransmissionMaterial, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { StageCanvas, Studio } from './Studio';

/**
 * The desk, as an object.
 *
 * A dashboard rebuilt in glass: one large refracting panel with the week's
 * takings standing inside it, two frosted satellites carrying a ring and a
 * trend line, and a slow ring of receipts orbiting the lot. It is deliberately
 * almost colourless - a single accent on one bar and one ring is the only
 * colour in the frame, so the eye lands where the numbers are.
 *
 * Nothing here is decorative only: the shapes are the same four things the real
 * dashboard shows, which is why it reads as a product rather than a screensaver.
 */

const BARS = [0.34, 0.52, 0.41, 0.68, 0.55, 0.83, 0.62, 0.95, 0.71, 1, 0.78, 0.58];
const TREND = [0.12, 0.3, 0.22, 0.46, 0.38, 0.62, 0.55, 0.8, 0.72, 0.94];

function palette(dark) {
  return dark
    ? {
        glass: '#dadae4',
        card: '#2b2b34',
        panel: '#3a3a44',
        bar: '#f2f2f5',
        barDim: '#7e7e88',
        accent: '#4c9dff',
        line: '#e6e6ea',
        dot: '#6b6b78',
        token: '#42424c',
        edge: '#b9b9c6',
        cardGlow: 0.08,
      }
    : {
        glass: '#fdfdff',
        card: '#ffffff',
        panel: '#ffffff',
        bar: '#1d1d1f',
        barDim: '#b6b6bd',
        accent: '#0071e3',
        line: '#1d1d1f',
        dot: '#c3c3cb',
        token: '#ffffff',
        edge: '#0f0f12',
        cardGlow: 0.55,
      };
}

/** The bars that stand inside the main panel - the week, at a glance. */
function Takings({ colors, reduced }) {
  const group = useRef(null);
  const grown = useRef(reduced ? 1 : 0);

  useFrame((state, delta) => {
    if (!group.current) return;
    grown.current = THREE.MathUtils.damp(grown.current, 1, 2.6, delta);
    const t = state.clock.elapsedTime;
    group.current.children.forEach((bar, i) => {
      const target = BARS[i] * grown.current;
      // Each bar breathes a little, out of phase, so the row is never static.
      const breathe = reduced ? 0 : Math.sin(t * 0.9 + i * 0.55) * 0.016;
      const height = Math.max(target + breathe, 0.001);
      bar.scale.y = height;
      bar.position.y = -0.62 + height * 0.62;
    });
  });

  return (
    <group ref={group} position={[0, 0, -0.06]}>
      {BARS.map((value, i) => {
        const isPeak = value === 1;
        return (
          <mesh key={i} position={[(i - (BARS.length - 1) / 2) * 0.216, -0.62, 0]} scale={[1, 0.001, 1]}>
            <boxGeometry args={[0.1, 1.24, 0.05]} />
            <meshStandardMaterial
              color={isPeak ? colors.accent : i > BARS.length - 5 ? colors.bar : colors.barDim}
              roughness={0.42}
              metalness={0.05}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/** A frosted satellite panel. Cheap: no refraction buffer, just soft glass. */
function Satellite({ position, rotation, size, colors, children, drift = 1 }) {
  const ref = useRef(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.position.y = position[1] + Math.sin(t * 0.55 * drift + position[0]) * 0.055;
  });

  return (
    <group ref={ref} position={position} rotation={rotation}>
      <RoundedBox args={[size[0], size[1], 0.05]} radius={0.05} smoothness={4}>
        <meshPhysicalMaterial
          color={colors.panel}
          transparent
          opacity={0.56}
          roughness={0.12}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.14}
          side={THREE.DoubleSide}
        />
        <Edges threshold={15} color={colors.edge} transparent opacity={0.3} />
      </RoundedBox>
      <group position={[0, 0, 0.05]}>{children}</group>
    </group>
  );
}

/** How much of today's target is in - the one other place colour is allowed. */
function ProgressRing({ colors, reduced }) {
  const ring = useRef(null);
  useFrame((state, delta) => {
    if (!ring.current) return;
    ring.current.rotation.z = reduced ? -Math.PI / 2 : -Math.PI / 2 - state.clock.elapsedTime * 0.28;
    const eased = Math.min(1, state.clock.elapsedTime / 2.4);
    const scale = THREE.MathUtils.damp(ring.current.scale.x, 0.4 + eased * 0.6, 3, delta);
    ring.current.scale.setScalar(scale);
  });

  return (
    <group>
      <mesh>
        <torusGeometry args={[0.26, 0.018, 12, 64]} />
        <meshStandardMaterial color={colors.barDim} roughness={0.5} transparent opacity={0.5} />
      </mesh>
      <mesh ref={ring} scale={0.4}>
        {/* A 72% arc: an open ring reads as a measurement, a closed one as a logo. */}
        <torusGeometry args={[0.26, 0.026, 14, 64, Math.PI * 1.44]} />
        <meshStandardMaterial color={colors.accent} roughness={0.28} metalness={0.15} />
      </mesh>
    </group>
  );
}

/** The trend, drawn as a line - the same shape the reports page plots. */
function TrendLine({ colors }) {
  const points = useMemo(
    () => TREND.map((value, i) => [(i / (TREND.length - 1) - 0.5) * 0.9, (value - 0.5) * 0.44, 0]),
    []
  );
  const head = points[points.length - 1];
  return (
    <group>
      <Line points={points} color={colors.line} lineWidth={2.4} transparent opacity={0.85} />
      <mesh position={head}>
        <sphereGeometry args={[0.028, 16, 16]} />
        <meshStandardMaterial color={colors.accent} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** Receipts, filed. They orbit slowly and catch the key light one at a time. */
function Orbit({ colors, reduced }) {
  const group = useRef(null);
  const count = 7;
  useFrame((state, delta) => {
    if (!group.current) return;
    if (!reduced) group.current.rotation.y += delta * 0.12;
    group.current.children.forEach((token, i) => {
      token.rotation.x = Math.sin(state.clock.elapsedTime * 0.4 + i) * 0.22;
    });
  });

  return (
    <group ref={group} rotation={[0.28, 0, 0.06]}>
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        return (
          <group key={i} position={[Math.cos(angle) * 2.55, Math.sin(angle * 2) * 0.24, Math.sin(angle) * 1.25]}>
            <RoundedBox args={[0.3, 0.4, 0.016]} radius={0.015} smoothness={3} rotation={[0, -angle, 0.1]}>
              <meshPhysicalMaterial
                color={colors.token}
                transparent
                opacity={0.72}
                roughness={0.3}
                clearcoat={0.8}
                side={THREE.DoubleSide}
              />
              <Edges threshold={15} color={colors.edge} transparent opacity={0.22} />
            </RoundedBox>
          </group>
        );
      })}
    </group>
  );
}

/** A field of dots under everything: a desk surface without drawing a desk. */
function DotField({ colors }) {
  const geometry = useMemo(() => {
    const positions = [];
    const step = 0.34;
    for (let x = -14; x <= 14; x += 1) {
      for (let z = -10; z <= 10; z += 1) {
        if (Math.hypot(x, z) > 14) continue;
        positions.push(x * step, 0, z * step);
      }
    }
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return buffer;
  }, []);

  return (
    <points geometry={geometry} position={[0, -1.55, 0]}>
      <pointsMaterial color={colors.dot} size={0.026} sizeAttenuation transparent opacity={0.85} depthWrite={false} />
    </points>
  );
}

/** How wide the composition is, in world units, including the orbiting tokens. */
const SPAN = 5.2;

function Desk({ dark, reduced }) {
  const colors = useMemo(() => palette(dark), [dark]);
  const rig = useRef(null);
  const entrance = useRef(reduced ? 1 : 0);
  const { size, camera } = useThree();

  // The hero column is a tall box on a laptop and a wide one on a large screen,
  // so a fixed camera distance clips the satellites on one and strands the
  // panel in the middle of the other. Framing is worked out from the canvas
  // instead: back off until the whole span fits, with a little air around it.
  useMemo(() => {
    const aspect = Math.max(size.width / Math.max(size.height, 1), 0.35);
    const fovRadians = (camera.fov * Math.PI) / 180;
    const needed = SPAN / aspect / (2 * Math.tan(fovRadians / 2));
    camera.position.z = THREE.MathUtils.clamp(needed, 6.4, 13);
    camera.updateProjectionMatrix();
  }, [size.width, size.height, camera]);

  useFrame((state, delta) => {
    if (!rig.current) return;
    entrance.current = THREE.MathUtils.damp(entrance.current, 1, 2, delta);
    const { x, y } = state.pointer;
    const t = state.clock.elapsedTime;
    // The whole rig leans towards the pointer and drifts; small numbers on
    // purpose, so it feels like weight rather than a toy chasing the mouse.
    const targetY = reduced ? 0 : x * 0.22 + Math.sin(t * 0.22) * 0.04;
    const targetX = reduced ? 0.02 : -y * 0.12 + 0.03;
    rig.current.rotation.y = THREE.MathUtils.damp(rig.current.rotation.y, targetY, 2.4, delta);
    rig.current.rotation.x = THREE.MathUtils.damp(rig.current.rotation.x, targetX, 2.4, delta);
    rig.current.position.y = (1 - entrance.current) * -1.4 + (reduced ? 0 : Math.sin(t * 0.45) * 0.05);
    rig.current.scale.setScalar(0.88 + entrance.current * 0.12);
  });

  return (
    <group ref={rig}>
      {/* The main panel, built the way the real object would be: a card, the
          numbers standing on it, and a sheet of glass over the top. The card is
          what makes the glass read as glass - with nothing behind it the
          refraction has only the empty canvas to bend and goes flat black. */}
      <group position={[0, 0.15, 0]}>
        <RoundedBox args={[3.25, 2.06, 0.06]} radius={0.06} smoothness={4} position={[0, 0, -0.34]}>
          {/* Lit from the front by its own emission as well as the rig: a matte
              white card angled away from the key light otherwise renders mid
              grey, and the panel reads as a slab instead of a screen. */}
          <meshStandardMaterial
            color={colors.card}
            roughness={0.6}
            metalness={0}
            emissive={colors.card}
            emissiveIntensity={colors.cardGlow}
          />
          <Edges threshold={15} color={colors.edge} transparent opacity={0.12} />
        </RoundedBox>

        <RoundedBox args={[3.05, 1.9, 0.1]} radius={0.07} smoothness={5}>
          <MeshTransmissionMaterial
            samples={5}
            resolution={512}
            thickness={0.2}
            roughness={0.04}
            anisotropy={0.2}
            chromaticAberration={0.055}
            distortion={0.06}
            distortionScale={0.18}
            temporalDistortion={0.015}
            ior={1.34}
            color={colors.glass}
            backside={false}
          />
          <Edges threshold={15} color={colors.edge} transparent opacity={0.2} />
        </RoundedBox>
        <Takings colors={colors} reduced={reduced} />
      </group>

      <Satellite position={[-1.98, 0.88, 0.85]} rotation={[0, 0.42, 0.04]} size={[0.96, 0.96]} colors={colors} drift={1.2}>
        <ProgressRing colors={colors} reduced={reduced} />
      </Satellite>

      <Satellite position={[2.02, -0.72, 0.8]} rotation={[0, -0.4, -0.03]} size={[1.16, 0.76]} colors={colors} drift={0.85}>
        <TrendLine colors={colors} />
      </Satellite>

      <Orbit colors={colors} reduced={reduced} />
      <DotField colors={colors} />
    </group>
  );
}

export default function DeskScene3D({ active = true, reduced = false, dark = false }) {
  return (
    <StageCanvas active={active} camera={{ position: [0, 0.85, 7.1], fov: 33 }}>
      <Studio dark={dark} shadowY={-1.6} shadowScale={12} shadowOpacity={dark ? 0.45 : 0.24} />
      {/* A soft fill from where the viewer is, so the faces pointing at the
          camera are not the darkest ones in the frame. */}
      <directionalLight position={[0, 1.5, 7]} intensity={dark ? 0.35 : 0.7} />
      <Desk dark={dark} reduced={reduced} />
    </StageCanvas>
  );
}
