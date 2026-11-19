import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';

export const DPR_MIN = 0.5;

/** 처음 해상도: 화면 배율과 상한 중 작은 값 */
export function initialDpr(max = 1.5): number {
  return Math.min(max, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
}

/**
 * 화면이 버벅이면 그리는 해상도를 조금씩 낮추고, 여유가 생기면 다시 올립니다.
 * 저사양 크롬북에서도 30fps 이상을 지키기 위한 장치입니다.
 * 바뀐 값은 onChange 로 알려 주고, 부모가 <Canvas dpr={...}> 로 넘깁니다
 * (Canvas 가 다시 그려질 때 원래 값으로 되돌아가지 않게).
 */
export function AdaptiveDpr({ dpr, onChange, max = 1.5 }: { dpr: number; onChange: (d: number) => void; max?: number }) {
  const acc = useRef({ frames: 0, time: 0, warm: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    // 처음 1.5초(모델 불러오기 등)는 재지 않습니다.
    if (a.warm < 1.5) { a.warm += dt; return; }
    a.frames++;
    a.time += Math.min(dt, 0.25);
    if (a.time < 1.5) return;
    const fps = a.frames / a.time;
    a.frames = 0;
    a.time = 0;
    let next = dpr;
    if (fps < 45 && next > DPR_MIN) next = Math.max(DPR_MIN, next * 0.8);
    else if (fps > 57 && next < max) next = Math.min(max, next * 1.1);
    if (Math.abs(next - dpr) > 0.01) onChange(Math.round(next * 100) / 100);
  });
  return null;
}
