export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

export interface HudInfo {
  lap: number;
  laps: number;
  place: number;
  total: number;
  time: number;
  speed: number;
  boost: boolean;
}

export function Hud({ info }: { info: HudInfo }) {
  return (
    <div className="hud">
      <div className="hud-chip">🏁 {info.lap} / {info.laps} 바퀴</div>
      <div className="hud-chip strong">{info.place}등 <small>/ {info.total}</small></div>
      <div className="hud-chip">⏱ {formatTime(info.time)}</div>
      <div className={`hud-speed ${info.boost ? 'boost' : ''}`}>
        <div className="hud-speed-bar" style={{ width: `${Math.min(100, Math.round(info.speed * 100))}%` }} />
        <span>{info.boost ? '🔥 부스트!' : '속도'}</span>
      </div>
    </div>
  );
}

export function Countdown({ n }: { n: number }) {
  return <div className="countdown" key={n}>{n > 0 ? n : '출발!'}</div>;
}
