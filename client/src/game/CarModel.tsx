import { useMemo } from 'react';
import * as THREE from 'three';
import type { CarLook } from './types';
import { DrawingCar } from './DrawingCar';
import { GlbCar } from './GlbCar';

const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.45, 12);
wheelGeo.rotateZ(Math.PI / 2);
const wheelMat = new THREE.MeshLambertMaterial({ color: '#2b2b33' });
const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.48, 8);
hubGeo.rotateZ(Math.PI / 2);
const hubMat = new THREE.MeshLambertMaterial({ color: '#e8ecf3' });

export function Wheels({ halfTrack = 1.0, front = 1.2, rear = -1.25 }: { halfTrack?: number; front?: number; rear?: number }) {
  const spots: [number, number][] = [[halfTrack, front], [-halfTrack, front], [halfTrack, rear], [-halfTrack, rear]];
  return (
    <>
      {spots.map(([x, z], i) => (
        <group key={i} position={[x, 0.5, z]}>
          <mesh geometry={wheelGeo} material={wheelMat} />
          <mesh geometry={hubGeo} material={hubMat} />
        </group>
      ))}
    </>
  );
}

/** 기본 카트. 길이 4, 바닥 y=0, 앞쪽이 +Z 입니다. */
export function KartModel({ color }: { color: string }) {
  const mats = useMemo(() => {
    const c = new THREE.Color(color);
    return {
      body: new THREE.MeshLambertMaterial({ color: c }),
      dark: new THREE.MeshLambertMaterial({ color: c.clone().multiplyScalar(0.7) }),
      glass: new THREE.MeshLambertMaterial({ color: '#bfe9ff' }),
    };
  }, [color]);
  return (
    <group>
      <mesh position={[0, 0.7, 0]} material={mats.body}>
        <boxGeometry args={[1.7, 0.6, 4]} />
      </mesh>
      <mesh position={[0, 0.85, 1.75]} material={mats.dark}>
        <boxGeometry args={[1.3, 0.3, 0.6]} />
      </mesh>
      <mesh position={[0, 1.25, -0.25]} material={mats.glass}>
        <boxGeometry args={[1.35, 0.55, 1.5]} />
      </mesh>
      <mesh position={[0, 1.56, -0.25]} material={mats.dark}>
        <boxGeometry args={[1.45, 0.1, 1.6]} />
      </mesh>
      <mesh position={[0, 1.55, -1.85]} material={mats.dark}>
        <boxGeometry args={[1.9, 0.12, 0.5]} />
      </mesh>
      <mesh position={[0.6, 1.25, -1.85]} material={mats.dark}>
        <boxGeometry args={[0.12, 0.55, 0.3]} />
      </mesh>
      <mesh position={[-0.6, 1.25, -1.85]} material={mats.dark}>
        <boxGeometry args={[0.12, 0.55, 0.3]} />
      </mesh>
      <Wheels />
    </group>
  );
}

/**
 * 차 한 대의 겉모습을 고릅니다.
 * 3D 모델(GLB) → 그림으로 만든 차체 → 기본 카트 순서로, 앞의 것이 없거나 실패하면 다음 것을 씁니다.
 */
export function CarModel({ look }: { look: CarLook }) {
  const kart = <KartModel color={look.color} />;
  const drawing = look.imageUrl ? <DrawingCar url={look.imageUrl} fallback={kart} /> : kart;
  if (look.glbUrl) return <GlbCar url={look.glbUrl} flip={look.flip} fallback={drawing} />;
  return drawing;
}
