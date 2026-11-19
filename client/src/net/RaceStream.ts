import {
  type CarInput, type CarState, NO_INPUT, PHYS, type RaceInfo, type Snap, type Track,
  angleDiff, getTrack, locate, snapRateFor, stepCar,
} from '@racing/shared';
import type { RenderCar } from '../game/types';

const STEP = 1 / 60;
/** 입력을 묶어 보내느라 생기는 평균 지연(ms) */
const BATCH_LEAD = 150;

interface Hist { st: number; x: number; z: number; h: number; v: number }

/** 레이스 화면이 쓰는 공통 모양 (학생: 네트워크 스냅샷 / 교사: 직접 계산) */
export interface RaceView {
  readonly race: RaceInfo;
  getCars(): RenderCar[];
  getLeaderId(): string | undefined;
  order(): string[];
  countdown(): number;
  raceSeconds(): number;
  latest(id: string): { prog: number; v: number; boost: number; finished: boolean } | null;
  lapOf(id: string): number;
  speedRatio(id: string): number;
  readonly finished: boolean;
  frame(dt: number): void;
}

/**
 * 교사 화면이 보내는 스냅샷을 받아 화면에 그릴 위치를 만듭니다. (학생 기기)
 * - 다른 차: 조금 전 시점을 두 스냅샷 사이에서 보간 → 끊김 없이 부드럽게
 * - 내 차: 같은 물리 코드로 미리 움직이고(예측), 교사 화면 값과 차이는 조금씩 맞춥니다 → 조작이 바로 반응
 */
export class RaceStream implements RaceView {
  readonly track: Track;
  private snaps: Snap[] = [];
  private offset = NaN;
  private rtt = 150;
  private me: CarState | null = null;
  private simTime = 0;
  private acc = 0;
  private hist: Hist[] = [];
  private out: RenderCar[];
  private myIndex: number;
  private interpMs: number;
  finished = false;

  constructor(readonly race: RaceInfo, readonly myId: string | null, private readInput?: () => CarInput) {
    this.track = getTrack(race.trackId);
    this.myIndex = myId ? race.racers.indexOf(myId) : -1;
    this.out = race.racers.map((id) => ({ id, x: 0, z: 0, h: 0, v: 0, boost: 0 }));
    // 스냅샷 간격의 1.6배만큼 늦게 그려야 보간할 두 장이 늘 있습니다.
    this.interpMs = Math.round((1000 / snapRateFor(race.racers.length)) * 1.6);
  }

  setRtt(ms: number): void {
    this.rtt = Math.max(30, Math.min(800, ms));
  }

  get ready(): boolean {
    return this.snaps.length > 0;
  }

  serverNow(): number {
    return Number.isNaN(this.offset) ? 0 : performance.now() - this.offset;
  }

  countdown(): number {
    if (!this.ready) return 99;
    return Math.ceil((this.race.startAt - this.serverNow()) / 1000);
  }

  raceSeconds(): number {
    return Math.max(0, (this.serverNow() - this.race.startAt) / 1000);
  }

  private fromSnap(c: number[]): CarState {
    return {
      id: this.myId!, x: c[0], z: c[1], h: c[2], v: c[3], boost: c[4], prog: c[5],
      idx: locate(this.track, c[0], c[1]).idx, wall: false, finished: !!c[6], finishTime: 0,
    };
  }

  onSnap(s: Snap): void {
    if (s.r !== this.race.id || s.c.length !== this.race.racers.length) return;
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.t <= last.t) return;
    // 전달 시간은 들쭉날쭉하므로 "가장 빨리 온 것" 기준으로 시계를 맞춥니다.
    const sample = performance.now() - s.t;
    this.offset = Number.isNaN(this.offset) ? sample : Math.min(this.offset + 0.3, sample);
    this.snaps.push(s);
    if (this.snaps.length > 30) this.snaps.shift();

    if (this.myIndex < 0) return;
    const c = s.c[this.myIndex];
    this.finished = !!c[6];
    const tau = (s.t - this.race.startAt) / 1000;
    if (!this.me || tau <= 0 || this.finished) {
      this.me = this.fromSnap(c);
      this.hist = [];
      if (tau <= 0) this.simTime = 0;
      return;
    }
    if (this.hist.length === 0) return;
    let h = this.hist[0];
    for (const k of this.hist) if (Math.abs(k.st - tau) < Math.abs(h.st - tau)) h = k;
    const ex = c[0] - h.x;
    const ez = c[1] - h.z;
    const eh = angleDiff(c[2], h.h);
    const ev = c[3] - h.v;
    if (Math.hypot(ex, ez) > 12 || Math.abs(h.st - tau) > 0.6) {
      this.me = this.fromSnap(c);
      this.hist = [];
      this.simTime = tau + this.lead() / 1000;
      return;
    }
    const k = 0.25;
    this.me.x += ex * k;
    this.me.z += ez * k;
    this.me.h += eh * k;
    this.me.v += ev * k;
    this.me.prog = Math.max(this.me.prog, c[5] - 2);
    this.me.boost = Math.max(this.me.boost, c[4] - 0.3);
    for (const q of this.hist) {
      q.x += ex * k;
      q.z += ez * k;
      q.h += eh * k;
      q.v += ev * k;
    }
  }

  /** 내 입력이 교사 화면에 닿기까지 걸리는 시간 */
  private lead(): number {
    return this.rtt / 2 + BATCH_LEAD;
  }

  frame(dt: number): void {
    if (!this.me || this.finished || this.myIndex < 0) return;
    if (this.serverNow() < this.race.startAt - this.lead()) return;
    const input = this.readInput ? this.readInput() : NO_INPUT;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.simTime += STEP;
      stepCar(this.track, this.me, input, STEP);
    }
    this.hist.push({ st: this.simTime, x: this.me.x, z: this.me.z, h: this.me.h, v: this.me.v });
    while (this.hist.length > 120) this.hist.shift();
  }

  getCars = (): RenderCar[] => {
    const n = this.snaps.length;
    if (n === 0) return [];
    const ts = this.serverNow() - this.interpMs;
    let b = n - 1;
    while (b > 0 && this.snaps[b - 1].t >= ts) b--;
    const B = this.snaps[b];
    const A = this.snaps[Math.max(0, b - 1)];
    const span = B.t - A.t;
    const f = span > 0 ? (ts - A.t) / span : 1;
    for (let i = 0; i < this.out.length; i++) {
      const o = this.out[i];
      if (i === this.myIndex && this.me && !this.finished) {
        o.x = this.me.x; o.z = this.me.z; o.h = this.me.h; o.v = this.me.v; o.boost = this.me.boost;
        continue;
      }
      const a = A.c[i];
      const c = B.c[i];
      if (f <= 1) {
        const g = Math.max(0, f);
        o.x = a[0] + (c[0] - a[0]) * g;
        o.z = a[1] + (c[1] - a[1]) * g;
        o.h = a[2] + angleDiff(c[2], a[2]) * g;
      } else {
        const extra = Math.min(0.3, (ts - B.t) / 1000);
        o.x = c[0] + Math.sin(c[2]) * c[3] * extra;
        o.z = c[1] + Math.cos(c[2]) * c[3] * extra;
        o.h = c[2];
      }
      o.v = c[3];
      o.boost = c[4];
    }
    return this.out;
  };

  order(): string[] {
    const s = this.snaps[this.snaps.length - 1];
    return s ? s.o.map((i) => this.race.racers[i]) : this.race.racers;
  }

  getLeaderId = (): string | undefined => this.order()[0];

  latest(id: string) {
    const s = this.snaps[this.snaps.length - 1];
    const i = this.race.racers.indexOf(id);
    if (!s || i < 0) return null;
    if (i === this.myIndex && this.me && !this.finished) {
      return { prog: this.me.prog, v: this.me.v, boost: this.me.boost, finished: false };
    }
    const c = s.c[i];
    return { prog: c[5], v: c[3], boost: c[4], finished: !!c[6] };
  }

  lapOf(id: string): number {
    const c = this.latest(id);
    if (!c) return 1;
    return Math.max(1, Math.min(this.race.laps, Math.floor(c.prog / this.track.n) + 1));
  }

  speedRatio(id: string): number {
    const c = this.latest(id);
    return c ? Math.abs(c.v) / PHYS.maxSpeed : 0;
  }
}
