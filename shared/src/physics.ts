// 아케이드식 자동차 물리. 실제 시뮬레이션이 아니라 "가볍고 재미있게"가 목표입니다.
import { Track, locate, pointAt } from './track';

export const PHYS = {
  maxSpeed: 30,
  boostSpeed: 45,
  accel: 17,
  boostAccel: 40,
  brake: 36,
  drag: 7,
  reverseMax: 8,
  turnRate: 2.3,
  /** 충돌 판정용 반지름 */
  radius: 1.5,
  boostTime: 1.6,
  boostPadRadius: 3.4,
  /** 교사 화면의 물리 계산 주기(초당) */
  tickRate: 30,
};

export interface CarInput {
  /** -1(왼쪽) ~ 1(오른쪽) */
  steer: number;
  throttle: number;
  brake: number;
}

export const NO_INPUT: CarInput = { steer: 0, throttle: 0, brake: 0 };

export interface CarState {
  id: string;
  x: number;
  z: number;
  /** 방향(라디안). 0 = +Z */
  h: number;
  /** 속도 (앞으로 +) */
  v: number;
  /** 누적 진행 거리(중앙선 점 단위). 한 바퀴 = track.n */
  prog: number;
  idx: number;
  /** 남은 부스트 시간 */
  boost: number;
  /** 벽에 닿아 있는지 */
  wall: boolean;
  finished: boolean;
  finishTime: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** 출발선 뒤 격자 자리에 차를 놓습니다. slot 0 이 맨 앞 */
export function createCar(track: Track, id: string, slot: number): CarState {
  const row = Math.floor(slot / 2);
  const side = slot % 2 === 0 ? 1 : -1;
  const back = (4 + row * 6 + (side < 0 ? 2 : 0)) / track.spacing;
  const p = pointAt(track, -back, side * track.halfWidth * 0.42);
  return {
    id, x: p.x, z: p.z, h: p.h, v: 0, prog: -back,
    idx: locate(track, p.x, p.z).idx, boost: 0, wall: false, finished: false, finishTime: 0,
  };
}

export function stepCar(track: Track, c: CarState, input: CarInput, dt: number): void {
  const steer = clamp(input.steer || 0, -1, 1);
  const throttle = input.throttle ? 1 : 0;
  const brake = input.brake ? 1 : 0;

  if (c.boost > 0) c.boost = Math.max(0, c.boost - dt);
  const boosting = c.boost > 0;
  const vmax = boosting ? PHYS.boostSpeed : PHYS.maxSpeed;

  if (boosting) {
    c.v += PHYS.boostAccel * Math.max(0, 1.1 - c.v / vmax) * dt;
  } else if (throttle && !brake) {
    c.v += PHYS.accel * Math.max(0, 1.15 - c.v / vmax) * dt;
  }
  if (brake) {
    if (c.v > 0.5) c.v = Math.max(0, c.v - PHYS.brake * dt);
    else c.v = Math.max(-PHYS.reverseMax, c.v - PHYS.accel * 0.7 * dt);
  } else if (!throttle && !boosting) {
    const s = Math.sign(c.v);
    c.v -= s * Math.min(Math.abs(c.v), PHYS.drag * dt);
  }
  if (c.v > vmax) c.v -= (c.v - vmax) * Math.min(1, 2.5 * dt);

  // 느릴 때는 덜 돌고, 아주 빠를 때도 조금 덜 돕니다.
  const lowSpeed = clamp(c.v / 6, -1, 1);
  const highSpeed = 1 - 0.3 * Math.min(1, Math.abs(c.v) / PHYS.boostSpeed);
  c.h -= steer * PHYS.turnRate * lowSpeed * highSpeed * dt;

  c.x += Math.sin(c.h) * c.v * dt;
  c.z += Math.cos(c.h) * c.v * dt;

  const loc = locate(track, c.x, c.z, c.idx);
  let d = loc.f - (((c.prog % track.n) + track.n) % track.n);
  if (d > track.n / 2) d -= track.n;
  if (d < -track.n / 2) d += track.n;
  c.prog += d;
  c.idx = loc.idx;

  // 벽: 길 밖으로 못 나가게 밀어 넣고, 길 방향으로 살짝 돌려 줍니다(끼임 방지).
  const lim = track.halfWidth - PHYS.radius;
  if (Math.abs(loc.lateral) > lim) {
    const sign = Math.sign(loc.lateral);
    const ux = track.tx[loc.idx];
    const uz = track.tz[loc.idx];
    const lx = uz;
    const lz = -ux;
    const over = loc.lateral - sign * lim;
    c.x -= lx * over;
    c.z -= lz * over;
    const into = (Math.sin(c.h) * lx + Math.cos(c.h) * lz) * sign * Math.sign(c.v || 1);
    if (into > 0) {
      const loss = Math.min(0.6, into * 3 * dt + (c.wall ? 0 : into * 0.45));
      c.v *= 1 - loss;
      const th = Math.atan2(ux, uz);
      const target = Math.cos(c.h - th) >= 0 ? th : th + Math.PI;
      c.h += angleDiff(target, c.h) * Math.min(1, 5 * dt);
    }
    c.wall = true;
  } else {
    c.wall = false;
  }

  for (const b of track.boosts) {
    const ex = c.x - b.x;
    const ez = c.z - b.z;
    if (ex * ex + ez * ez < PHYS.boostPadRadius * PHYS.boostPadRadius && c.v > 2) {
      c.boost = PHYS.boostTime;
    }
  }
}

/** 차끼리 겹치면 서로 밀어냅니다. */
export function resolveCarCollisions(cars: CarState[]): void {
  const minD = PHYS.radius * 2 * 0.9;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const d2 = ex * ex + ez * ez;
      if (d2 >= minD * minD || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const push = (minD - d) / 2;
      const nx = ex / d;
      const nz = ez / d;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
      // 뒤에서 박은 차는 조금 느려지고 앞차는 살짝 밀립니다.
      const av = (a.v + b.v) / 2;
      a.v += (av - a.v) * 0.3;
      b.v += (av - b.v) * 0.3;
    }
  }
}

export interface WorldStepOptions {
  laps: number;
  /** 레이스 시작 후 흐른 시간(초) */
  time: number;
}

export function stepWorld(
  track: Track,
  cars: CarState[],
  inputs: (id: string) => CarInput,
  dt: number,
  opts: WorldStepOptions,
): void {
  for (const c of cars) {
    // 결승선을 지난 차는 천천히 멈춥니다.
    stepCar(track, c, c.finished ? NO_INPUT : inputs(c.id), dt);
    if (c.finished) c.v *= Math.max(0, 1 - 1.5 * dt);
    if (!c.finished && c.prog >= opts.laps * track.n) {
      c.finished = true;
      c.finishTime = opts.time;
    }
  }
  resolveCarCollisions(cars);
}

/** 순위 계산: 완주한 차(빠른 순) → 달리는 중인 차(많이 간 순) */
export function rankCars(cars: CarState[]): string[] {
  return [...cars]
    .sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.prog - a.prog;
    })
    .map((c) => c.id);
}

export function currentLap(track: Track, c: CarState, laps: number): number {
  return clamp(Math.floor(c.prog / track.n) + 1, 1, laps);
}
