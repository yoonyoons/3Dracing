import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CarModel } from './CarModel';
import { AdaptiveDpr, initialDpr } from './AdaptiveDpr';
import type { CarLook } from './types';

function nameTexture(name: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 34px system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const w = Math.min(244, g.measureText(name).width + 36);
  g.fillStyle = '#fff';
  g.beginPath();
  g.roundRect((256 - w) / 2, 6, w, 52, 26);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 5;
  g.stroke();
  g.fillStyle = '#22223b';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128, 34, 220);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Spinner({ look, position, label, speed = 0.7 }: { look: CarLook; position: [number, number, number]; label: boolean; speed?: number }) {
  const ref = useRef<THREE.Group>(null);
  const tex = useMemo(() => (label ? nameTexture(look.name, look.color) : null), [label, look.name, look.color]);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += Math.min(dt, 0.1) * speed;
  });
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[2.6, 28]} />
        <meshBasicMaterial color={look.color} transparent opacity={0.35} />
      </mesh>
      <group ref={ref} rotation={[0, -0.9, 0]}>
        <CarModel look={look} />
      </group>
      {tex && (
        <sprite position={[0, -0.2, 3.1]} scale={[4.4, 1.1, 1]}>
          <spriteMaterial map={tex} transparent />
        </sprite>
      )}
    </group>
  );
}

const corner = new THREE.Vector3();

function FitCamera({ cols, rows, cell }: { cols: number; rows: number; cell: number }) {
  const { camera, size } = useThree();
  const fitted = useRef('');
  useFrame(() => {
    const key = `${cols}x${rows}@${size.width}x${size.height}`;
    if (fitted.current === key) return;
    fitted.current = key;
    const cam = camera as THREE.PerspectiveCamera;
    cam.aspect = size.width / size.height;
    cam.updateProjectionMatrix();
    // 차가 놓인 상자의 모서리 8개가 모두 화면 안(가장자리 8% 여유)에 들어오는 가장 가까운 거리를 찾습니다.
    const hw = (cols * cell) / 2;
    const hd = (rows * cell) / 2 + 1;
    const place = (dist: number) => {
      cam.position.set(0, dist * 0.6, dist * 0.8);
      cam.lookAt(0, 0.6, 0.6);
      cam.updateMatrixWorld();
    };
    const fits = (dist: number) => {
      place(dist);
      for (const x of [-hw, hw]) for (const y of [0, 2.6]) for (const z of [-hd, hd]) {
        corner.set(x, y, z).project(cam);
        if (Math.abs(corner.x) > 0.92 || Math.abs(corner.y) > 0.92 || corner.z > 1) return false;
      }
      return true;
    };
    let lo = 3, hi = 400;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid; else lo = mid;
    }
    place(hi);
  });
  return null;
}

/** 차들을 한 화면(WebGL 하나)에 늘어놓고 빙글빙글 돌려 보여 줍니다. 대기실·내 차 미리보기에 씁니다. */
export function Showroom({ looks, labels = true, className = 'showroom' }: { looks: CarLook[]; labels?: boolean; className?: string }) {
  const n = Math.max(1, looks.length);
  const cols = n <= 3 ? n : n <= 8 ? Math.ceil(n / 2) : n <= 18 ? Math.ceil(n / 3) : Math.ceil(n / 4);
  const rows = Math.ceil(n / cols);
  const cell = 6.4;
  const [dpr, setDpr] = useState(initialDpr);
  return (
    <Canvas className={className} dpr={dpr} camera={{ fov: 40, near: 0.5, far: 400 }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={1.6} />
      <directionalLight position={[20, 40, 30]} intensity={1.5} />
      <FitCamera cols={cols} rows={rows} cell={cell} />
      <AdaptiveDpr dpr={dpr} onChange={setDpr} />
      {looks.map((l, i) => {
        const r = Math.floor(i / cols);
        const inRow = r === rows - 1 ? n - r * cols : cols;
        const x = ((i % cols) - (inRow - 1) / 2) * cell;
        const z = (r - (rows - 1) / 2) * cell;
        // 차가 많으면 이름표가 너무 작아 읽을 수 없으니 숨깁니다(이름은 아래 목록에 있음).
        return <Spinner key={l.id} look={l} position={[x, 0, z]} label={labels && n <= 12} />;
      })}
    </Canvas>
  );
}

const STEPS: { x: number; h: number; color: string }[] = [
  { x: 0, h: 3.2, color: '#ffd23f' },
  { x: -7.5, h: 2.1, color: '#cfd8e3' },
  { x: 7.5, h: 1.3, color: '#e0a36b' },
];

/** 시상대: 1·2·3등 차를 단 위에 올려 보여 줍니다. */
export function PodiumScene({ looks }: { looks: CarLook[] }) {
  return (
    <Canvas className="podium-canvas" dpr={[1, 1.5]} camera={{ fov: 38, near: 0.5, far: 300, position: [0, 8.5, 19] }} gl={{ antialias: true, alpha: true }}
      onCreated={({ camera }) => camera.lookAt(0, 2.6, 0)}>
      <ambientLight intensity={1.6} />
      <directionalLight position={[10, 40, 30]} intensity={1.6} />
      {looks.slice(0, 3).map((l, i) => (
        <group key={l.id} position={[STEPS[i].x, 0, 0]}>
          <mesh position={[0, STEPS[i].h / 2, 0]}>
            <boxGeometry args={[6.6, STEPS[i].h, 6]} />
            <meshLambertMaterial color={STEPS[i].color} />
          </mesh>
          <Spinner look={l} position={[0, STEPS[i].h, 0]} label={false} speed={0.9} />
        </group>
      ))}
    </Canvas>
  );
}
