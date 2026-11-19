import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  Room, type CarView, type JoinRequest, type PlayerMessage, type RoomSave, type RoomSettings, type RoomView,
} from '@racing/shared';
import { closeChannel, loadJson, openChannel, rpc, saveJson, send } from './supabase';
import { workerTicker } from './workerTicker';

const KEY = 'racing.host';

interface Saved {
  code: string;
  secret: string;
  room: RoomSave | null;
}

interface CarRow {
  id: string;
  playerId: string;
  status: CarView['status'];
  version: number;
  glbVersion: number;
  hidden: boolean;
  flip: boolean;
  message: string | null;
  hasImage: boolean;
  hasGlb: boolean;
}

/**
 * 교사 화면 = 레이스 서버.
 * 방 상태와 레이스 물리를 이 브라우저에서 계산하고, Supabase Realtime 으로 학생 기기와 주고받습니다.
 * 이 탭을 닫으면 레이스가 멈춥니다. 다시 열면 학생 명단과 조 편성이 이어집니다.
 */
export class HostController {
  readonly room: Room;
  view: RoomView;
  private lobby: RealtimeChannel | null = null;
  private join: RealtimeChannel | null = null;
  private race: RealtimeChannel | null = null;
  private playerChans = new Map<string, RealtimeChannel>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private listeners = new Set<(v: RoomView) => void>();
  private lastSent = '';
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSentAt = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  closed = false;

  private constructor(readonly code: string, private secret: string, saved: RoomSave | null) {
    this.room = new Room(code, {
      room: (v) => this.onRoom(v),
      snap: (s) => send(this.race, 'snap', s),
    }, workerTicker);
    if (saved) this.room.restore(saved);
    this.view = this.room.view();
  }

  /** 새 방 만들기 (교사 코드 확인은 데이터베이스가 합니다) */
  static async create(teacherCode: string): Promise<HostController> {
    const r = await rpc<{ code: string; hostSecret: string }>('race_create_room', { p_teacher_code: teacherCode.trim() });
    const h = new HostController(r.code, r.hostSecret, null);
    await h.connect();
    return h;
  }

  /** 새로고침 전에 열어 둔 방이 있으면 이어서 엽니다. */
  static async resume(): Promise<HostController | null> {
    const saved = loadJson<Saved>(KEY);
    if (!saved) return null;
    try {
      await rpc('race_host_touch', { p_code: saved.code, p_secret: saved.secret });
    } catch (e) {
      if ((e as Error).message.includes('찾을 수 없')) saveJson(KEY, null);
      throw e;
    }
    const h = new HostController(saved.code, saved.secret, saved.room);
    await h.connect();
    return h;
  }

  static hasSaved(): boolean {
    return !!loadJson<Saved>(KEY);
  }

  private readonly onPageHide = () => this.persist();

  private async connect(): Promise<void> {
    this.persist();
    window.addEventListener('pagehide', this.onPageHide);
    const code = this.code;
    [this.lobby, this.join, this.race] = await Promise.all([
      openChannel(`lobby:${code}`),
      openChannel(`join:${code}`, { join: (p: JoinRequest) => void this.onJoin(p) }),
      openChannel(`race:${code}`),
    ]);
    await Promise.all([...this.room.players.values()].map((p) => this.listenTo(p.id, p.chan).catch(() => {})));
    this.timers.push(
      // 접속 확인도 탭이 뒤로 가면 늦어지지만, 몇 초 늦는 건 괜찮습니다.
      setInterval(() => this.room.checkOffline(), 5000),
      setInterval(() => void this.pollCars(), 4000),
      setInterval(() => void rpc('race_host_touch', { p_code: code, p_secret: this.secret }).catch(() => {}), 10 * 60 * 1000),
    );
    void this.pollCars();
    this.room.broadcast();
  }

  // ───── 방 상태 → 화면·학생 ─────

  subscribe(fn: (v: RoomView) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private onRoom(v: RoomView): void {
    // 단계가 바뀌면(레이스 끝 등) 바로 저장합니다. 곧바로 새로고침해도 결과가 남도록.
    const phaseChanged = v.phase !== this.view?.phase;
    this.view = v;
    if (phaseChanged) this.persist();
    for (const fn of this.listeners) fn(v);
    this.scheduleSend();
    this.scheduleSave();
  }

  /** 방 상태는 바뀔 때마다 보내되, 0.4초에 한 번까지만 (메시지 수 절약) */
  private scheduleSend(force = false): void {
    if (this.sendTimer) return;
    const wait = Math.max(0, 400 - (Date.now() - this.lastSentAt));
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      const json = JSON.stringify(this.view);
      if (!force && json === this.lastSent) return;
      this.lastSent = json;
      this.lastSentAt = Date.now();
      send(this.lobby, 'room', this.view);
    }, wait);
  }

  private resend(): void {
    this.lastSent = '';
    this.scheduleSend(true);
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, 500);
  }

  private persist(): void {
    if (this.closed) return;
    saveJson(KEY, { code: this.code, secret: this.secret, room: this.room.save() } satisfies Saved);
  }

  // ───── 학생 ─────

  private async onJoin(req: JoinRequest): Promise<void> {
    if (!req || !/^[a-f0-9]{12}$/.test(req.pid ?? '') || !/^[a-f0-9]{32}$/.test(req.chan ?? '')) return;
    const deny = (error: string) => send(this.join, 'deny', { nonce: req.nonce, error });
    const known = this.room.players.has(req.pid);
    const res = this.room.join(String(req.name ?? ''), req.pid, req.chan);
    if (typeof res === 'string') return deny(res);
    try {
      if (!known) {
        await rpc('race_host_register', { p_code: this.code, p_secret: this.secret, p_pid: res.id, p_chan: res.chan, p_nickname: res.name });
      }
      const ch = await this.listenTo(res.id, res.chan);
      send(ch, 'host', { type: 'welcome', pid: res.id, name: res.name });
      this.resend();
    } catch {
      if (!known) this.room.remove(res.id);
      deny('지금은 들어갈 수 없어요. 다시 해 주세요.');
    }
  }

  private async listenTo(pid: string, chan: string): Promise<RealtimeChannel> {
    const had = this.playerChans.get(pid);
    if (had) return had;
    const ch = await openChannel(`p:${this.code}:${chan}`, { player: (m: PlayerMessage) => this.onPlayer(pid, m) });
    this.playerChans.set(pid, ch);
    return ch;
  }

  private onPlayer(pid: string, m: PlayerMessage): void {
    const p = this.room.players.get(pid);
    if (!p || !m) return;
    const wasOff = !p.connected;
    this.room.seen(pid);
    const ch = this.playerChans.get(pid);
    switch (m.type) {
      case 'hello':
        if (wasOff || m.fresh) {
          send(ch, 'host', { type: 'welcome', pid, name: p.name });
          this.resend();
        }
        break;
      case 'in':
        this.room.inputs(pid, m.e);
        break;
      case 'car':
        void this.pollCars();
        break;
      case 'ping':
        send(ch, 'host', { type: 'pong', t: m.t });
        break;
      case 'leave':
        void this.kick(pid, null);
        break;
    }
  }

  async kick(pid: string, reason: string | null = '선생님이 내보냈어요.'): Promise<void> {
    const ch = this.playerChans.get(pid);
    if (reason) send(ch, 'host', { type: 'kicked', reason });
    this.room.remove(pid);
    this.playerChans.delete(pid);
    setTimeout(() => closeChannel(ch), 500);
    await rpc('race_host_remove', { p_code: this.code, p_secret: this.secret, p_pid: pid }).catch(() => {});
  }

  async hide(pid: string, hidden: boolean): Promise<void> {
    await rpc('race_host_hide', { p_code: this.code, p_secret: this.secret, p_pid: pid, p_hidden: hidden });
    await this.pollCars();
  }

  /** 학생들의 차(그림·3D 모델) 상태를 데이터베이스에서 다시 읽습니다. */
  async pollCars(): Promise<void> {
    if (this.polling || this.closed) return;
    this.polling = true;
    try {
      const r = await rpc<{ cars: CarRow[]; generator: RoomView['generator'] }>('race_room_cars', { p_code: this.code });
      const map = new Map<string, CarView>();
      for (const c of r.cars) {
        map.set(c.playerId, {
          status: c.status,
          imageUrl: c.hasImage && !c.hidden ? `car:${c.id}:image:${c.version}` : null,
          glbUrl: c.hasGlb && !c.hidden ? `car:${c.id}:glb:${c.glbVersion}` : null,
          progress: c.status === 'ready' ? 1 : 0,
          hidden: c.hidden,
          flip: c.flip,
          message: c.message ?? undefined,
        });
      }
      this.room.setCars(map, r.generator);
    } catch { /* 다음 차례에 다시 */ }
    finally {
      this.polling = false;
    }
  }

  // ───── 교사 조작 ─────

  settings(s: Partial<RoomSettings>) { this.room.setSettings(s); }
  plan() { this.room.makePlan(); }
  start() { this.room.start(); }
  stop() { this.room.stop(); }
  next() { this.room.next(); }
  reset() { this.room.reset(); }

  /** 방 닫기: 학생을 모두 내보내고 이 방의 그림·3D 모델을 지웁니다. */
  async close(): Promise<void> {
    send(this.lobby, 'closed', {});
    this.closed = true;
    saveJson(KEY, null);
    await rpc('race_host_close', { p_code: this.code, p_secret: this.secret }).catch(() => {});
    setTimeout(() => this.dispose(), 400);
  }

  dispose(): void {
    window.removeEventListener('pagehide', this.onPageHide);
    this.room.dispose();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.sendTimer) clearTimeout(this.sendTimer);
    for (const ch of [this.lobby, this.join, this.race, ...this.playerChans.values()]) closeChannel(ch);
    this.playerChans.clear();
    this.listeners.clear();
  }

  /** 교사 화면이 직접 계산 중인 레이스 (중계 화면용) */
  get sim() {
    return this.room.race;
  }
}
