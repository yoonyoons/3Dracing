import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServer, ServerToClient } from '@racing/shared';
import { RoomManager } from './rooms';

interface SocketData {
  role?: 'host' | 'player';
  code?: string;
  playerId?: string;
}

export type IO = Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

export function createSockets(server: HttpServer): { io: IO; rooms: RoomManager } {
  // 기본 설정: 폴링으로 먼저 연결한 뒤 WebSocket 으로 올립니다.
  // 학교망에서 WebSocket 이 막혀 있으면 폴링으로 계속 동작합니다.
  const io: IO = new Server(server, {
    transports: ['polling', 'websocket'],
    pingInterval: 10000,
    pingTimeout: 8000,
    maxHttpBufferSize: 1e5,
  });

  const rooms = new RoomManager({
    room: (code, view) => io.to(code).emit('room', view),
    snap: (code, snap) => io.to(code).volatile.emit('snap', snap),
    closed: (code) => {
      io.to(code).emit('closed');
      io.in(code).socketsLeave(code);
    },
  });

  io.on('connection', (socket) => {
    const hostRoom = () => (socket.data.role === 'host' && socket.data.code ? rooms.get(socket.data.code) : undefined);

    socket.on('host:create', (cb) => {
      if (typeof cb !== 'function') return;
      const room = rooms.create();
      if (typeof room === 'string') return cb({ ok: false, error: room });
      socket.data.role = 'host';
      socket.data.code = room.code;
      socket.join(room.code);
      cb({ ok: true, code: room.code, hostToken: room.hostToken });
      socket.emit('room', room.view());
    });

    socket.on('host:resume', (p, cb) => {
      if (typeof cb !== 'function') return;
      const room = rooms.get(p?.code);
      if (!room || room.hostToken !== p?.hostToken) return cb({ ok: false, error: '방을 찾을 수 없어요.' });
      socket.data.role = 'host';
      socket.data.code = room.code;
      socket.join(room.code);
      room.touch();
      cb({ ok: true });
      socket.emit('room', room.view());
      if (room.race) socket.emit('snap', room.race.snapshot());
    });

    socket.on('host:settings', (s) => hostRoom()?.setSettings(s ?? {}));
    socket.on('host:plan', () => hostRoom()?.makePlan());
    socket.on('host:start', () => hostRoom()?.start());
    socket.on('host:next', () => hostRoom()?.next());
    socket.on('host:reset', () => hostRoom()?.reset());
    socket.on('host:stop', () => hostRoom()?.stop());
    socket.on('host:close', () => {
      const room = hostRoom();
      if (room) rooms.close(room.code);
    });
    socket.on('host:kick', (playerId) => {
      const room = hostRoom();
      const p = room?.remove(String(playerId));
      if (p?.socketId) {
        const s = io.sockets.sockets.get(p.socketId);
        s?.emit('kicked', '선생님이 내보냈어요.');
        s?.leave(room!.code);
        if (s) s.data = {};
      }
    });

    socket.on('player:join', (p, cb) => {
      if (typeof cb !== 'function') return;
      const room = rooms.get(p?.code);
      if (!room) return cb({ ok: false, error: '방 코드를 다시 확인해 주세요.' });
      const res = room.join(String(p?.name ?? ''), socket.id, { playerId: p?.playerId, token: p?.token });
      if (typeof res === 'string') return cb({ ok: false, error: res });
      socket.data.role = 'player';
      socket.data.code = room.code;
      socket.data.playerId = res.id;
      socket.join(room.code);
      cb({ ok: true, playerId: res.id, token: res.token, name: res.name });
      socket.emit('room', room.view());
      if (room.race) socket.emit('snap', room.race.snapshot());
    });

    socket.on('player:leave', () => {
      const { code, playerId } = socket.data;
      if (socket.data.role === 'player' && code && playerId) {
        rooms.get(code)?.remove(playerId);
        socket.leave(code);
        socket.data = {};
      }
    });

    socket.on('in', (i) => {
      const { code, playerId } = socket.data;
      if (socket.data.role === 'player' && code && playerId) rooms.get(code)?.input(playerId, i);
    });

    socket.on('rtt', (cb) => {
      if (typeof cb === 'function') cb();
    });

    socket.on('disconnect', () => {
      const { code, playerId } = socket.data;
      if (socket.data.role === 'player' && code && playerId) rooms.get(code)?.disconnect(playerId, socket.id);
    });
  });

  return { io, rooms };
}
