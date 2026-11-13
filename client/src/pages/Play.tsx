import { useEffect, useMemo, useRef, useState } from 'react';
import { checkNickname, getTrack, randomNickname, NICK_MAX, type RoomView } from '@racing/shared';
import { getSocket, loadSession, saveSession } from '../net/socket';
import { useRoom } from '../net/useRoom';
import { useRaceStream } from '../game/useRaceStream';
import { RaceScene } from '../game/RaceScene';
import { useControls } from '../game/useControls';
import { TouchControls } from '../game/TouchControls';
import { Countdown, Hud } from '../game/Hud';
import { looksOf, ResultList } from './Host';
import { navigate } from '../router';
import { Showroom } from '../game/Showroom';
import { flipCar, removeDrawing, uploadDrawing } from '../net/upload';

const KEY = 'racing.player';
interface Saved { code: string; playerId: string; token: string; name: string }

export function Play() {
  const { room, connected, setRoom } = useRoom();
  const [me, setMe] = useState<Saved | null>(null);
  const [notice, setNotice] = useState('');
  const socket = getSocket();

  useEffect(() => {
    document.title = '레이스 참가 · 드로잉 레이싱';
    const rejoin = () => {
      const saved = loadSession<Saved>(KEY);
      if (!saved) return;
      socket.emit('player:join', saved, (res) => {
        if (res.ok) setMe({ ...saved, name: res.name });
        else { saveSession(KEY, null); setMe(null); }
      });
    };
    rejoin();
    socket.on('connect', rejoin);
    const out = (msg: string) => { saveSession(KEY, null); setMe(null); setRoom(null); setNotice(msg); };
    const kicked = (reason: string) => out(reason);
    const closed = () => out('방이 닫혔어요. 수고했어요! 👋');
    socket.on('kicked', kicked);
    socket.on('closed', closed);
    return () => { socket.off('connect', rejoin); socket.off('kicked', kicked); socket.off('closed', closed); };
  }, [socket, setRoom]);

  const leave = () => {
    socket.emit('player:leave');
    saveSession(KEY, null);
    setMe(null);
    setRoom(null);
  };

  if (!me || !room) {
    return <JoinForm notice={notice} onJoined={(s) => { saveSession(KEY, s); setMe(s); setNotice(''); }} />;
  }
  const inRace = !!room.race && room.race.racers.includes(me.playerId) && (room.phase === 'countdown' || room.phase === 'racing');
  return (
    <>
      {!connected && <div className="banner">연결이 끊겼어요. 다시 연결하는 중…</div>}
      {inRace ? <PlayRace room={room} meId={me.playerId} /> : <PlayLobby room={room} me={me} onLeave={leave} />}
    </>
  );
}

function JoinForm({ onJoined, notice }: { onJoined: (s: Saved) => void; notice: string }) {
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('code')?.replace(/\D/g, '').slice(0, 4) ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const socket = getSocket();

  const join = () => {
    const bad = code.length !== 4 ? '방 코드 숫자 4개를 넣어 주세요.' : checkNickname(name);
    if (bad) return setError(bad);
    setBusy(true);
    setError('');
    socket.timeout(6000).emit('player:join', { code, name }, (err, res) => {
      setBusy(false);
      if (err) return setError('서버에 연결할 수 없어요. 다시 눌러 주세요.');
      if (!res.ok) return setError(res.error);
      onJoined({ code, playerId: res.playerId, token: res.token, name: res.name });
    });
  };

  return (
    <div className="page center">
      <div className="hero-emoji">🏁</div>
      <h1>레이스 참가하기</h1>
      {notice && <div className="card notice">{notice}</div>}
      <form className="card join-form" onSubmit={(e) => { e.preventDefault(); join(); }}>
        <label>
          <span className="label">방 코드</span>
          <input className="field" inputMode="numeric" pattern="[0-9]*" autoComplete="off" placeholder="숫자 4개"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </label>
        <label>
          <span className="label">별명</span>
          <div className="nick-row">
            <input className="field" autoComplete="off" maxLength={NICK_MAX} placeholder="예: 번개호랑이"
              value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="btn yellow dice" onClick={() => setName(randomNickname())} aria-label="별명 추천">🎲</button>
          </div>
          <small className="hint">진짜 이름 말고 재미있는 별명을 써요! 🎲를 누르면 골라 줘요.</small>
        </label>
        <div className="error">{error}</div>
        <button className="btn primary big-inline" disabled={busy}>들어가기!</button>
      </form>
      <button className="btn white small" onClick={() => navigate('/')}>← 처음으로</button>
    </div>
  );
}

function PlayLobby({ room, me, onLeave }: { room: RoomView; me: Saved; onLeave: () => void }) {
  const mine = room.players.find((p) => p.id === me.playerId);
  const myPlan = room.plan?.find((p) => !p.results && p.ids.includes(me.playerId));
  const myResult = room.lastResults?.find((r) => r.id === me.playerId);
  const final = room.finalResults?.find((r) => r.id === me.playerId);
  const racingNow = room.phase === 'countdown' || room.phase === 'racing';

  let status = '선생님이 시작할 때까지 기다려요. 큰 화면을 봐요! 👀';
  if (racingNow) status = `지금은 ${room.race?.label ?? '다른 조'}가 달리고 있어요. 큰 화면을 보며 응원해요! 📣`;
  else if (room.phase === 'podium') status = final ? `최종 ${final.place}등! 정말 잘했어요 🎉` : '시상식 중이에요! 큰 화면을 봐요 🏆';
  else if (room.phase === 'results' && myResult) status = `${myResult.place}등으로 들어왔어요! 👏`;
  else if (myPlan) status = `나는 "${myPlan.label}"에서 달려요. 곧 출발해요!`;
  else if (room.plan && room.phase === 'lobby') status = '이번에는 응원해요! 다음 대회에 달릴 수 있어요 📣';

  return (
    <div className="page center">
      <div className="card me-card" style={{ borderColor: mine?.color }}>
        <div className="me-name"><span className="dot" style={{ background: mine?.color }} />{mine?.name ?? me.name}</div>
        <div className="me-room">방 {room.code}</div>
      </div>
      <div className="card status-card">{status}</div>
      {mine && <MyCar room={room} me={me} />}
      {room.phase === 'results' && room.lastResults && myResult && (
        <div className="card result"><ResultList results={room.lastResults} meId={me.playerId} /></div>
      )}
      <div className="card tips">
        <b>조종하는 방법</b>
        <span>◀ ▶ 방향 바꾸기 · <b className="g">출발!</b> 꾹 누르면 달려요 · <b className="r">멈춤</b> 브레이크</span>
        <span>노란 화살표 ⚡를 밟으면 빨라져요!</span>
      </div>
      <button className="btn white small" onClick={() => navigate('/solo')}>🚗 기다리는 동안 혼자 연습</button>
      <button className="tiny-link as-btn" onClick={() => { if (window.confirm('방에서 나갈까요?')) onLeave(); }}>방 나가기</button>
    </div>
  );
}

function PlayRace({ room, meId }: { room: RoomView; meId: string }) {
  const race = room.race!;
  const controls = useControls();
  const { stream, live } = useRaceStream(race, meId, controls.read);
  const looks = useMemo(() => looksOf(room, race.racers), [room, race]);
  const track = useMemo(() => getTrack(race.trackId), [race.trackId]);
  const sent = useRef({ key: '', at: 0 });

  // 입력은 바뀔 때마다, 그리고 0.2초마다 한 번씩 서버로 보냅니다.
  useEffect(() => {
    const socket = getSocket();
    const t = window.setInterval(() => {
      const i = controls.read();
      const key = `${i.steer},${i.throttle},${i.brake}`;
      const now = performance.now();
      if (key !== sent.current.key || now - sent.current.at > 200) {
        sent.current = { key, at: now };
        socket.volatile.emit('in', [i.steer, i.throttle, i.brake]);
      }
    }, 33);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const place = Math.max(1, live.order.indexOf(meId) + 1);
  const done = !!stream?.finished;
  return (
    <div className="race-wrap">
      {stream && (
        <RaceScene
          track={track}
          looks={looks}
          getCars={stream.getCars}
          camera={{ mode: 'chase', followId: meId }}
          onFrame={(dt) => stream.frame(dt)}
        />
      )}
      <Hud info={{
        lap: stream?.lapOf(meId) ?? 1, laps: race.laps, place, total: race.racers.length,
        time: live.time, speed: stream?.speedRatio(meId) ?? 0, boost: (stream?.latest(meId)?.boost ?? 0) > 0,
      }} />
      {live.countdown <= 3 && live.countdown > -1 && <Countdown n={Math.max(0, live.countdown)} />}
      {!done && <TouchControls flags={controls.touch} />}
      {done && <div className="finish-flag">🏁 도착! {place}등</div>}
    </div>
  );
}

/** 내 차 카드: 그림 올리기, 변환 진행 상황, 앞뒤 바꾸기 */
function MyCar({ room, me }: { room: RoomView; me: Saved }) {
  const mine = room.players.find((p) => p.id === me.playerId)!;
  const car = mine.car;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const look = useMemo(() => looksOf(room, [me.playerId]), [room, me.playerId]);
  const hasDrawing = car.status !== 'none';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const pick = (file: File | undefined) => {
    if (file) void run(() => uploadDrawing(me, file));
    if (input.current) input.current.value = '';
  };

  let text = '종이에 그린 자동차를 사진으로 찍어 올려 보세요!';
  if (busy) text = '그림을 정리하고 있어요… ✂️';
  else if (car.hidden) text = '선생님이 이 그림을 잠시 가렸어요. 다른 그림을 올려 볼까요?';
  else if (car.status === 'processing') text = '3D 자동차로 변신하는 중! 기다리는 동안에도 그림 차로 달릴 수 있어요.';
  else if (car.status === 'ready') text = '3D 자동차 완성! ✨';
  else if (car.status === 'failed') text = car.message ?? '3D 변신은 못 했지만 그림 차로 달릴 수 있어요!';
  else if (car.status === 'drawing') text = '내 그림이 자동차가 됐어요! 이 차로 달려요 🎨';

  return (
    <div className="card mycar">
      <b className="mycar-title">🚗 내 자동차</b>
      <Showroom looks={look} labels={false} className="mycar-view" />
      <div className="mycar-text">{text}</div>
      {car.status === 'processing' && (
        <div className="progress"><div style={{ width: `${Math.round(car.progress * 100)}%` }} /></div>
      )}
      <div className="error">{error}</div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={() => input.current?.click()}>
          📷 {hasDrawing ? '다시 올리기' : '그림 올리기'}
        </button>
        {hasDrawing && !car.hidden && (
          <button className="btn white" disabled={busy} onClick={() => run(() => flipCar(me))}>↔ 앞뒤 바꾸기</button>
        )}
        {hasDrawing && (
          <button className="btn white small" disabled={busy} onClick={() => run(() => removeDrawing(me))}>기본 차로</button>
        )}
      </div>
      {!hasDrawing && (
        <ul className="draw-tips">
          <li>자동차를 <b>옆에서 본 모습</b>으로, 종이에 <b>크게</b> 그려요.</li>
          <li>진한 색으로 칠하고, 사진은 <b>그림이 화면에 꽉 차게</b> 찍어요.</li>
          <li>이름이나 얼굴은 그리지 않아요.</li>
        </ul>
      )}
    </div>
  );
}
