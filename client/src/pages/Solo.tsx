import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TRACK_LIST, getTrack, createCar, stepWorld, rankCars, currentLap, botInput, PHYS, NO_INPUT,
  type CarState, type BotProfile,
} from '@racing/shared';
import { RaceScene } from '../game/lazy';
import { useControls } from '../game/useControls';
import { TouchControls } from '../game/TouchControls';
import { Countdown, Hud, formatTime, type HudInfo } from '../game/Hud';
import { CAR_COLORS, type CarLook } from '../game/types';
import { navigate } from '../router';

const BOT_NAMES = ['번개', '구름', '별똥별'];
const STEP = 1 / 60;

type Phase = 'menu' | 'countdown' | 'race' | 'done';

export function Solo() {
  const [phase, setPhase] = useState<Phase>('menu');
  const [trackId, setTrackId] = useState('oval');
  const [laps, setLaps] = useState(3);
  const [count, setCount] = useState(3);
  const [hud, setHud] = useState<HudInfo>({ lap: 1, laps, place: 1, total: 4, time: 0, speed: 0, boost: false });
  const [results, setResults] = useState<{ name: string; time: number; me: boolean }[]>([]);
  const track = useMemo(() => getTrack(trackId), [trackId]);
  const controls = useControls();

  const sim = useRef({ cars: [] as CarState[], bots: [] as BotProfile[], time: 0, acc: 0, hudAt: 0, wait: 0 });
  const phaseRef = useRef<Phase>('menu');
  phaseRef.current = phase;

  const looks: CarLook[] = useMemo(
    () => [
      { id: 'me', name: '나', color: CAR_COLORS[0] },
      ...BOT_NAMES.map((n, i) => ({ id: 'bot' + i, name: n, color: CAR_COLORS[i + 2] })),
    ],
    [],
  );

  const start = () => {
    const ids = ['bot0', 'bot1', 'me', 'bot2'];
    sim.current = {
      cars: ids.map((id, slot) => createCar(track, id, slot)),
      bots: [0.72, 0.8, 0.88].map((skill, i) => ({ skill, lane: (i - 1) * 3 })),
      time: 0, acc: 0, hudAt: 0, wait: 3.2,
    };
    setCount(3);
    setPhase('countdown');
  };

  const onFrame = (dt: number) => {
    const s = sim.current;
    const p = phaseRef.current;
    if (p === 'menu') return;
    if (p === 'countdown') {
      s.wait -= dt;
      const n = Math.ceil(s.wait - 0.2);
      setCount((c) => (c !== n ? Math.max(0, n) : c));
      if (s.wait <= 0.2) setPhase('race');
      return;
    }
    s.acc += dt;
    while (s.acc >= STEP) {
      s.acc -= STEP;
      s.time += STEP;
      const input = controls.read();
      stepWorld(track, s.cars, (id) => {
        if (id === 'me') return p === 'race' ? input : NO_INPUT;
        const idx = Number(id.slice(3));
        return botInput(track, s.cars.find((c) => c.id === id)!, s.bots[idx]);
      }, STEP, { laps, time: s.time });
    }
    const me = s.cars.find((c) => c.id === 'me')!;
    if (s.time - s.hudAt > 0.1) {
      s.hudAt = s.time;
      const order = rankCars(s.cars);
      setHud({
        lap: currentLap(track, me, laps), laps, place: order.indexOf('me') + 1, total: s.cars.length,
        time: me.finished ? me.finishTime : s.time, speed: Math.abs(me.v) / PHYS.maxSpeed, boost: me.boost > 0,
      });
    }
    if (p === 'race' && me.finished) {
      const order = rankCars(s.cars);
      setResults(order.map((id) => {
        const c = s.cars.find((k) => k.id === id)!;
        return { name: looks.find((l) => l.id === id)!.name, time: c.finished ? c.finishTime : -1, me: id === 'me' };
      }));
      setPhase('done');
    }
  };

  useEffect(() => { document.title = '혼자 연습하기 · 드로잉 레이싱'; }, []);

  if (phase === 'menu') {
    return (
      <div className="page center">
        <h1>🚗 혼자 연습하기</h1>
        <p className="sub">코스를 고르고 출발! 방향키나 화면 버튼으로 조종해요.</p>
        <div className="track-pick">
          {TRACK_LIST.map((t) => (
            <button key={t.id} className={`card pick ${trackId === t.id ? 'on' : ''}`} onClick={() => setTrackId(t.id)}>
              <b>{t.name}</b>
              <span>{'⭐'.repeat(t.difficulty)}</span>
              <small>{t.description}</small>
            </button>
          ))}
        </div>
        <div className="row">
          <span className="label">바퀴 수</span>
          {[1, 2, 3, 5].map((n) => (
            <button key={n} className={`btn chip ${laps === n ? 'on' : ''}`} onClick={() => setLaps(n)}>{n}바퀴</button>
          ))}
        </div>
        <div className="row">
          <button className="btn white" onClick={() => navigate('/')}>← 처음으로</button>
          <button className="btn primary big-inline" onClick={start}>출발하기!</button>
        </div>
      </div>
    );
  }

  return (
    <div className="race-wrap">
      <RaceScene
        track={track}
        looks={looks}
        getCars={() => sim.current.cars}
        camera={{ mode: 'chase', followId: 'me' }}
        onFrame={onFrame}
      />
      <Hud info={hud} />
      {phase === 'countdown' && <Countdown n={count} />}
      {phase !== 'done' && <TouchControls flags={controls.touch} />}
      <button className="btn white quit" onClick={() => setPhase('menu')}>나가기</button>
      {phase === 'done' && (
        <div className="overlay">
          <div className="card result">
            <h2>🏁 도착!</h2>
            <ol className="rank-list">
              {results.map((r, i) => (
                <li key={i} className={r.me ? 'me' : ''}>
                  <span className="rank-no">{i + 1}</span>
                  <span className="rank-name">{r.name}</span>
                  <span className="rank-time">{r.time >= 0 ? formatTime(r.time) : '달리는 중'}</span>
                </li>
              ))}
            </ol>
            <div className="row">
              <button className="btn white" onClick={() => setPhase('menu')}>코스 고르기</button>
              <button className="btn primary" onClick={start}>한 번 더!</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
