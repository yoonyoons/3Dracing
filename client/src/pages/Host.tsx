import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { LIMITS, TRACK_LIST, getTrack, type RaceResult, type RoomView } from '@racing/shared';
import { getSocket, loadSession, saveSession } from '../net/socket';
import { useRoom } from '../net/useRoom';
import { useRaceStream } from '../game/useRaceStream';
import { RaceScene } from '../game/RaceScene';
import { Countdown, formatTime } from '../game/Hud';
import type { CameraMode, CarLook } from '../game/types';
import { navigate } from '../router';
import { PodiumScene, Showroom } from '../game/Showroom';

const KEY = 'racing.host';

export function looksOf(room: RoomView, ids?: string[]): CarLook[] {
  return room.players
    .filter((p) => !ids || ids.includes(p.id))
    .map((p) => ({
      id: p.id, name: p.name, color: p.color,
      imageUrl: p.car.hidden ? null : p.car.imageUrl,
      glbUrl: p.car.hidden ? null : p.car.glbUrl,
      flip: p.car.flip,
    }));
}

export function ResultList({ results, meId, limit }: { results: RaceResult[]; meId?: string; limit?: number }) {
  return (
    <ol className="rank-list">
      {results.slice(0, limit ?? results.length).map((r) => (
        <li key={r.id} className={r.id === meId ? 'me' : ''}>
          <span className="rank-no">{r.place}</span>
          <span className="rank-name">{r.name}</span>
          <span className="rank-time">{r.time !== null ? formatTime(r.time) : '완주 못 함'}</span>
        </li>
      ))}
    </ol>
  );
}

function useJoinUrl(code: string | undefined): { url: string; qr: string } {
  const [base, setBase] = useState(window.location.origin);
  const [qr, setQr] = useState('');
  useEffect(() => {
    // 교사 PC에서 localhost 로 열었다면, 학생은 같은 와이파이의 IP 주소로 들어와야 합니다.
    fetch('/api/info')
      .then((r) => r.json())
      .then((info: { publicUrl: string | null; lan: string[] }) => {
        if (info.publicUrl) setBase(info.publicUrl);
        else if (['localhost', '127.0.0.1'].includes(window.location.hostname) && info.lan[0]) {
          setBase(info.lan[0].replace(/:\d+$/, window.location.port ? `:${window.location.port}` : ''));
        }
      })
      .catch(() => {});
  }, []);
  const url = code ? `${base}/play?code=${code}` : '';
  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#22223b', light: '#ffffff' } }).then(setQr).catch(() => setQr(''));
  }, [url]);
  return { url, qr };
}

export function Host() {
  const { room, connected, setRoom } = useRoom();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [teacherCode, setTeacherCode] = useState('');
  const socket = getSocket();

  useEffect(() => {
    fetch('/api/info').then((r) => r.json()).then((i) => setNeedCode(!!i.needsTeacherCode)).catch(() => {});
  }, []);

  useEffect(() => {
    document.title = '선생님 화면 · 드로잉 레이싱';
    const resume = () => {
      const saved = loadSession<{ code: string; hostToken: string }>(KEY);
      if (!saved) return;
      socket.emit('host:resume', saved, (res) => {
        if (!res.ok) saveSession(KEY, null);
      });
    };
    resume();
    socket.on('connect', resume);
    const closed = () => { saveSession(KEY, null); setRoom(null); };
    socket.on('closed', closed);
    return () => { socket.off('connect', resume); socket.off('closed', closed); };
  }, [socket, setRoom]);

  const create = () => {
    setBusy(true);
    setError('');
    socket.timeout(5000).emit('host:create', { teacherCode }, (err, res) => {
      setBusy(false);
      if (err) return setError('서버에 연결할 수 없어요. 잠시 후 다시 눌러 주세요.');
      if (!res.ok) return setError(res.error);
      saveSession(KEY, { code: res.code, hostToken: res.hostToken });
    });
  };

  if (!room) {
    return (
      <div className="page center">
        <div className="hero-emoji">👩‍🏫</div>
        <h1>선생님 화면</h1>
        <p className="sub">방을 만들고 이 화면을 프로젝터에 띄워 주세요.</p>
        {needCode && (
          <input className="field narrow" type="password" autoComplete="off" placeholder="교사 코드"
            value={teacherCode} onChange={(e) => setTeacherCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
        )}
        <button className="btn primary big-inline" onClick={create} disabled={busy}>방 만들기</button>
        <div className="error">{error}</div>
        <button className="btn white small" onClick={() => navigate('/')}>← 처음으로</button>
      </div>
    );
  }

  return (
    <>
      {!connected && <div className="banner">연결이 끊겼어요. 다시 연결하는 중…</div>}
      {(room.phase === 'lobby') && <HostLobby room={room} />}
      {(room.phase === 'countdown' || room.phase === 'racing' || room.phase === 'results') && <HostRace room={room} />}
      {room.phase === 'podium' && <HostPodium room={room} />}
    </>
  );
}

function HostLobby({ room }: { room: RoomView }) {
  const socket = getSocket();
  const { url, qr } = useJoinUrl(room.code);
  const online = room.players.filter((p) => p.connected).length;
  const next = room.plan?.[room.planIndex];
  const started = !!room.plan?.some((p) => p.results);
  const nameOf = (id: string) => room.players.find((p) => p.id === id)?.name ?? '(나감)';
  const needHeats = online > room.settings.heatSize;

  // 부적절한 그림은 대기실에서 바로 가릴 수 있습니다(학생 화면과 레이스에서 기본 차로 보임).
  const hide = (playerId: string, hidden: boolean) => {
    const saved = loadSession<{ hostToken: string }>(KEY);
    void fetch(`/api/rooms/${room.code}/hide/${playerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-token': saved?.hostToken ?? '' },
      body: JSON.stringify({ hidden }),
    });
  };

  const close = () => {
    if (window.confirm('방을 닫을까요?\n학생들이 모두 나가고, 이 방의 그림과 3D 모델이 삭제됩니다.')) {
      socket.emit('host:close');
      saveSession(KEY, null);
    }
  };

  return (
    <div className="host-lobby">
      <aside className="host-join card">
        <div className="join-label">방 코드</div>
        <div className="join-code">{room.code}</div>
        {qr && <img className="join-qr" src={qr} alt="입장 QR 코드" />}
        <div className="join-url">{url.replace(/^https?:\/\//, '')}</div>
        <p className="join-help">QR을 찍거나, 주소로 들어가서 방 코드를 넣어요.</p>
      </aside>

      <main className="host-main">
        <div className="host-head">
          <h2>참가자 {online}명 <small>/ 최대 {room.maxPlayers}명</small></h2>
          <div className="row">
            <button className="btn small white" onClick={() => navigate('/admin')}>관리자</button>
            <button className="btn small danger" onClick={close}>방 닫기</button>
          </div>
        </div>

        {room.players.length > 0 && <Showroom looks={looksOf(room)} />}

        <div className="player-grid">
          {room.players.length === 0 && <div className="empty">학생들이 들어오면 여기에 나타나요 🙌</div>}
          {room.players.map((p) => (
            <div key={p.id} className={`player-chip ${p.connected ? '' : 'off'}`} style={{ borderColor: p.color }}>
              <span className="dot" style={{ background: p.color }} />
              <span className="player-name">{p.name}</span>
              <span className="player-car" title="차 상태">
                {p.car.hidden ? '🙈' : p.car.status === 'ready' ? '✨' : p.car.status === 'processing' ? '⏳' : p.car.status !== 'none' ? '🎨' : '🚗'}
              </span>
              {p.car.status !== 'none' && (
                <button className="kick" title={p.car.hidden ? '그림 다시 보이기' : '그림 숨기기'} onClick={() => hide(p.id, !p.car.hidden)}>
                  {p.car.hidden ? '👁' : '🙈'}
                </button>
              )}
              <button className="kick" title="내보내기" onClick={() => socket.emit('host:kick', p.id)}>✕</button>
            </div>
          ))}
        </div>

        {room.plan && (
          <div className="plan">
            {room.plan.map((pl, i) => (
              <div key={i} className={`card plan-card ${i === room.planIndex ? 'now' : ''} ${pl.results ? 'done' : ''}`}>
                <b>{pl.label} {pl.results ? '✅' : i === room.planIndex ? '👈 다음' : ''}</b>
                <span>{pl.ids.map(nameOf).join(', ')}</span>
              </div>
            ))}
          </div>
        )}

        <div className="card settings">
          <div className="row left">
            <span className="label">코스</span>
            {TRACK_LIST.map((t) => (
              <button key={t.id} className={`btn chip ${room.settings.trackId === t.id ? 'on' : ''}`}
                onClick={() => socket.emit('host:settings', { trackId: t.id })}>
                {t.name} {'⭐'.repeat(t.difficulty)}
              </button>
            ))}
          </div>
          <div className="row left">
            <span className="label">바퀴 수</span>
            {[1, 2, 3, 5].map((n) => (
              <button key={n} className={`btn chip ${room.settings.laps === n ? 'on' : ''}`}
                onClick={() => socket.emit('host:settings', { laps: n })}>{n}</button>
            ))}
            <span className="label gap">한 번에 달리는 인원</span>
            {[4, 6, 8, 10].map((n) => (
              <button key={n} className={`btn chip ${room.settings.heatSize === n ? 'on' : ''}`} disabled={started}
                onClick={() => socket.emit('host:settings', { heatSize: n })}>{n}명</button>
            ))}
          </div>
        </div>

        <div className="row">
          {!room.plan && needHeats && (
            <button className="btn yellow big-inline" onClick={() => socket.emit('host:plan')}>
              🎲 조 편성하기 ({Math.ceil(online / room.settings.heatSize)}개 조)
            </button>
          )}
          {room.plan && !started && (
            <button className="btn white" onClick={() => socket.emit('host:plan')}>🎲 다시 섞기</button>
          )}
          {(room.plan || !needHeats) && (
            <button className="btn primary big-inline" disabled={online === 0 || (!!next && next.ids.length === 0)}
              onClick={() => socket.emit('host:start')}>
              🏁 {next ? `${next.label} 출발!` : '레이스 시작!'}
            </button>
          )}
          {started && <button className="btn white" onClick={() => socket.emit('host:reset')}>처음부터 다시</button>}
        </div>
      </main>
    </div>
  );
}

function HostRace({ room }: { room: RoomView }) {
  const socket = getSocket();
  const race = room.race;
  const { stream, live } = useRaceStream(race, null);
  const [cam, setCam] = useState<CameraMode['mode']>('follow');
  const looks = useMemo(() => looksOf(room, race?.racers), [room, race]);
  const track = useMemo(() => getTrack(race?.trackId ?? room.settings.trackId), [race, room.settings.trackId]);
  const nameOf = (id: string) => room.players.find((p) => p.id === id);
  const plan = room.plan?.[room.planIndex];
  const hasMore = !!room.plan && !plan?.isFinal;

  return (
    <div className="race-wrap">
      {stream && (
        <RaceScene
          track={track}
          looks={looks}
          getCars={stream.getCars}
          getLeaderId={stream.getLeaderId}
          camera={cam === 'overview' ? { mode: 'overview' } : { mode: 'follow' }}
        />
      )}
      <div className="host-race-top">
        <div className="hud-chip strong">{race?.label ?? ''}</div>
        <div className="hud-chip">⏱ {formatTime(live.time)}</div>
        <div className="hud-chip">🏁 {race?.laps}바퀴</div>
        <span className="spacer" />
        <button className="btn small white" onClick={() => setCam(cam === 'follow' ? 'overview' : 'follow')}>
          📷 {cam === 'follow' ? '전체 보기' : '1등 따라가기'}
        </button>
        {room.phase !== 'results' && (
          <button className="btn small danger" onClick={() => socket.emit('host:stop')}>레이스 끝내기</button>
        )}
      </div>
      <ol className="leaderboard">
        {live.order.map((id, i) => {
          const p = nameOf(id);
          return (
            <li key={id}>
              <span className="rank-no" style={{ background: p?.color }}>{i + 1}</span>
              <span className="rank-name">{p?.name ?? '?'}</span>
              <span className="lap">{stream?.latest(id)?.finished ? '🏁' : `${stream?.lapOf(id) ?? 1}/${race?.laps}`}</span>
            </li>
          );
        })}
      </ol>
      {room.phase === 'countdown' && live.countdown <= 3 && <Countdown n={live.countdown} />}
      {room.phase === 'results' && room.lastResults && (
        <div className="overlay">
          <div className="card result wide">
            <h2>🏁 {plan?.label} 결과</h2>
            <ResultList results={room.lastResults} />
            <button className="btn primary big-inline" onClick={() => socket.emit('host:next')}>
              {hasMore ? '다음으로 ▶' : '🏆 시상대 보기'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function HostPodium({ room }: { room: RoomView }) {
  const socket = getSocket();
  const results = room.finalResults ?? [];
  const medal = ['🥇', '🥈', '🥉'];
  const all = looksOf(room);
  const top = results.slice(0, 3).map((r) => all.find((l) => l.id === r.id)).filter((l): l is CarLook => !!l);
  return (
    <div className="page center podium-page">
      <div className="confetti" aria-hidden>
        {Array.from({ length: 36 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 9) * 0.35}s`, background: ['#ff5a5f', '#ffd23f', '#2ec4b6', '#3a86ff', '#8338ec'][i % 5] }} />)}
      </div>
      <h1>🏆 시상대</h1>
      {top.length > 0 && <PodiumScene looks={top} />}
      <div className="podium-simple">
        {[1, 0, 2].filter((i) => results[i]).map((i) => (
          <div key={results[i].id} className={`card podium-card p${i + 1}`}>
            <div className="medal">{medal[i]}</div>
            <b>{results[i].name}</b>
            <span>{results[i].time !== null ? formatTime(results[i].time!) : ''}</span>
          </div>
        ))}
      </div>
      {results.length > 3 && (
        <div className="card result"><ResultList results={results.slice(3)} /></div>
      )}
      <div className="row">
        <button className="btn primary big-inline" onClick={() => socket.emit('host:reset')}>새 레이스 준비</button>
      </div>
    </div>
  );
}
