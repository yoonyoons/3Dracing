import { useMemo } from 'react';
import * as THREE from 'three';
import type { Track } from '@racing/shared';

function offsetPoint(track: Track, i: number, lat: number): [number, number] {
  const k = ((i % track.n) + track.n) % track.n;
  return [track.px[k] + track.tz[k] * lat, track.pz[k] - track.tx[k] * lat];
}

/** 8자 코스처럼 길이 엇갈리는 곳에서는 벽을 세우면 안 됩니다. */
function crossingMask(track: Track, lat: number): boolean[] {
  const n = track.n;
  const far = Math.floor(n / 8);
  const r2 = (track.halfWidth + 1) ** 2;
  const mask: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const [x, z] = offsetPoint(track, i, lat);
    let hit = false;
    for (let j = 0; j < n && !hit; j++) {
      const d = Math.min((i - j + n) % n, (j - i + n) % n);
      if (d < far) continue;
      const ex = x - track.px[j];
      const ez = z - track.pz[j];
      if (ex * ex + ez * ez < r2) hit = true;
    }
    mask.push(hit);
  }
  return mask;
}

interface Strip {
  latA: number;
  latB: number;
  yA: number;
  yB: number;
  color: (i: number) => THREE.Color;
  skip?: boolean[];
}

function buildStrips(track: Track, strips: Strip[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  for (const s of strips) {
    const vertical = s.yA !== s.yB;
    for (let i = 0; i < track.n; i++) {
      if (s.skip && (s.skip[i] || s.skip[(i + 1) % track.n])) continue;
      const [ax, az] = offsetPoint(track, i, s.latA);
      const [bx, bz] = offsetPoint(track, i, s.latB);
      const [cx, cz] = offsetPoint(track, i + 1, s.latA);
      const [dx, dz] = offsetPoint(track, i + 1, s.latB);
      pos.push(ax, s.yA, az, bx, s.yB, bz, cx, s.yA, cz, cx, s.yA, cz, bx, s.yB, bz, dx, s.yB, dz);
      const c = s.color(i);
      // 벽은 길 안쪽을 보도록, 바닥은 위를 보도록 법선을 직접 넣습니다.
      const side = Math.sign(s.latA) || 1;
      const nx = vertical ? -track.tz[i] * side : 0;
      const nz = vertical ? track.tx[i] * side : 0;
      const ny = vertical ? 0.35 : 1;
      for (let k = 0; k < 6; k++) {
        col.push(c.r, c.g, c.b);
        nor.push(nx, ny, nz);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

function checkerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d')!;
  for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
    g.fillRect(x * 8, y * 8, 8, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

function boostTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffe14d';
  g.beginPath();
  g.roundRect(4, 4, 120, 120, 22);
  g.fill();
  g.strokeStyle = '#ff7b00';
  g.lineWidth = 16;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const y of [30, 62, 94]) {
    g.beginPath();
    g.moveTo(30, y + 16);
    g.lineTo(64, y - 12);
    g.lineTo(98, y + 16);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function TrackMesh({ track }: { track: Track }) {
  const { geometry, trees, start, checker, boostTex } = useMemo(() => {
    const hw = track.halfWidth;
    const road = new THREE.Color('#5b6270');
    const roadAlt = new THREE.Color('#646c7b');
    const red = new THREE.Color('#ff5a5f');
    const white = new THREE.Color('#ffffff');
    const blue = new THREE.Color('#4cc3ff');
    const kerb = (i: number) => (Math.floor(i / 2) % 2 ? red : white);
    const wall = (i: number) => (Math.floor(i / 3) % 2 ? blue : white);
    const skipL = crossingMask(track, hw + 0.4);
    const skipR = crossingMask(track, -(hw + 0.4));
    const geometry = buildStrips(track, [
      { latA: hw, latB: -hw, yA: 0.02, yB: 0.02, color: (i) => (Math.floor(i / 6) % 2 ? road : roadAlt) },
      { latA: hw, latB: hw - 1.1, yA: 0.04, yB: 0.04, color: kerb, skip: skipL },
      { latA: -hw, latB: -hw + 1.1, yA: 0.04, yB: 0.04, color: kerb, skip: skipR },
      { latA: hw + 0.4, latB: hw + 0.4, yA: 0, yB: 1.3, color: wall, skip: skipL },
      { latA: -(hw + 0.4), latB: -(hw + 0.4), yA: 0, yB: 1.3, color: wall, skip: skipR },
    ]);

    // 길 밖에 나무를 뿌려 속도감을 줍니다.
    const rnd = mulberry(track.n * 7 + 3);
    const trees: [number, number, number][] = [];
    let guard = 0;
    while (trees.length < 70 && guard++ < 3000) {
      const x = (rnd() - 0.5) * 260;
      const z = (rnd() - 0.5) * 200;
      let ok = true;
      for (let i = 0; i < track.n && ok; i += 2) {
        const ex = x - track.px[i];
        const ez = z - track.pz[i];
        if (ex * ex + ez * ez < (hw + 5) ** 2) ok = false;
      }
      if (ok) trees.push([x, z, 0.8 + rnd() * 0.9]);
    }
    const start = { x: track.px[0], z: track.pz[0], h: Math.atan2(track.tx[0], track.tz[0]) };
    return { geometry, trees, start, checker: checkerTexture(), boostTex: boostTexture() };
  }, [track]);

  const treeMesh = useMemo(() => {
    const g = new THREE.ConeGeometry(2.2, 6, 7);
    g.translate(0, 3.6, 0);
    const m = new THREE.MeshLambertMaterial({ color: '#3fae5a' });
    const mesh = new THREE.InstancedMesh(g, m, trees.length);
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    trees.forEach(([x, z, s], i) => {
      o.position.set(x, 0, z);
      o.scale.setScalar(s);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(i % 3 === 0 ? '#58c46f' : i % 3 === 1 ? '#3fae5a' : '#2f9a55'));
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [trees]);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[700, 700]} />
        <meshLambertMaterial color="#8fdc7a" />
      </mesh>
      <mesh geometry={geometry}>
        <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
      </mesh>
      <group position={[start.x, 0.06, start.z]} rotation={[0, start.h, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[track.halfWidth * 2, 2.4]} />
          <meshBasicMaterial map={checker} />
        </mesh>
      </group>
      {track.boosts.map((b, i) => (
        <group key={i} position={[b.x, 0.07, b.z]} rotation={[0, b.h + Math.PI, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[5, 5]} />
            <meshBasicMaterial map={boostTex} transparent />
          </mesh>
        </group>
      ))}
      <primitive object={treeMesh} />
    </group>
  );
}
