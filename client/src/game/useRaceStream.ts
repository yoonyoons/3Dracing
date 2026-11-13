import { useEffect, useMemo, useState } from 'react';
import type { CarInput, RaceInfo } from '@racing/shared';
import { RaceStream } from '../net/RaceStream';
import { getSocket } from '../net/socket';

export interface LiveInfo {
  countdown: number;
  time: number;
  order: string[];
}

/** 레이스 한 판 동안 스냅샷을 받아 그릴 준비를 합니다. */
export function useRaceStream(race: RaceInfo | null, myId: string | null, readInput?: () => CarInput) {
  const key = race ? `${race.trackId}|${race.laps}|${race.racers.join(',')}|${race.label}` : '';
  const stream = useMemo(
    () => (race ? new RaceStream(race, myId, readInput) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, myId],
  );
  const [live, setLive] = useState<LiveInfo>({ countdown: 99, time: 0, order: [] });

  useEffect(() => {
    if (!stream) return;
    const detach = stream.attach(getSocket());
    const t = window.setInterval(() => {
      setLive({ countdown: stream.countdown(), time: stream.raceSeconds(), order: stream.order() });
    }, 100);
    return () => {
      detach();
      window.clearInterval(t);
    };
  }, [stream]);

  return { stream, live };
}
