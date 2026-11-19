import { useEffect, useState } from 'react';

// 교사 화면(큰 화면) 효과음. 파일 없이 Web Audio 로 그 자리에서 만듭니다.
const KEY = 'racing.muted';
let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
const listeners = new Set<(m: boolean) => void>();

function audio(): AudioContext | null {
  if (muted || typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

/** 브라우저는 사용자가 한 번 누른 뒤에야 소리를 냅니다. 버튼을 누를 때 불러 주세요. */
export function unlockSound(): void {
  audio();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.12): void {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  /** 3·2·1 은 낮게, 출발(0)은 높고 길게 */
  countdown(n: number) {
    if (n > 0) tone(440, 0, 0.18);
    else { tone(880, 0, 0.45); tone(1320, 0, 0.45, 'triangle', 0.06); }
  },
  finish() {
    tone(988, 0, 0.12, 'triangle', 0.14);
    tone(1319, 0.1, 0.22, 'triangle', 0.14);
  },
  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.14, i === 3 ? 0.6 : 0.16, 'triangle', 0.14));
  },
};

export function setMuted(m: boolean): void {
  muted = m;
  try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* 무시 */ }
  if (!m) audio();
  listeners.forEach((fn) => fn(m));
}

export function useMuted(): [boolean, (m: boolean) => void] {
  const [m, set] = useState(muted);
  useEffect(() => {
    listeners.add(set);
    return () => { listeners.delete(set); };
  }, []);
  return [m, setMuted];
}

export function MuteButton() {
  const [m, set] = useMuted();
  return (
    <button className="btn small white" onClick={() => set(!m)} aria-label={m ? '소리 켜기' : '소리 끄기'}>
      {m ? '🔇 소리 꺼짐' : '🔊 소리 켜짐'}
    </button>
  );
}
