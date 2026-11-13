import crypto from 'node:crypto';
import {
  CarView, LIMITS, PlayerView, RaceResult, RoomPhase, RoomSettings, RoomView, Snap,
  TRACK_LIST, PHYS, checkNickname, normalizeNick,
} from '@racing/shared';
import { RaceSim } from './race';

const COLORS = ['#ff5a5f', '#ffb400', '#2ec4b6', '#3a86ff', '#8338ec', '#ff7ac6', '#70c13a', '#ff8c42', '#00b4d8', '#b08968'];
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000;
const MAX_ROOMS = 30;

export interface Player {
  id: string;
  token: string;
  name: string;
  color: string;
  connected: boolean;
  socketId: string | null;
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
  room(code: string, view: RoomView): void;
  snap(code: string, snap: Snap): void;
  closed(code: string): void;
}

const emptyCar = (): CarView => ({ status: 'none', imageUrl: null, glbUrl: null, progress: 0, hidden: false });

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export class Room {
  readonly hostToken = crypto.randomBytes(16).toString('hex');
  readonly createdAt = Date.now();
  lastActive = Date.now();
  phase: RoomPhase = 'lobby';
  settings: RoomSettings = { trackId: 'oval', laps: 3, heatSize: 8 };
  players = new Map<string, Player>();
  plan: Plan[] | null = null;
  planIndex = 0;
  race: RaceSim | null = null;
  lastResults: RaceResult[] | null = null;
  finalResults: RaceResult[] | null = null;
  private timer: NodeJS.Timeout | null = null;
  private tick = 0;

  constructor(readonly code: string, private events: RoomEvents) {}

  touch(): void {
    this.lastActive = Date.now();
  }

  // ───── 참가자 ─────

  join(rawName: string, socketId: string, prev?: { playerId?: string; token?: string }): Player | string {
    this.touch();
    if (prev?.playerId && prev.token) {
      const p = this.players.get(prev.playerId);
      if (p && p.token === prev.token) {
        p.connected = true;
        p.socketId = socketId;
        this.race?.setActive(p.id, true);
        this.broadcast();
        return p;
      }
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
    const p: Player = {
      id: crypto.randomBytes(6).toString('hex'),
      token: crypto.randomBytes(16).toString('hex'),
      name, color, connected: true, socketId, car: emptyCar(), joinedAt: Date.now(),
    };
    this.players.set(p.id, p);
    this.broadcast();
    return p;
  }

  disconnect(playerId: string, socketId: string): void {
    const p = this.players.get(playerId);
    if (!p || p.socketId !== socketId) return;
    p.connected = false;
    p.socketId = null;
    this.race?.setActive(p.id, false);
    this.broadcast();
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

  input(playerId: string, i: unknown): void {
    if (!this.race || !Array.isArray(i)) return;
    this.race.setInput(playerId, Number(i[0]), Number(i[1]), Number(i[2]));
  }

  // ───── 교사(호스트) 조작 ─────

  setSettings(s: Partial<RoomSettings>): void {
    this.touch();
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
    this.touch();
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
    this.touch();
    if (this.phase !== 'lobby') return;
    if (!this.plan) this.makePlan();
    const plan = this.plan?.[this.planIndex];
    if (!plan) return;
    const racers = plan.ids.filter((id) => this.players.get(id)?.connected);
    if (racers.length === 0) return;
    plan.ids = racers;
    this.race = new RaceSim(this.settings.trackId, this.settings.laps, racers);
    this.phase = 'countdown';
    this.tick = 0;
    const every = Math.round(PHYS.tickRate / LIMITS.snapRate);
    this.timer = setInterval(() => {
      const race = this.race;
      if (!race) return;
      const ended = race.advance();
      if (this.phase === 'countdown' && race.started) {
        this.phase = 'racing';
        this.broadcast();
      }
      if (this.tick++ % every === 0 || ended) this.events.snap(this.code, race.snapshot());
      if (ended) this.finishRace();
    }, 1000 / PHYS.tickRate);
    this.broadcast();
    this.events.snap(this.code, this.race.snapshot());
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
    this.touch();
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
    this.touch();
    this.stopTimer();
    this.race = null;
    this.plan = null;
    this.planIndex = 0;
    this.lastResults = null;
    this.finalResults = null;
    this.phase = 'lobby';
    this.broadcast();
  }

  close(): void {
    this.stopTimer();
    this.race = null;
    this.events.closed(this.code);
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
            trackId: this.race.trackId, laps: this.race.laps, racers: this.race.racers,
            label: plan?.label ?? '', isFinal: !!plan?.isFinal, startAt: this.race.startAt,
          }
        : null,
      lastResults: this.lastResults,
      finalResults: this.finalResults,
      maxPlayers: LIMITS.maxPlayers,
    };
  }

  broadcast(): void {
    this.events.room(this.code, this.view());
  }
}

export class RoomManager {
  rooms = new Map<string, Room>();
  /** 방이 닫힐 때 호출 (업로드 파일 정리 등) */
  onClose: ((code: string) => void) | null = null;

  constructor(private events: RoomEvents) {
    setInterval(() => this.sweep(), 10 * 60 * 1000).unref();
  }

  create(): Room | string {
    if (this.rooms.size >= MAX_ROOMS) return '지금은 방을 더 만들 수 없어요. 잠시 후 다시 해 주세요.';
    let code = '';
    do code = String(crypto.randomInt(1000, 10000));
    while (this.rooms.has(code));
    const room = new Room(code, this.events);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(String(code ?? '').trim());
  }

  close(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.close();
    this.rooms.delete(code);
    this.onClose?.(code);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.lastActive > ROOM_IDLE_MS) this.close(code);
    }
  }
}
