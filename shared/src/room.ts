// 교사 화면(호스트)에서 돌아가는 방 관리. 서버 없이 브라우저 안에서 동작합니다.
import {
  LIMITS, snapRateFor,
  type CarView, type PlayerView, type RaceResult, type RoomPhase, type RoomSettings, type RoomView, type Snap,
} from './protocol';
import { PHYS } from './physics';
import { TRACK_LIST } from './track';
import { checkNickname, normalizeNick } from './nickname';
import { RaceSim, type InputEvent } from './race';

const COLORS = ['#ff5a5f', '#ffb400', '#2ec4b6', '#3a86ff', '#8338ec', '#ff7ac6', '#70c13a', '#ff8c42', '#00b4d8', '#b08968'];

export function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomInt(n: number): number {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] % n;
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export interface Player {
  id: string;
  /** 학생 전용 채널 이름에 들어가는 비밀 값. 방 상태에는 절대 넣지 않습니다. */
  chan: string;
  name: string;
  color: string;
  connected: boolean;
  lastSeen: number;
  car: CarView;
  joinedAt: number;
}

interface Plan {
  label: string;
  ids: string[];
  isFinal: boolean;
  results: RaceResult[] | null;
}

export interface RoomEvents {
  /** 방 상태가 바뀜 → 모두에게 알림 */
  room(view: RoomView): void;
  /** 레이스 스냅샷 → 달리는 학생에게 */
  snap(snap: Snap): void;
}

export const emptyCar = (): CarView => ({ status: 'none', imageUrl: null, glbUrl: null, progress: 0, hidden: false, flip: false });

/** 새로고침해도 이어지도록 저장하는 방 정보 */
export interface RoomSave {
  code: string;
  settings: RoomSettings;
  players: Omit<Player, 'connected' | 'lastSeen' | 'car'>[];
  plan: Plan[] | null;
  planIndex: number;
  lastResults: RaceResult[] | null;
  finalResults: RaceResult[] | null;
  phase: RoomPhase;
}

export class Room {
  phase: RoomPhase = 'lobby';
  settings: RoomSettings = { trackId: 'oval', laps: 3, heatSize: 8 };
  players = new Map<string, Player>();
  plan: Plan[] | null = null;
  planIndex = 0;
  race: RaceSim | null = null;
  raceId = '';
  lastResults: RaceResult[] | null = null;
  finalResults: RaceResult[] | null = null;
  generator: RoomView['generator'] = 'pregenerated';
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;

  constructor(readonly code: string, private events: RoomEvents) {}

  // ───── 참가자 ─────

  /** 새 학생 입장. 이미 있는 학생(같은 비밀 값)이면 다시 연결된 것으로 처리합니다. */
  join(rawName: string, pid: string, chan: string): Player | string {
    const known = this.players.get(pid);
    if (known) {
      if (known.chan !== chan) return '다시 입장해 주세요.';
      this.seen(pid);
      return known;
    }
    const err = checkNickname(rawName);
    if (err) return err;
    if (this.players.size >= LIMITS.maxPlayers) return `방이 꽉 찼어요. (최대 ${LIMITS.maxPlayers}명)`;
    let name = normalizeNick(rawName);
    const taken = new Set([...this.players.values()].map((p) => p.name));
    if (taken.has(name)) {
      let n = 2;
      const base = [...name].slice(0, 6).join('');
      while (taken.has(base + n)) n++;
      name = base + n;
    }
    const used = new Map<string, number>();
    for (const p of this.players.values()) used.set(p.color, (used.get(p.color) ?? 0) + 1);
    const color = [...COLORS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0];
    const now = Date.now();
    const p: Player = { id: pid, chan, name, color, connected: true, lastSeen: now, car: emptyCar(), joinedAt: now };
    this.players.set(p.id, p);
    this.broadcast();
    return p;
  }

  /** 학생에게서 소식이 옴 (살아 있음) */
  seen(pid: string): void {
    const p = this.players.get(pid);
    if (!p) return;
    p.lastSeen = Date.now();
    if (!p.connected) {
      p.connected = true;
      this.race?.setActive(p.id, true);
      this.broadcast();
    }
  }

  /** 한동안 소식이 없는 학생을 "끊김"으로 표시합니다. */
  checkOffline(now = Date.now()): void {
    let changed = false;
    for (const p of this.players.values()) {
      if (p.connected && now - p.lastSeen > LIMITS.offlineMs) {
        p.connected = false;
        this.race?.setActive(p.id, false);
        changed = true;
      }
    }
    if (changed) this.broadcast();
  }

  remove(playerId: string): Player | undefined {
    const p = this.players.get(playerId);
    if (!p) return;
    this.players.delete(playerId);
    this.race?.setActive(playerId, false);
    if (this.plan && this.phase === 'lobby') {
      for (const pl of this.plan) if (!pl.results) pl.ids = pl.ids.filter((id) => id !== playerId);
    }
    this.broadcast();
    return p;
  }

  inputs(playerId: string, events: InputEvent[]): void {
    this.race?.queueInputs(playerId, events);
  }

  /** 차 모습이 바뀐 학생들을 반영합니다. */
  setCars(cars: Map<string, CarView>, generator?: RoomView['generator']): void {
    let changed = false;
    if (generator && generator !== this.generator) {
      this.generator = generator;
      changed = true;
    }
    for (const p of this.players.values()) {
      const next = cars.get(p.id) ?? emptyCar();
      if (JSON.stringify(next) !== JSON.stringify(p.car)) {
        p.car = next;
        changed = true;
      }
    }
    if (changed) this.broadcast();
  }

  // ───── 교사 조작 ─────

  setSettings(s: Partial<RoomSettings>): void {
    if (this.phase !== 'lobby') return;
    if (typeof s.trackId === 'string' && TRACK_LIST.some((t) => t.id === s.trackId)) this.settings.trackId = s.trackId;
    if (Number.isFinite(s.laps)) this.settings.laps = Math.max(1, Math.min(LIMITS.maxLaps, Math.round(s.laps!)));
    if (Number.isFinite(s.heatSize)) {
      const h = Math.max(LIMITS.minHeat, Math.min(LIMITS.maxHeat, Math.round(s.heatSize!)));
      if (h !== this.settings.heatSize && !this.plan?.some((p) => p.results)) this.plan = null;
      this.settings.heatSize = h;
    }
    this.broadcast();
  }

  /** 접속해 있는 학생을 조로 나눕니다. 한 조에 다 들어가면 바로 결승입니다. */
  makePlan(): void {
    if (this.phase !== 'lobby') return;
    const ids = shuffle([...this.players.values()].filter((p) => p.connected).map((p) => p.id));
    if (ids.length === 0) return;
    const size = this.settings.heatSize;
    this.finalResults = null;
    this.lastResults = null;
    this.planIndex = 0;
    if (ids.length <= size) {
      this.plan = [{ label: '결승', ids, isFinal: true, results: null }];
    } else {
      const heats = Math.ceil(ids.length / size);
      const groups: string[][] = Array.from({ length: heats }, () => []);
      ids.forEach((id, i) => groups[i % heats].push(id));
      this.plan = groups.map((g, i) => ({ label: `예선 ${i + 1}조`, ids: g, isFinal: false, results: null }));
    }
    this.broadcast();
  }

  /** 예선이 모두 끝나면 결승 진출자를 뽑습니다: 각 조 상위권 + 남는 자리는 기록 순 */
  private buildFinal(): void {
    if (!this.plan || this.plan.some((p) => p.isFinal)) return;
    const size = this.settings.heatSize;
    const heats = this.plan.filter((p) => p.results);
    const perHeat = Math.max(1, Math.floor(size / heats.length));
    const picked: string[] = [];
    const rest: RaceResult[] = [];
    for (const h of heats) {
      h.results!.forEach((r, i) => (i < perHeat ? picked.push(r.id) : rest.push(r)));
    }
    rest.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
    for (const r of rest) {
      if (picked.length >= size) break;
      if (r.time !== null) picked.push(r.id);
    }
    const ids = picked.filter((id) => this.players.has(id)).slice(0, size);
    this.plan.push({ label: '결승', ids, isFinal: true, results: null });
  }

  start(): void {
    if (this.phase !== 'lobby') return;
    if (!this.plan) this.makePlan();
    const plan = this.plan?.[this.planIndex];
    if (!plan) return;
    const racers = plan.ids.filter((id) => this.players.get(id)?.connected);
    if (racers.length === 0) return;
    plan.ids = racers;
    this.race = new RaceSim(this.settings.trackId, this.settings.laps, racers);
    this.raceId = randomHex(4);
    this.phase = 'countdown';
    this.tick = 0;
    const every = Math.max(1, Math.round(PHYS.tickRate / snapRateFor(racers.length)));
    this.timer = setInterval(() => {
      const race = this.race;
      if (!race) return;
      const ended = race.advance();
      if (this.phase === 'countdown' && race.started) {
        this.phase = 'racing';
        this.broadcast();
      }
      if (this.tick++ % every === 0 || ended) this.events.snap(this.snapshot());
      if (ended) this.finishRace();
    }, 1000 / PHYS.tickRate);
    this.broadcast();
    this.events.snap(this.snapshot());
  }

  private snapshot(): Snap {
    return { r: this.raceId, ...this.race!.snapshot() };
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private finishRace(): void {
    const race = this.race;
    if (!race) return;
    this.stopTimer();
    const results = race.results((id) => this.players.get(id)?.name ?? '?');
    const plan = this.plan?.[this.planIndex];
    if (plan) plan.results = results;
    this.lastResults = results;
    if (plan?.isFinal) this.finalResults = results;
    this.phase = 'results';
    this.broadcast();
  }

  /** 교사가 레이스를 중간에 끝냄 */
  stop(): void {
    if (this.phase === 'countdown' || this.phase === 'racing') this.finishRace();
  }

  /** 결과 화면 → 다음 조 대기 / 시상대 */
  next(): void {
    if (this.phase !== 'results' || !this.plan) return;
    this.race = null;
    const cur = this.plan[this.planIndex];
    if (cur?.isFinal) {
      this.phase = 'podium';
    } else {
      this.planIndex++;
      if (this.planIndex >= this.plan.length) this.buildFinal();
      this.phase = 'lobby';
    }
    this.broadcast();
  }

  /** 새 대회: 조 편성을 지우고 대기실로 */
  reset(): void {
    this.stopTimer();
    this.race = null;
    this.plan = null;
    this.planIndex = 0;
    this.lastResults = null;
    this.finalResults = null;
    this.phase = 'lobby';
    this.broadcast();
  }

  dispose(): void {
    this.stopTimer();
    this.race = null;
  }

  // ───── 저장 / 불러오기 ─────

  save(): RoomSave {
    return {
      code: this.code,
      settings: this.settings,
      players: [...this.players.values()].map(({ id, chan, name, color, joinedAt }) => ({ id, chan, name, color, joinedAt })),
      plan: this.plan,
      planIndex: this.planIndex,
      lastResults: this.lastResults,
      finalResults: this.finalResults,
      phase: this.phase,
    };
  }

  /** 교사 화면을 새로고침했을 때. 달리던 레이스는 이어갈 수 없어 대기실로 돌아갑니다. */
  restore(s: RoomSave): void {
    this.settings = { ...this.settings, ...s.settings };
    this.players.clear();
    for (const p of s.players) {
      this.players.set(p.id, { ...p, connected: false, lastSeen: 0, car: emptyCar() });
    }
    this.plan = s.plan;
    this.planIndex = s.planIndex;
    this.lastResults = s.lastResults;
    this.finalResults = s.finalResults;
    this.phase = s.phase === 'podium' ? 'podium' : s.phase === 'results' ? 'results' : 'lobby';
    if (this.phase === 'results' && !this.lastResults) this.phase = 'lobby';
    if (this.plan && this.phase === 'lobby') {
      const cur = this.plan[this.planIndex];
      if (cur?.results) cur.results = null;
    }
  }

  // ───── 내보내기 ─────

  view(): RoomView {
    const players: PlayerView[] = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, connected: p.connected, car: p.car }));
    const plan = this.plan?.[this.planIndex];
    return {
      code: this.code,
      phase: this.phase,
      settings: this.settings,
      players,
      plan: this.plan?.map((p) => ({ label: p.label, ids: p.ids, isFinal: p.isFinal, results: p.results })) ?? null,
      planIndex: this.planIndex,
      race: this.race
        ? {
            id: this.raceId, trackId: this.race.trackId, laps: this.race.laps, racers: this.race.racers,
            label: plan?.label ?? '', isFinal: !!plan?.isFinal, startAt: this.race.startAt,
          }
        : null,
      lastResults: this.lastResults,
      finalResults: this.finalResults,
      maxPlayers: LIMITS.maxPlayers,
      generator: this.generator,
    };
  }

  broadcast(): void {
    this.events.room(this.view());
  }
}
