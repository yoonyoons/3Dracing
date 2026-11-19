import { useEffect, useMemo, useState } from 'react';
import type { CarInput, RaceInfo } from '@racing/shared';
import { RaceStream, type RaceView } from '../net/RaceStream';
import { LocalRace } from '../net/LocalRace';
import type { HostController } from '../net/host';
import type { PlayerController } from '../net/player';

export interface LiveInfo {
  countdown: number;
  time: number;
  order: string[];
}

function useLive(view: RaceView | null): LiveInfo {
  const [live, setLive] = useState<LiveInfo>({ countdown: 99, time: 0, order: [] });
  useEffect(() => {
    if (!view) return;
    const t = window.setInterval(() => {
      setLive({ countdown: view.countdown(), time: view.raceSeconds(), order: view.order() });
    }, 100);
    return () => window.clearInterval(t);
  }, [view]);
  return live;
}

/** 학생: 교사 화면이 보내는 스냅샷으로 레이스를 그립니다. */
export function usePlayerRace(ctl: PlayerController, race: RaceInfo, readInput: () => CarInput) {
  const stream = useMemo(() => new RaceStream(race, ctl.auth.pid, readInput),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [race.id, ctl]);
  useEffect(() => {
    const off = ctl.onSnap((s) => stream.onSnap(s));
    // 출발 전에 왕복 시간을 몇 번 재서 내 차 예측을 맞춥니다.
    let alive = true;
    void (async () => {
      const samples: number[] = [];
      for (let i = 0; i < 3 && alive; i++) samples.push(await ctl.ping());
      if (alive) stream.setRtt(Math.min(...samples));
    })();
    return () => { alive = false; off(); };
  }, [ctl, stream]);
  return { stream, live: useLive(stream) };
}

/** 교사: 직접 계산하는 레이스 */
export function useHostRace(host: HostController, race: RaceInfo | null) {
  const view = useMemo(() => (race && host.sim ? new LocalRace(race, host.sim) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [race?.id, host]);
  return { stream: view, live: useLive(view) };
}
