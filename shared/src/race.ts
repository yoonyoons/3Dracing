
import { type CarInput, type CarState, NO_INPUT, PHYS, createCar, rankCars, stepWorld } from './physics';
import { type Track, getTrack } from './track';
import { LIMITS, type RaceResult, type Snap } from './protocol';

const now = () => globalThis.performance.now();

/** 학생이 보낸 입력 묶음: [이전 입력과의 간격(ms), 좌우, 가속, 브레이크] */
export type InputEvent = [number, number, number, number];

const DT = 1 / PHYS.tickRate;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 레이스 한 판의 권위 있는 상태. 교사 화면(호스트)만 물리를 계산하고, 학생 기기는 입력만 보냅니다.
 */
export class RaceSim {
  readonly track: Track;
  readonly cars: CarState[];
  readonly startAt = LIMITS.countdownMs;
  private inputs = new Map<string, CarInput>();
  /** 아직 적용하지 않은 입력 (적용할 시각, 입력) */
  private queued = new Map<string, { at: number; input: CarInput }[]>();
  /** 화면을 부드럽게 그리기 위한 직전 단계의 위치 */
  private prev: { x: number; z: number; h: number }[];
  private lastStep = 0;
  private active = new Set<string>();
  private t0: number;
  private acc = 0;
  private last: number;
  /** 출발 후 흐른 시간(초) */
  time = 0;
  private firstFinish: number | null = null;
  ended = false;

  constructor(
    readonly trackId: string,
    readonly laps: number,
    readonly racers: string[],
    now0: number = now(),
  ) {
    this.track = getTrack(trackId);
    this.cars = racers.map((id, slot) => createCar(this.track, id, slot));
    racers.forEach((id) => this.active.add(id));
    this.t0 = now0;
    this.last = now0;
    this.lastStep = now0;
    this.prev = this.cars.map((c) => ({ x: c.x, z: c.z, h: c.h }));
  }

  /** 레이스 시계(ms) */
  clock(t: number = now()): number {
    return t - this.t0;
  }

  get started(): boolean {
    return this.time > 0;
  }

  setInput(id: string, steer: number, throttle: number, brake: number): void {
    if (!this.active.has(id)) return;
    const s = Number.isFinite(steer) ? Math.max(-1, Math.min(1, steer)) : 0;
    this.inputs.set(id, { steer: s, throttle: throttle ? 1 : 0, brake: brake ? 1 : 0 });
  }

  /**
   * 학생 기기는 입력이 바뀔 때마다 기록해 두었다가 몇 번에 한 번씩 묶어서 보냅니다(메시지 수 절약).
   * 받은 순서와 간격 그대로 다시 적용하므로 짧게 톡 누른 방향키도 사라지지 않습니다.
   */
  queueInputs(id: string, events: InputEvent[], t: number = now()): void {
    if (!this.active.has(id) || !Array.isArray(events)) return;
    const q = this.queued.get(id) ?? [];
    const last = q.length ? q[q.length - 1].at : t;
    let at = Math.max(t, last);
    for (const e of events.slice(0, 40)) {
      if (!Array.isArray(e) || e.length < 4) continue;
      at += Math.max(0, Math.min(1000, Number(e[0]) || 0));
      const steer = Number(e[1]);
      q.push({ at, input: { steer: Number.isFinite(steer) ? Math.max(-1, Math.min(1, steer)) : 0, throttle: e[2] ? 1 : 0, brake: e[3] ? 1 : 0 } });
    }
    // 밀린 입력이 너무 많으면(네트워크가 끊겼다 이어짐 등) 가장 최근 것만 남깁니다.
    while (q.length > 20) q.shift();
    this.queued.set(id, q);
  }

  private applyQueued(t: number): void {
    for (const [id, q] of this.queued) {
      while (q.length && q[0].at <= t) this.inputs.set(id, q.shift()!.input);
    }
  }

  /** 접속이 끊긴 차는 입력 없이 굴러가다 멈춥니다. */
  setActive(id: string, on: boolean): void {
    if (!this.racers.includes(id)) return;
    if (on) this.active.add(id);
    else {
      this.active.delete(id);
      this.inputs.delete(id);
      this.queued.delete(id);
    }
  }

  /** 실제 흐른 시간만큼 물리를 진행합니다. 레이스가 끝났으면 true */
  advance(t: number = now()): boolean {
    if (this.ended) return true;
    const clock = this.clock(t);
    const elapsed = Math.min(0.25, (t - this.last) / 1000);
    this.last = t;
    if (clock < this.startAt) return false;
    this.acc += elapsed;
    let guard = 0;
    while (this.acc >= DT && guard++ < 8) {
      this.acc -= DT;
      this.time += DT;
      this.applyQueued(t);
      for (let i = 0; i < this.cars.length; i++) {
        const c = this.cars[i];
        this.prev[i].x = c.x; this.prev[i].z = c.z; this.prev[i].h = c.h;
      }
      this.lastStep = t;
      stepWorld(this.track, this.cars, (id) => this.inputs.get(id) ?? NO_INPUT, DT, { laps: this.laps, time: this.time });
    }
    if (this.firstFinish === null && this.cars.some((c) => c.finished)) this.firstFinish = this.time;
    const waiting = this.cars.filter((c) => !c.finished && this.active.has(c.id));
    if (
      waiting.length === 0 ||
      (this.firstFinish !== null && this.time > this.firstFinish + LIMITS.finishGrace) ||
      this.time > LIMITS.maxRaceSeconds
    ) {
      this.ended = true;
    }
    return this.ended;
  }

  /** 마지막 두 물리 단계 사이를 보간한 위치 (교사 화면 그리기용) */
  renderCars(t: number = now()): { id: string; x: number; z: number; h: number; v: number; boost: number }[] {
    const a = Math.max(0, Math.min(1, (t - this.lastStep) / (DT * 1000)));
    return this.cars.map((c, i) => {
      const p = this.prev[i];
      let dh = c.h - p.h;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      return { id: c.id, x: p.x + (c.x - p.x) * a, z: p.z + (c.z - p.z) * a, h: p.h + dh * a, v: c.v, boost: c.boost };
    });
  }

  snapshot(t: number = now()): Omit<Snap, 'r'> {
    const order = rankCars(this.cars);
    return {
      t: Math.round(this.clock(t)),
      c: this.cars.map((c) => [r2(c.x), r2(c.z), r2(c.h), r2(c.v), r2(c.boost), r2(c.prog), c.finished ? 1 : 0]),
      o: order.map((id) => this.racers.indexOf(id)),
    };
  }

  results(nameOf: (id: string) => string): RaceResult[] {
    return rankCars(this.cars).map((id, i) => {
      const c = this.cars.find((k) => k.id === id)!;
      return { id, name: nameOf(id), place: i + 1, time: c.finished ? Math.round(c.finishTime * 100) / 100 : null };
    });
  }
}
