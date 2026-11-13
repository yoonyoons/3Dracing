import { performance } from 'node:perf_hooks';
import {
  CarInput, CarState, LIMITS, NO_INPUT, PHYS, RaceResult, Snap, Track,
  createCar, getTrack, rankCars, stepWorld,
} from '@racing/shared';

const DT = 1 / PHYS.tickRate;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** 레이스 한 판의 권위 있는 상태. 서버만 물리를 계산하고 클라이언트는 입력만 보냅니다. */
export class RaceSim {
  readonly track: Track;
  readonly cars: CarState[];
  readonly startAt = LIMITS.countdownMs;
  private inputs = new Map<string, CarInput>();
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
    now: number = performance.now(),
  ) {
    this.track = getTrack(trackId);
    this.cars = racers.map((id, slot) => createCar(this.track, id, slot));
    racers.forEach((id) => this.active.add(id));
    this.t0 = now;
    this.last = now;
  }

  /** 레이스 시계(ms) */
  clock(now: number = performance.now()): number {
    return now - this.t0;
  }

  get started(): boolean {
    return this.time > 0;
  }

  setInput(id: string, steer: number, throttle: number, brake: number): void {
    if (!this.active.has(id)) return;
    const s = Number.isFinite(steer) ? Math.max(-1, Math.min(1, steer)) : 0;
    this.inputs.set(id, { steer: s, throttle: throttle ? 1 : 0, brake: brake ? 1 : 0 });
  }

  /** 접속이 끊긴 차는 입력 없이 굴러가다 멈춥니다. */
  setActive(id: string, on: boolean): void {
    if (!this.racers.includes(id)) return;
    if (on) this.active.add(id);
    else {
      this.active.delete(id);
      this.inputs.delete(id);
    }
  }

  /** 실제 흐른 시간만큼 물리를 진행합니다. 레이스가 끝났으면 true */
  advance(now: number = performance.now()): boolean {
    if (this.ended) return true;
    const clock = this.clock(now);
    const elapsed = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (clock < this.startAt) return false;
    this.acc += elapsed;
    let guard = 0;
    while (this.acc >= DT && guard++ < 8) {
      this.acc -= DT;
      this.time += DT;
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

  snapshot(now: number = performance.now()): Snap {
    const order = rankCars(this.cars);
    return {
      t: Math.round(this.clock(now)),
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
