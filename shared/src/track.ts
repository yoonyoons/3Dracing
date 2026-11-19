// 트랙 정의와 기하 계산. 교사 화면(물리 계산)과 학생 화면(그리기)이 같은 코드를 씁니다.
// 좌표계: 바닥은 XZ 평면, 진행 방향 h=0 은 +Z, "왼쪽"은 +X 쪽입니다.

export interface BoostPadDef {
  /** 트랙 한 바퀴 중 위치 (0~1) */
  at: number;
  /** 중앙선에서 왼쪽(+)·오른쪽(-)으로 떨어진 거리 */
  lateral: number;
}

export interface TrackDef {
  id: string;
  name: string;
  description: string;
  difficulty: 1 | 2 | 3;
  halfWidth: number;
  /** t(0~1) → [x, z] 닫힌 곡선 */
  curve: (t: number) => [number, number];
  boosts: BoostPadDef[];
}

export interface BoostPad {
  x: number;
  z: number;
  h: number;
}

export interface Track {
  id: string;
  name: string;
  description: string;
  difficulty: number;
  halfWidth: number;
  /** 중앙선 점 개수 */
  n: number;
  /** 점 사이 간격 */
  spacing: number;
  length: number;
  px: number[];
  pz: number[];
  /** 진행 방향 단위벡터 */
  tx: number[];
  tz: number[];
  boosts: BoostPad[];
}

const SPACING = 2;

export function buildTrack(def: TrackDef): Track {
  const M = 4000;
  const dx: number[] = [];
  const dz: number[] = [];
  const cum: number[] = [0];
  for (let i = 0; i <= M; i++) {
    const [x, z] = def.curve(i / M);
    dx.push(x);
    dz.push(z);
    if (i > 0) cum.push(cum[i - 1] + Math.hypot(x - dx[i - 1], z - dz[i - 1]));
  }
  const length = cum[M];
  const n = Math.round(length / SPACING);
  const spacing = length / n;
  const px: number[] = [];
  const pz: number[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = i * spacing;
    while (j < M - 1 && cum[j + 1] < s) j++;
    const f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    px.push(dx[j] + (dx[j + 1] - dx[j]) * f);
    pz.push(dz[j] + (dz[j + 1] - dz[j]) * f);
  }
  const tx: number[] = [];
  const tz: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n;
    const b = (i + 1) % n;
    const ex = px[b] - px[a];
    const ez = pz[b] - pz[a];
    const l = Math.hypot(ex, ez) || 1;
    tx.push(ex / l);
    tz.push(ez / l);
  }
  const track: Track = {
    id: def.id, name: def.name, description: def.description, difficulty: def.difficulty,
    halfWidth: def.halfWidth, n, spacing, length, px, pz, tx, tz, boosts: [],
  };
  track.boosts = def.boosts.map((b) => {
    const p = pointAt(track, b.at * n, b.lateral);
    return { x: p.x, z: p.z, h: p.h };
  });
  return track;
}

export function wrapIndex(track: Track, i: number): number {
  const n = track.n;
  return ((i % n) + n) % n;
}

/** 중앙선의 (소수) 인덱스 f, 좌우 오프셋 lateral 위치의 좌표와 방향 */
export function pointAt(track: Track, f: number, lateral = 0): { x: number; z: number; h: number } {
  const n = track.n;
  const i0 = Math.floor(f);
  const t = f - i0;
  const a = wrapIndex(track, i0);
  const b = (a + 1) % n;
  const x = track.px[a] + (track.px[b] - track.px[a]) * t;
  const z = track.pz[a] + (track.pz[b] - track.pz[a]) * t;
  let ux = track.tx[a] + (track.tx[b] - track.tx[a]) * t;
  let uz = track.tz[a] + (track.tz[b] - track.tz[a]) * t;
  const l = Math.hypot(ux, uz) || 1;
  ux /= l;
  uz /= l;
  // 왼쪽 벡터 = (uz, -ux)
  return { x: x + uz * lateral, z: z - ux * lateral, h: Math.atan2(ux, uz) };
}

export interface Located {
  /** 가장 가까운 중앙선 점 */
  idx: number;
  /** 소수 인덱스 (idx + 진행 방향 보정) */
  f: number;
  /** 중앙선에서 왼쪽(+)으로 떨어진 거리 */
  lateral: number;
}

/**
 * (x,z)에서 가장 가까운 중앙선 위치를 찾습니다.
 * hint 주변만 찾기 때문에 8자 코스의 교차점에서도 다른 길로 튀지 않습니다.
 */
export function locate(track: Track, x: number, z: number, hint = -1, window = 12): Located {
  const n = track.n;
  let best = 0;
  let bestD = Infinity;
  const from = hint < 0 ? 0 : hint - window;
  const to = hint < 0 ? n - 1 : hint + window;
  for (let k = from; k <= to; k++) {
    const i = ((k % n) + n) % n;
    const ex = x - track.px[i];
    const ez = z - track.pz[i];
    const d = ex * ex + ez * ez;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const ex = x - track.px[best];
  const ez = z - track.pz[best];
  const ux = track.tx[best];
  const uz = track.tz[best];
  const along = Math.max(-0.5, Math.min(0.5, (ex * ux + ez * uz) / track.spacing));
  return { idx: best, f: best + along, lateral: ex * uz - ez * ux };
}

/** 가장 급한 커브의 반지름 (트랙 검증용) */
export function minTurnRadius(track: Track): number {
  let min = Infinity;
  const n = track.n;
  for (let i = 0; i < n; i++) {
    const b = (i + 1) % n;
    let d = Math.atan2(track.tx[b], track.tz[b]) - Math.atan2(track.tx[i], track.tz[i]);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) > 1e-6) min = Math.min(min, track.spacing / Math.abs(d));
  }
  return min;
}

const TAU = Math.PI * 2;

export const TRACK_DEFS: TrackDef[] = [
  {
    id: 'oval',
    name: '동글동글 타원 코스',
    description: '처음이라면 여기! 넓고 쉬운 타원형 코스예요.',
    difficulty: 1,
    halfWidth: 9,
    curve: (t) => [62 * Math.cos(t * TAU), 36 * Math.sin(t * TAU)],
    boosts: [
      { at: 0.2, lateral: 0 },
      { at: 0.7, lateral: 0 },
    ],
  },
  {
    id: 'eight',
    name: '빙글빙글 8자 코스',
    description: '가운데에서 길이 엇갈려요. 다른 차와 부딪히지 않게 조심!',
    difficulty: 2,
    halfWidth: 8,
    curve: (t) => {
      const a = t * TAU + Math.PI / 2;
      return [74 * Math.sin(a), 40 * Math.sin(2 * a)];
    },
    boosts: [
      { at: 0.12, lateral: 3 },
      { at: 0.4, lateral: -3 },
      { at: 0.62, lateral: 3 },
      { at: 0.9, lateral: -3 },
    ],
  },
  {
    id: 'wiggle',
    name: '꼬불꼬불 서킷',
    description: '커브가 많은 도전 코스! 브레이크를 잘 써 보세요.',
    difficulty: 3,
    halfWidth: 8,
    curve: (t) => {
      const a = t * TAU;
      const r = 1 + 0.2 * Math.cos(3 * a);
      return [66 * Math.cos(a) * r, 46 * Math.sin(a) * r];
    },
    boosts: [
      { at: 0.08, lateral: 0 },
      { at: 0.42, lateral: 2 },
      { at: 0.75, lateral: -2 },
    ],
  },
];

const cache = new Map<string, Track>();

export function getTrack(id: string): Track {
  let t = cache.get(id);
  if (!t) {
    const def = TRACK_DEFS.find((d) => d.id === id) ?? TRACK_DEFS[0];
    t = buildTrack(def);
    cache.set(id, t);
    cache.set(def.id, t);
  }
  return t;
}

export const TRACK_LIST = TRACK_DEFS.map((d) => ({
  id: d.id, name: d.name, description: d.description, difficulty: d.difficulty,
}));
