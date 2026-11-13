import { useEffect, useRef } from 'react';
import type { CarInput } from '@racing/shared';

export interface ControlFlags {
  left: boolean;
  right: boolean;
  gas: boolean;
  brake: boolean;
}

/** 키보드(방향키/WASD)와 터치 버튼 입력을 하나로 합칩니다. */
export function useControls() {
  const keys = useRef<ControlFlags>({ left: false, right: false, gas: false, brake: false });
  const touch = useRef<ControlFlags>({ left: false, right: false, gas: false, brake: false });

  useEffect(() => {
    const map: Record<string, keyof ControlFlags> = {
      ArrowLeft: 'left', a: 'left', A: 'left',
      ArrowRight: 'right', d: 'right', D: 'right',
      ArrowUp: 'gas', w: 'gas', W: 'gas', ' ': 'gas',
      ArrowDown: 'brake', s: 'brake', S: 'brake',
    };
    const set = (e: KeyboardEvent, v: boolean) => {
      const k = map[e.key];
      if (!k) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      keys.current[k] = v;
      e.preventDefault();
    };
    const down = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    const blur = () => {
      keys.current = { left: false, right: false, gas: false, brake: false };
      touch.current = { left: false, right: false, gas: false, brake: false };
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const read = (): CarInput => {
    const k = keys.current;
    const t = touch.current;
    const left = k.left || t.left;
    const right = k.right || t.right;
    return {
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      throttle: k.gas || t.gas ? 1 : 0,
      brake: k.brake || t.brake ? 1 : 0,
    };
  };

  return { touch, read };
}
