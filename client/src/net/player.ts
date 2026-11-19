import type { RealtimeChannel } from '@supabase/supabase-js';
import { randomHex, type HostMessage, type PlayerMessage, type RoomView, type Snap } from '@racing/shared';
import { closeChannel, loadJson, openChannel, rpc, saveJson, send } from './supabase';

const KEY = 'racing.player';

export interface PlayerAuth {
  code: string;
  pid: string;
  chan: string;
  name: string;
}

type State = 'connecting' | 'ok' | 'waiting-host';

/**
 * 학생 기기. 교사 화면(호스트)이 보내는 방 상태를 받고, 자기 입력을 자기 전용 채널로 보냅니다.
 * 전용 채널 이름에 들어가는 비밀 값(chan)은 이 기기와 교사 화면만 압니다.
 */
export class PlayerController {
  view: RoomView | null = null;
  state: State = 'connecting';
  private lobby: RealtimeChannel | null = null;
  private mine: RealtimeChannel | null = null;
  private raceCh: RealtimeChannel | null = null;
  private raceKey = '';
  private listeners = new Set<() => void>();
  private snapListeners = new Set<(s: Snap) => void>();
  private pongs = new Map<number, (rtt: number) => void>();
  private welcomed: ((name: string) => void) | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private lastSend = 0;
  onKicked: ((msg: string) => void) | null = null;

  private constructor(readonly auth: PlayerAuth) {}

  static saved(): PlayerAuth | null {
    return loadJson<PlayerAuth>(KEY);
  }

  static forget(): void {
    saveJson(KEY, null);
  }

  /** 방 코드 + 별명으로 새로 입장 */
  static async join(code: string, name: string): Promise<PlayerController> {
    const { exists } = await rpc<{ exists: boolean }>('race_room_exists', { p_code: code });
    if (!exists) throw new Error('방 코드를 다시 확인해 주세요.');
    const c = new PlayerController({ code, pid: randomHex(6), chan: randomHex(16), name });
    await c.open();
    const nonce = randomHex(6);
    const joinCh = await openChannel(`join:${code}`, {
      deny: (p: { nonce: string; error: string }) => {
        if (p?.nonce === nonce) fail(p.error);
      },
    });
    let fail: (msg: string) => void = () => {};
    try {
      const welcomed = new Promise<string>((resolve, reject) => {
        c.welcomed = resolve;
        fail = (msg) => reject(new Error(msg));
        setTimeout(() => reject(new Error('선생님 화면이 응답하지 않아요. 큰 화면이 켜져 있는지 확인해 주세요.')), 10000);
      });
      send(joinCh, 'join', { nonce, name, pid: c.auth.pid, chan: c.auth.chan });
      const finalName = await welcomed;
      c.auth.name = finalName;
      c.state = 'ok';
      saveJson(KEY, c.auth);
      c.startTimers();
      return c;
    } catch (e) {
      c.dispose();
      throw e;
    } finally {
      closeChannel(joinCh);
    }
  }

  /** 새로고침 후 다시 연결 */
  static async resume(auth: PlayerAuth): Promise<PlayerController> {
    const c = new PlayerController(auth);
    await c.open();
    c.startTimers();
    c.welcomed = (name) => {
      c.auth.name = name;
      c.state = 'ok';
      saveJson(KEY, c.auth);
      c.emit();
    };
    c.say({ type: 'hello', fresh: true });
    setTimeout(async () => {
      if (c.state === 'ok') return;
      const { exists } = await rpc<{ exists: boolean }>('race_room_exists', { p_code: auth.code }).catch(() => ({ exists: true }));
      if (!exists) {
        saveJson(KEY, null);
        c.onKicked?.('방이 닫혔어요. 수고했어요! 👋');
      } else {
        c.state = 'waiting-host';
        c.emit();
      }
    }, 6000);
    return c;
  }

  private async open(): Promise<void> {
    const { code, chan } = this.auth;
    [this.lobby, this.mine] = await Promise.all([
      openChannel(`lobby:${code}`, {
        room: (v: RoomView) => this.onRoom(v),
        closed: () => {
          saveJson(KEY, null);
          this.onKicked?.('방이 닫혔어요. 수고했어요! 👋');
        },
      }),
      openChannel(`p:${code}:${chan}`, { host: (m: HostMessage) => this.onHost(m) }),
    ]);
  }

  private startTimers(): void {
    // 한동안 아무것도 안 보냈으면 "살아 있어요"를 보냅니다.
    this.timers.push(setInterval(() => {
      if (Date.now() - this.lastSend > 9000) this.say({ type: 'hello' });
    }, 3000));
  }

  private onHost(m: HostMessage): void {
    if (!m) return;
    if (m.type === 'welcome') {
      this.welcomed?.(m.name);
    } else if (m.type === 'kicked') {
      saveJson(KEY, null);
      this.onKicked?.(m.reason);
    } else if (m.type === 'pong') {
      const fn = this.pongs.get(m.t);
      this.pongs.delete(m.t);
      fn?.(performance.now() - m.t);
    }
  }

  private onRoom(v: RoomView): void {
    if (!v || v.code !== this.auth.code) return;
    this.view = v;
    const me = v.players.find((p) => p.id === this.auth.pid);
    if (me && this.state !== 'ok') {
      this.state = 'ok';
    }
    // 교사 화면이 새로고침되어 나를 "끊김"으로 알고 있으면 바로 알려 줍니다.
    if (me && !me.connected) this.say({ type: 'hello' });
    // 내가 달리는 레이스가 있으면 레이스 채널에 들어갑니다.
    const racing = v.race && v.race.racers.includes(this.auth.pid) && (v.phase === 'countdown' || v.phase === 'racing');
    const key = racing ? v.race!.id : '';
    if (key !== this.raceKey) {
      this.raceKey = key;
      closeChannel(this.raceCh);
      this.raceCh = null;
      if (key) {
        void openChannel(`race:${v.code}`, { snap: (s: Snap) => this.snapListeners.forEach((fn) => fn(s)) })
          .then((ch) => {
            if (this.raceKey === key) this.raceCh = ch;
            else closeChannel(ch);
          })
          .catch(() => {});
      }
    }
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onSnap(fn: (s: Snap) => void): () => void {
    this.snapListeners.add(fn);
    return () => this.snapListeners.delete(fn);
  }

  say(m: PlayerMessage): void {
    this.lastSend = Date.now();
    send(this.mine, 'player', m);
  }

  /** 교사 화면까지 왕복 시간(ms) */
  ping(): Promise<number> {
    return new Promise((resolve) => {
      const t = performance.now();
      this.pongs.set(t, resolve);
      this.say({ type: 'ping', t });
      setTimeout(() => {
        if (this.pongs.delete(t)) resolve(400);
      }, 2000);
    });
  }

  /** 차가 바뀌었다고 교사 화면에 알립니다(바로 다시 읽어 감). */
  carChanged(): void {
    this.say({ type: 'car' });
  }

  leave(): void {
    this.say({ type: 'leave' });
    saveJson(KEY, null);
    setTimeout(() => this.dispose(), 300);
  }

  dispose(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const ch of [this.lobby, this.mine, this.raceCh]) closeChannel(ch);
    this.lobby = this.mine = this.raceCh = null;
    this.listeners.clear();
    this.snapListeners.clear();
  }
}
