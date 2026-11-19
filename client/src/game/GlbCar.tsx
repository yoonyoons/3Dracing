import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { resolveAsset } from '../net/assets';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

function load(url: string): Promise<THREE.Group> {
  let p = cache.get(url);
  if (!p) {
    p = resolveAsset(url).then((u) => loader.loadAsync(u)).then((gltf) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.frustumCulled = false;
      });
      return gltf.scene;
    });
    cache.set(url, p);
    p.catch(() => cache.delete(url));
    if (cache.size > 60) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

/** 서버에서 크기·방향을 맞춰 둔 GLB 를 그대로 올려놓습니다. 불러오는 동안/실패 시에는 fallback 을 보여 줍니다. */
export function GlbCar({ url, flip, fallback }: { url: string; flip?: boolean; fallback: React.ReactNode }) {
  const [obj, setObj] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let alive = true;
    setObj(null);
    load(url).then((scene) => alive && setObj(scene.clone(true))).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  if (!obj) return <>{fallback}</>;
  return <primitive object={obj} rotation={[0, flip ? Math.PI : 0, 0]} />;
}
