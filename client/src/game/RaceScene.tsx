import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Track } from '@racing/shared';
import { TrackMesh } from './TrackMesh';
import { CarModel } from './CarModel';
import type { CameraMode, CarLook, RenderCar } from './types';

function nameTexture(name: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 34px system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const w = Math.min(244, g.measureText(name).width + 36);
  g.fillStyle = 'rgba(255,255,255,0.92)';
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

const shadowGeo = new THREE.CircleGeometry(1.9, 16);
const shadowMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.22, depthWrite: false });
const flameGeo = new THREE.ConeGeometry(0.45, 2.2, 8);
flameGeo.rotateX(-Math.PI / 2);
flameGeo.translate(0, 0.8, -3);
const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb400' });

function CarEntity({ look, getCar, showName }: { look: CarLook; getCar: (id: string) => RenderCar | undefined; showName: boolean }) {
  const group = useRef<THREE.Group>(null);
  const flame = useRef<THREE.Mesh>(null);
  const tex = useMemo(() => nameTexture(look.name, look.color), [look.name, look.color]);
  useEffect(() => () => tex.dispose(), [tex]);
  useFrame(() => {
    const c = getCar(look.id);
    const g = group.current;
    if (!g) return;
    g.visible = !!c;
    if (!c) return;
    g.position.set(c.x, 0, c.z);
    g.rotation.y = c.h;
    if (flame.current) {
      flame.current.visible = c.boost > 0;
      flame.current.scale.z = 0.7 + Math.random() * 0.6;
    }
  });
  return (
    <group ref={group}>
      <mesh geometry={shadowGeo} material={shadowMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]} scale={[1, 1.5, 1]} />
      <CarModel look={look} />
      <mesh ref={flame} geometry={flameGeo} material={flameMat} visible={false} />
      {showName && (
        <sprite position={[0, 3.6, 0]} scale={[5.2, 1.3, 1]}>
          <spriteMaterial map={tex} depthTest={false} transparent />
        </sprite>
      )}
    </group>
  );
}

const tmp = new THREE.Vector3();
const look = new THREE.Vector3();

function CameraRig({ camera: mode, getCars, getLeaderId }: {
  camera: CameraMode;
  getCars: () => RenderCar[];
  getLeaderId?: () => string | undefined;
}) {
  const { camera, size } = useThree();
  const init = useRef(false);
  const target = useRef(new THREE.Vector3());
  useEffect(() => { init.current = false; }, [mode.mode]);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const cam = camera as THREE.PerspectiveCamera;
    const cars = getCars();
    if (mode.mode === 'overview' || cars.length === 0) {
      // 세로로 긴 화면에서는 더 높이 올라가야 트랙이 다 보입니다.
      const k = Math.max(1, 1.6 / (size.width / size.height));
      tmp.set(0, 128 * k, 84 * k);
      look.set(0, 0, 4);
      if (!init.current) { cam.position.copy(tmp); init.current = true; }
      cam.position.lerp(tmp, Math.min(1, 3 * dt));
      cam.lookAt(look);
      return;
    }
    if (mode.mode === 'chase') {
      const c = cars.find((k) => k.id === mode.followId) ?? cars[0];
      const fx = Math.sin(c.h);
      const fz = Math.cos(c.h);
      tmp.set(c.x - fx * 10.5, 6.2, c.z - fz * 10.5);
      look.set(c.x + fx * 6, 1.2, c.z + fz * 6);
      if (!init.current) { cam.position.copy(tmp); target.current.copy(look); init.current = true; }
      cam.position.lerp(tmp, Math.min(1, 5 * dt));
      target.current.lerp(look, Math.min(1, 9 * dt));
      cam.lookAt(target.current);
      const fov = c.boost > 0 ? 78 : 64;
      if (Math.abs(cam.fov - fov) > 0.2) {
        cam.fov += (fov - cam.fov) * Math.min(1, 4 * dt);
        cam.updateProjectionMatrix();
      }
      return;
    }
    // 중계 카메라: 1등 차를 따라가며 내려다봅니다.
    const id = getLeaderId?.();
    const c = cars.find((k) => k.id === id) ?? cars[0];
    look.set(c.x, 0, c.z);
    if (!init.current) { target.current.copy(look); init.current = true; }
    target.current.lerp(look, Math.min(1, 2.5 * dt));
    tmp.set(target.current.x * 0.75, 46, target.current.z * 0.75 + 44);
    cam.position.lerp(tmp, Math.min(1, 3 * dt));
    cam.lookAt(target.current);
  });
  return null;
}

function FrameHook({ onFrame }: { onFrame?: (dt: number) => void }) {
  useFrame((_, dt) => onFrame?.(Math.min(dt, 0.1)), -1);
  return null;
}

export interface RaceSceneProps {
  track: Track;
  looks: CarLook[];
  /** 매 프레임 호출됩니다. 지금 화면에 그릴 차들의 위치 */
  getCars: () => RenderCar[];
  camera: CameraMode;
  getLeaderId?: () => string | undefined;
  /** 그리기 전에 호출 (연습 모드의 물리 계산 등) */
  onFrame?: (dt: number) => void;
  showNames?: boolean;
}

export function RaceScene({ track, looks, getCars, camera, getLeaderId, onFrame, showNames = true }: RaceSceneProps) {
  const getCar = (id: string) => getCars().find((c) => c.id === id);
  return (
    <Canvas
      className="race-canvas"
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 64, near: 0.5, far: 900, position: [0, 120, 80] }}
    >
      <color attach="background" args={['#aee4ff']} />
      <fog attach="fog" args={['#aee4ff', 180, 520]} />
      <ambientLight intensity={1.5} />
      <directionalLight position={[60, 120, 40]} intensity={1.6} />
      <FrameHook onFrame={onFrame} />
      <TrackMesh track={track} />
      {looks.map((l) => (
        <CarEntity key={l.id} look={l} getCar={getCar} showName={showNames} />
      ))}
      <CameraRig camera={camera} getCars={getCars} getLeaderId={getLeaderId} />
    </Canvas>
  );
}
