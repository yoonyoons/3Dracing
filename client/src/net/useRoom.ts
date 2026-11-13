import { useEffect, useState } from 'react';
import type { RoomView } from '@racing/shared';
import { getSocket } from './socket';

/** 서버가 보내 주는 방 상태를 구독합니다. */
export function useRoom(): { room: RoomView | null; connected: boolean; setRoom: (r: RoomView | null) => void } {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(getSocket().connected);
  useEffect(() => {
    const s = getSocket();
    const onRoom = (v: RoomView) => setRoom(v);
    const up = () => setConnected(true);
    const down = () => setConnected(false);
    s.on('room', onRoom);
    s.on('connect', up);
    s.on('disconnect', down);
    return () => {
      s.off('room', onRoom);
      s.off('connect', up);
      s.off('disconnect', down);
    };
  }, []);
  return { room, connected, setRoom };
}
