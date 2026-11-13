import {
  CarInput, CarState, NO_INPUT, PHYS, RaceInfo, Snap, Track,
  angleDiff, getTrack, locate, stepCar,
} from '@racing/shared';
import type { RenderCar } from '../game/types';
import type { AppSocket } from './socket';

const INTERP_MS = 150;
const STEP = 1 / 60;

interface Hist { st: number; x: number; z: number; h: number; v: number }

/**
 * 서버 스냅샷을 받아 화면에 그릴 위치를 만듭니다.
 * - 다른 차: 150ms 전 시점을 두 스냅샷 사이에서 보간 → 끊김 없이 부드럽게
 * - 내 차: 같은 물리 코드로 미리 움직이고(예측), 서버 값과 차이는 조금씩 맞춥니다 → 조작이 바로 반응
 */
export class RaceStream {
  readonly track: Track;
  private snaps: Snap[] = [];
  private offset = NaN;
  private rtt = 80;
  private me: CarState | null = null;
  private simTime = 0;
  private acc = 0;
  private hist: Hist[] = [];
  private out: RenderCar[];
  private myIndex: number;
  private rttTimer: number | null = null;
  finished = false;

  constructor(readonly race: RaceInfo, readonly myId: string | null, private readInput?: () => CarInput) {
    this.track = getTrack(race.trackId);
    this.myIndex = myId ? race.racers.indexOf(myId) : -1;
    this.out = race.racers.map((id) => ({ id, x: 0, z: 0, h: 0, v: 0, boost: 0 }));
  }

  attach(socket: AppSocket): () => void {
    const onSnap = (s: Snap) => this.onSnap(s);
    socket.on('snap', onSnap);
    const measure = () => {
      const t = performance.now();
      socket.timeout(2000).emit('rtt', (err: unknown) => {
        if (!err) this.rtt += (Math.min(600, performance.now() - t) - this.rtt) * 0.3;
      });
    };
    measure();
    this.rttTimer = window.setInterval(measure, 2000);
    return () => {
      socket.off('snap', onSnap);
      if (this.rttTimer) window.clearInterval(this.rttTimer);
    };
  }

  get ready(): boolean {
    return this.snaps.length > 0;
  }

  /** 서버 레이스 시계 추정값(ms) */
  serverNow(): number {
    return Number.isNaN(this.offset) ? 0 : performance.now() - this.offset;
  }

  /** 출발까지 남은 초(올림). 출발 후엔 0 이하 */
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

  private onSnap(s: Snap): void {
    if (s.c.length !== this.race.racers.length) return;
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.t <= last.t) return;
    const sample = performance.now() - s.t;
    this.offset = Number.isNaN(this.offset) ? sample : Math.min(this.offset + 0.2, sample);
    this.snaps.push(s);
    if (this.snaps.length > 30) this.snaps.shift();

    if (this.myIndex < 0) return;
    const c = s.c[this.myIndex];
    this.finished = !!c[6];
    const tau = (s.t - this.race.startAt) / 1000;
    if (!this.me || tau <= 0 || this.finished || this.hist.length === 0) {
      if (!this.me || tau <= 0 || this.finished) {
        this.me = this.fromSnap(c);
        this.hist = [];
        if (tau <= 0) this.simTime = 0;
      }
      return;
    }
    // 서버가 계산한 시점(tau)에 내가 예측했던 위치와 비교합니다.
    let h = this.hist[0];
    for (const k of this.hist) if (Math.abs(k.st - tau) < Math.abs(h.st - tau)) h = k;
    const ex = c[0] - h.x;
    const ez = c[1] - h.z;
    const eh = angleDiff(c[2], h.h);
    const ev = c[3] - h.v;
    if (Math.hypot(ex, ez) > 10 || Math.abs(h.st - tau) > 0.5) {
      this.me = this.fromSnap(c);
      this.hist = [];
      this.simTime = tau + this.rtt / 1000;
      return;
    }
    const k = 0.18;
    this.me.x += ex * k;
    this.me.z += ez * k;
    this.me.h += eh * k;
    this.me.v += ev * k;
    this.me.boost = Math.max(this.me.boost, c[4] - 0.3);
    for (const q of this.hist) {
      q.x += ex * k;
      q.z += ez * k;
      q.h += eh * k;
      q.v += ev * k;
    }
  }

  /** 매 프레임 호출: 내 차 예측을 진행합니다. */
  frame(dt: number): void {
    if (!this.me || this.finished || this.myIndex < 0) return;
    // 내 입력이 서버에 닿는 시간만큼 먼저 출발해야 서버와 같은 시점을 달립니다.
    if (this.serverNow() < this.race.startAt - this.rtt) return;
    const input = this.readInput ? this.readInput() : NO_INPUT;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.simTime += STEP;
      stepCar(this.track, this.me, input, STEP);
    }
    this.hist.push({ st: this.simTime, x: this.me.x, z: this.me.z, h: this.me.h, v: this.me.v });
    while (this.hist.length > 90) this.hist.shift();
  }

  getCars = (): RenderCar[] => {
    const n = this.snaps.length;
    if (n === 0) return [];
    const ts = this.serverNow() - INTERP_MS;
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
        // 새 스냅샷이 늦으면 잠깐은 가던 방향으로 계속 그립니다.
        const extra = Math.min(0.25, (ts - B.t) / 1000);
        o.x = c[0] + Math.sin(c[2]) * c[3] * extra;
        o.z = c[1] + Math.cos(c[2]) * c[3] * extra;
        o.h = c[2];
      }
      o.v = c[3];
      o.boost = c[4];
    }
    return this.out;
  };

  /** 순위 순서의 참가자 id */
  order(): string[] {
    const s = this.snaps[this.snaps.length - 1];
    return s ? s.o.map((i) => this.race.racers[i]) : this.race.racers;
  }

  getLeaderId = (): string | undefined => this.order()[0];

  /** 최신 스냅샷의 차 상태 (HUD 용) */
  latest(id: string): { prog: number; v: number; boost: number; finished: boolean } | null {
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
