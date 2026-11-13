import { useEffect, useState } from 'react';
import * as THREE from 'three';

const COLS = 48;
const MAX_HEIGHT = 2.8;
const LENGTH = 4;
const HALF_WIDTH = 0.85;

interface Body {
  sides: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  texture: THREE.Texture;
}

const cache = new Map<string, Promise<Body>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('그림을 불러오지 못했어요'));
    img.src = url;
  });
}

/**
 * 그림 한 장으로 "두께가 있는 장난감 차"를 만듭니다. (3D 변환 없이 바로 달릴 수 있는 Fallback)
 * 그림의 윤곽(위쪽 선·아래쪽 선)을 따라 옆면 두 장을 세우고, 그 사이를 지붕·바닥·앞뒤 면으로 메웁니다.
 * 그림의 오른쪽이 차의 앞(+Z)입니다.
 */
async function buildBody(url: string): Promise<Body> {
  const img = await loadImage(url);
  const W = 96;
  const H = Math.max(8, Math.round((img.height / img.width) * W));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const alpha = (x: number, y: number) => px[(y * W + x) * 4 + 3];

  // 세로줄마다 그림의 맨 위·맨 아래를 찾습니다.
  const top: number[] = [];
  const bot: number[] = [];
  for (let i = 0; i <= COLS; i++) {
    const cx = Math.round((i / COLS) * (W - 1));
    let t = H;
    let b = -1;
    for (let x = Math.max(0, cx - 1); x <= Math.min(W - 1, cx + 1); x++) {
      for (let y = 0; y < H; y++) {
        if (alpha(x, y) > 100) {
          if (y < t) t = y;
          if (y > b) b = y;
        }
      }
    }
    top.push(b < 0 ? NaN : t / H);
    bot.push(b < 0 ? NaN : (b + 1) / H);
  }
  // 빈 줄은 옆 줄 값으로 메워 납작하게 닫습니다.
  for (let i = 0; i <= COLS; i++) {
    if (!Number.isNaN(top[i])) continue;
    let j = i;
    while (j <= COLS && Number.isNaN(top[j])) j++;
    const src = j <= COLS ? j : i - 1;
    const mid = src >= 0 && !Number.isNaN(top[src]) ? (top[src] + bot[src]) / 2 : 0.5;
    top[i] = mid;
    bot[i] = mid;
  }

  const aspect = img.width / img.height;
  let height = LENGTH / aspect;
  let length = LENGTH;
  if (height > MAX_HEIGHT) {
    height = MAX_HEIGHT;
    length = Math.max(2, MAX_HEIGHT * aspect);
  }
  const yOf = (v: number) => (1 - v) * height;
  const zOf = (i: number) => (i / COLS - 0.5) * length;
  const wOf = (y: number) => HALF_WIDTH * (1 - 0.3 * (y / height));

  const colorAt = (i: number, v: number, dim = 1): [number, number, number] => {
    const x = Math.min(W - 1, Math.max(0, Math.round((i / COLS) * (W - 1))));
    const y = Math.min(H - 1, Math.max(0, Math.round(v * H)));
    const k = (y * W + x) * 4;
    if (px[k + 3] < 100) return [0.25 * dim, 0.25 * dim, 0.3 * dim];
    const c = new THREE.Color().setRGB(px[k] / 255, px[k + 1] / 255, px[k + 2] / 255, THREE.SRGBColorSpace);
    return [c.r * dim, c.g * dim, c.b * dim];
  };

  const sp: number[] = [];
  const su: number[] = [];
  const sn: number[] = [];
  const rp: number[] = [];
  const rc: number[] = [];
  const quad = (arr: number[], a: number[], b: number[], c: number[], d: number[]) => arr.push(...a, ...b, ...c, ...c, ...b, ...d);

  for (let i = 0; i < COLS; i++) {
    const yT0 = yOf(top[i]), yB0 = yOf(bot[i]), yT1 = yOf(top[i + 1]), yB1 = yOf(bot[i + 1]);
    const z0 = zOf(i), z1 = zOf(i + 1);
    const u0 = i / COLS, u1 = (i + 1) / COLS;
    for (const s of [1, -1]) {
      quad(sp, [s * wOf(yT0), yT0, z0], [s * wOf(yB0), yB0, z0], [s * wOf(yT1), yT1, z1], [s * wOf(yB1), yB1, z1]);
      su.push(u0, 1 - top[i], u0, 1 - bot[i], u1, 1 - top[i + 1], u1, 1 - top[i + 1], u0, 1 - bot[i], u1, 1 - bot[i + 1]);
      for (let k = 0; k < 6; k++) sn.push(s, 0.25, 0);
    }
    // 지붕과 바닥: 그림의 색을 따 와서 칠합니다.
    const inset = (j: number) => top[j] + Math.max(3 / H, (bot[j] - top[j]) * 0.18);
    const cTop = colorAt(i, inset(i));
    quad(rp, [wOf(yT0), yT0, z0], [-wOf(yT0), yT0, z0], [wOf(yT1), yT1, z1], [-wOf(yT1), yT1, z1]);
    for (let k = 0; k < 6; k++) rc.push(...cTop);
    const cBot = colorAt(i, bot[i] - Math.max(3 / H, (bot[i] - top[i]) * 0.18), 0.6);
    quad(rp, [wOf(yB0), yB0, z0], [-wOf(yB0), yB0, z0], [wOf(yB1), yB1, z1], [-wOf(yB1), yB1, z1]);
    for (let k = 0; k < 6; k++) rc.push(...cBot);
  }
  for (const i of [0, COLS]) {
    const yT = yOf(top[i]), yB = yOf(bot[i]);
    quad(rp, [wOf(yT), yT, zOf(i)], [-wOf(yT), yT, zOf(i)], [wOf(yB), yB, zOf(i)], [-wOf(yB), yB, zOf(i)]);
    const c = colorAt(i === 0 ? 1 : COLS - 1, (top[i] + bot[i]) / 2, 0.85);
    for (let k = 0; k < 6; k++) rc.push(...c);
  }

  const sides = new THREE.BufferGeometry();
  sides.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sides.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
  sides.setAttribute('normal', new THREE.Float32BufferAttribute(sn, 3));
  const rim = new THREE.BufferGeometry();
  rim.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  rim.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  rim.computeVertexNormals();
  // 지붕은 위, 바닥은 아래를 보게 하면 조명이 어색해져서 모두 위쪽 빛을 받게 합니다.
  const n = rim.getAttribute('normal') as THREE.BufferAttribute;
  for (let k = 0; k < n.count; k++) n.setY(k, Math.abs(n.getY(k)));

  const texture = new THREE.Texture(img);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { sides, rim, texture };
}

export function useDrawingBody(url: string | null | undefined): Body | null | 'error' {
  const [body, setBody] = useState<Body | null | 'error'>(null);
  useEffect(() => {
    if (!url) return setBody(null);
    let alive = true;
    let p = cache.get(url);
    if (!p) {
      p = buildBody(url);
      cache.set(url, p);
      if (cache.size > 80) cache.delete(cache.keys().next().value as string);
    }
    p.then((b) => alive && setBody(b)).catch(() => { cache.delete(url); if (alive) setBody('error'); });
    return () => { alive = false; };
  }, [url]);
  return body;
}

export function DrawingCar({ url, fallback }: { url: string; fallback: React.ReactNode }) {
  const body = useDrawingBody(url);
  if (!body || body === 'error') return <>{fallback}</>;
  return (
    <group position={[0, 0.05, 0]}>
      <mesh geometry={body.sides}>
        <meshLambertMaterial map={body.texture} alphaTest={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={body.rim}>
        <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
