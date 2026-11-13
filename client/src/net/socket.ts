import { io, Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '@racing/shared';

export type AppSocket = Socket<ServerToClient, ClientToServer>;

let socket: AppSocket | null = null;

/** 같은 주소의 서버에 연결합니다. WebSocket 이 막힌 학교망에서는 폴링으로 동작합니다. */
export function getSocket(): AppSocket {
  if (!socket) {
    socket = io({ transports: ['polling', 'websocket'], reconnectionDelayMax: 3000 });
  }
  return socket;
}

export function loadSession<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveSession(key: string, value: unknown | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* 저장이 막힌 브라우저에서도 게임은 됩니다 */ }
}
