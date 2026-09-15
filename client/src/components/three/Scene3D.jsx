import { Component, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import { Box } from 'lucide-react';

/**
 * Hosts a 3D scene: loads three.js only when the scene is about to be seen,
 * pauses rendering while it is off screen, and falls back to `fallback` when
 * the device has no WebGL or the scene fails - a 3D view is never the only way
 * to read anything.
 */

let webglSupport = null;
export function hasWebGL() {
  if (webglSupport !== null) return webglSupport;
  try {
    const canvas = document.createElement('canvas');
    webglSupport = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

class SceneBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn('[3d] scene failed, showing the flat view instead:', error?.message);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Loading() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-3 text-ink-3">
        <div className="relative h-10 w-10">
          <Box size={40} strokeWidth={1.2} className="animate-spin-slow opacity-60" />
        </div>
        <span className="text-[12px]">Building the 3D view…</span>
      </div>
    </div>
  );
}

/**
 * `load` is a function returning a dynamic import, e.g. () => import('./StockCity3D').
 * Everything else is passed to the scene, plus `active` (on screen) and `reduced`.
 */
export default function Scene3D({ load, fallback = null, height = 320, className = '', ...sceneProps }) {
  const ref = useRef(null);
  const nearView = useInView(ref, { margin: '200px 0px 200px 0px' });
  const onScreen = useInView(ref, { margin: '0px' });
  const reduced = useReducedMotion();
  const [SceneComponent, setSceneComponent] = useState(null);
  const [supported] = useState(hasWebGL);

  useEffect(() => {
    if (!nearView || SceneComponent || !supported) return;
    setSceneComponent(() => lazy(load));
  }, [nearView, SceneComponent, supported, load]);

  return (
    <div ref={ref} className={`relative w-full ${className}`} style={{ height }}>
      {!supported ? (
        fallback
      ) : SceneComponent ? (
        <SceneBoundary fallback={fallback}>
          <Suspense fallback={<Loading />}>
            <SceneComponent active={onScreen} reduced={Boolean(reduced)} {...sceneProps} />
          </Suspense>
        </SceneBoundary>
      ) : (
        <Loading />
      )}
    </div>
  );
}
