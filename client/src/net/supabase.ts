import { createClient, type RealtimeChannel } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_KEY as string;

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  // 교사 화면은 1초에 스냅샷·방 상태를 여러 번 보내므로 기본 제한(초당 10개)을 넉넉히 올립니다.
  realtime: { params: { eventsPerSecond: 60 } },
});

/** 데이터베이스 함수 호출. { ok:false, error } 를 받으면 그 문구로 오류를 냅니다. */
export async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(fn, error);
    throw new Error('인터넷 연결을 확인해 주세요.');
  }
  if (!data || data.ok === false) throw new Error((data && data.error) || '잠시 후 다시 해 주세요.');
  return data as T;
}

type Handler = (payload: any) => void;

/** 채널에 들어가서(구독) 준비될 때까지 기다립니다. */
export function openChannel(name: string, handlers: Record<string, Handler> = {}): Promise<RealtimeChannel> {
  const ch = supabase.channel(name, { config: { broadcast: { self: false, ack: false } } });
  for (const [event, fn] of Object.entries(handlers)) ch.on('broadcast', { event }, (m) => fn(m.payload));
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) { done = true; reject(new Error('실시간 연결이 안 돼요. 인터넷을 확인해 주세요.')); }
    }, 12000);
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED' && !done) {
        done = true;
        clearTimeout(t);
        resolve(ch);
      }
    });
  });
}

export function send(ch: RealtimeChannel | null | undefined, event: string, payload: unknown): void {
  if (!ch) return;
  void ch.send({ type: 'broadcast', event, payload }).catch(() => {});
}

export function closeChannel(ch: RealtimeChannel | null | undefined): void {
  if (ch) void supabase.removeChannel(ch);
}

export function realtimeConnected(): boolean {
  return supabase.realtime.isConnected();
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function bytesToB64(bytes: Uint8Array | Blob): Promise<string> {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart]);
  const url: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(',') + 1);
}

export function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveJson(key: string, value: unknown | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* 저장이 막힌 브라우저에서도 게임은 됩니다 */ }
}
