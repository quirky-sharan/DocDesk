import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, OrbitControls, RoundedBox, useCursor } from '@react-three/drei';
import * as THREE from 'three';
import { StageCanvas, Studio } from './Studio';

// Status colours are the fixed status palette (see index.css), so a red tower
// means the same thing here as a red badge in the table.
const STATUS = {
  ok: { light: '#6f9fe0', dark: '#4d86d6' },
  low: { light: '#fab219', dark: '#fab219' },
  out: { light: '#d03b3b', dark: '#e05252' },
};

const CELL = 0.62;
const ROW = 1.05;

function Tower({ product, position, height, reorderHeight, dark, hovered, setHovered, onSelect, delay, reduced }) {
  const body = useRef(null);
  const material = useRef(null);
  const grown = useRef(reduced ? 1 : 0);
  const isHovered = hovered === product.id;
  const status = product.stock_status || (product.stock_quantity <= 0 ? 'out' : product.reorder_level > 0 && product.stock_quantity <= product.reorder_level ? 'low' : 'ok');
  const color = STATUS[status][dark ? 'dark' : 'light'];
  useCursor(isHovered);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    grown.current = THREE.MathUtils.damp(grown.current, t > delay || reduced ? 1 : 0, reduced ? 100 : 3.6, delta);
    if (body.current) {
      body.current.scale.y = Math.max(grown.current, 0.0001);
      body.current.position.y = THREE.MathUtils.damp(body.current.position.y, isHovered ? 0.12 : 0, 8, delta);
    }
    if (material.current) {
      // Out-of-stock towers glow softly, like a warning light.
      const pulse = status === 'out' && !reduced ? 0.35 + Math.sin(t * 3) * 0.25 : status === 'low' ? 0.12 : 0.02;
      material.current.emissiveIntensity = THREE.MathUtils.damp(material.current.emissiveIntensity, isHovered ? 0.6 : pulse, 6, delta);
    }
  });

  return (
    <group position={position}>
      <group ref={body}>
        <RoundedBox
          args={[0.42, height, 0.42]}
          radius={0.05}
          smoothness={3}
          position={[0, height / 2, 0]}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(product.id);
          }}
          onPointerOut={() => setHovered((h) => (h === product.id ? null : h))}
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(product);
          }}
        >
          <meshPhysicalMaterial ref={material} color={color} emissive={color} emissiveIntensity={0.02} roughness={0.22} metalness={0.05} clearcoat={0.9} clearcoatRoughness={0.12} />
        </RoundedBox>
      </group>
      {reorderHeight > 0 && (
        // The reorder line: a thin glass slab at the height stock should not fall below.
        <mesh position={[0, reorderHeight, 0]}>
          <boxGeometry args={[0.56, 0.018, 0.56]} />
          <meshBasicMaterial color={dark ? '#ffffff' : '#1d1d1f'} transparent opacity={isHovered ? 0.55 : 0.18} />
        </mesh>
      )}
      {isHovered && (
        <Html position={[0, Math.max(height, reorderHeight) + 0.55, 0]} center distanceFactor={10} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="glass w-max max-w-[220px] rounded-xl px-3 py-2" style={{ background: 'var(--glass-strong)' }}>
            <div className="truncate text-[13px] font-semibold text-ink">{product.name}</div>
            <div className="mt-0.5 text-[12px] text-ink-2 tabular">
              {Number(product.stock_quantity)} in stock · reorder at {Number(product.reorder_level)}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11.5px] font-medium" style={{ color }}>
              <span className="h-2 w-2 rounded-full" style={{ background: color }} />
              {status === 'out' ? 'Out of stock' : status === 'low' ? 'Running low' : 'In stock'}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

function City({ products, dark, reduced, onSelect }) {
  const [hovered, setHovered] = useState(null);
  const root = useRef(null);

  const layout = useMemo(() => {
    const byCategory = new Map();
    for (const product of products) {
      const key = product.category || 'Uncategorised';
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(product);
    }
    const rows = [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const maxStock = Math.max(...products.map((p) => Number(p.stock_quantity) || 0), 1);
    // Log scale, so one product with hundreds in stock doesn't flatten the rest.
    const scale = (value) => 0.06 + (Math.log1p(Math.max(Number(value) || 0, 0)) / Math.log1p(maxStock)) * 2.4;
    const widest = Math.max(...rows.map(([, items]) => items.length), 1);
    const towers = [];
    rows.forEach(([category, items], r) => {
      items.forEach((product, c) => {
        towers.push({
          product,
          category,
          position: [(c - (widest - 1) / 2) * CELL, 0, (r - (rows.length - 1) / 2) * ROW],
          height: scale(product.stock_quantity),
          reorderHeight: Number(product.reorder_level) > 0 ? scale(product.reorder_level) : 0,
          delay: 0.1 + r * 0.12 + c * 0.03,
        });
      });
    });
    const labels = rows.map(([category, items], r) => ({
      category,
      count: items.length,
      position: [-((widest - 1) / 2) * CELL - 0.55, 0.02, (r - (rows.length - 1) / 2) * ROW],
    }));
    return { towers, labels, width: widest * CELL + 1.6, depth: rows.length * ROW + 0.6 };
  }, [products]);

  useFrame((state, delta) => {
    if (!root.current || reduced || hovered !== null) return;
    root.current.rotation.y = THREE.MathUtils.damp(root.current.rotation.y, Math.sin(state.clock.elapsedTime * 0.12) * 0.22, 1.5, delta);
  });

  return (
    <group ref={root} position={[0.4, -0.7, 0]}>
      <RoundedBox args={[layout.width, 0.1, layout.depth]} radius={0.05} smoothness={3} position={[-0.3, -0.05, 0]}>
        <meshPhysicalMaterial color={dark ? '#1a1a1e' : '#f3f4f7'} roughness={0.4} clearcoat={0.5} />
      </RoundedBox>
      {layout.towers.map((tower) => (
        <Tower key={tower.product.id} {...tower} dark={dark} hovered={hovered} setHovered={setHovered} onSelect={onSelect} reduced={reduced} />
      ))}
      {layout.labels.map((label) => (
        <Html key={label.category} position={label.position} center distanceFactor={11} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="-translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-right text-[11.5px] font-semibold text-ink-2" style={{ background: 'var(--glass-bg)' }}>
            {label.category}
            <span className="ml-1 font-normal text-ink-3">{label.count}</span>
          </div>
        </Html>
      ))}
      <Studio dark={dark} shadowY={-0.1} shadowScale={Math.max(layout.width, layout.depth) + 4} />
    </group>
  );
}

/** Every product as a tower: height is stock, the glass slab is its reorder level, colour is its state. */
export default function StockCity3D({ active, reduced, products = [], dark = false, onSelect }) {
  const rows = new Set(products.map((p) => p.category || 'Uncategorised')).size;
  const widest = Math.max(...Object.values(products.reduce((acc, p) => { const k = p.category || 'Uncategorised'; acc[k] = (acc[k] || 0) + 1; return acc; }, {})), 1);
  const distance = 3.2 + rows * 0.75 + widest * 0.32;
  return (
    <StageCanvas active={active} camera={{ position: [distance * 0.42, distance * 0.58, distance * 0.95], fov: 38 }}>
      <City products={products} dark={dark} reduced={reduced} onSelect={onSelect} />
      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={5}
        maxDistance={22}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 2.15}
        rotateSpeed={0.55}
        zoomSpeed={0.6}
      />
    </StageCanvas>
  );
}
