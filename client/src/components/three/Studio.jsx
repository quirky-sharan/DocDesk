import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';

/**
 * A soft product-photography studio: an environment lit by a few large panels
 * (rendered locally - no image files fetched), a key light, and a contact
 * shadow under everything. Shared by every 3D scene so they feel like one set.
 */
export function Studio({ dark, shadowY = -0.01, shadowScale = 14, shadowOpacity }) {
  return (
    <>
      <ambientLight intensity={dark ? 0.35 : 0.55} />
      <directionalLight position={[5, 8, 4]} intensity={dark ? 1.1 : 1.5} castShadow={false} />
      <directionalLight position={[-6, 3, -4]} intensity={dark ? 0.5 : 0.35} color={dark ? '#7d7aff' : '#b9d4ff'} />
      <Environment resolution={256} frames={1}>
        <group rotation={[-Math.PI / 3, 0, 1]}>
          <Lightformer form="rect" intensity={dark ? 2.5 : 4} position={[0, 5, -9]} scale={[10, 10, 1]} />
          <Lightformer form="rect" intensity={dark ? 1.2 : 2} rotation-y={Math.PI / 2} position={[-5, 1, -1]} scale={[20, 0.6, 1]} />
          <Lightformer form="rect" intensity={dark ? 1.2 : 2} rotation-y={-Math.PI / 2} position={[10, 1, 0]} scale={[20, 1, 1]} />
          <Lightformer form="ring" color={dark ? '#5e5ce6' : '#8fb8ff'} intensity={dark ? 3 : 2} position={[8, 4, 6]} scale={3} />
        </group>
      </Environment>
      <ContactShadows position={[0, shadowY, 0]} opacity={shadowOpacity ?? (dark ? 0.7 : 0.35)} scale={shadowScale} blur={2.6} far={4} resolution={512} />
    </>
  );
}

/** The canvas every scene uses: transparent, capped pixel ratio, paused when off screen. */
export function StageCanvas({ active, camera, children, onPointerMissed, style }) {
  return (
    <Canvas
      frameloop={active ? 'always' : 'never'}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={camera}
      onPointerMissed={onPointerMissed}
      style={{ background: 'transparent', touchAction: 'pan-y', ...style }}
    >
      {children}
    </Canvas>
  );
}
