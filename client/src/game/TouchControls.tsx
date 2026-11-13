import type { MutableRefObject, PointerEvent } from 'react';
import type { ControlFlags } from './useControls';

function Btn({ flag, flags, className, children, label }: {
  flag: keyof ControlFlags;
  flags: MutableRefObject<ControlFlags>;
  className: string;
  children: React.ReactNode;
  label: string;
}) {
  const set = (v: boolean) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    flags.current[flag] = v;
    const el = e.currentTarget;
    if (v) {
      el.classList.add('pressed');
      try { el.setPointerCapture(e.pointerId); } catch { /* 일부 브라우저는 무시 */ }
    } else {
      el.classList.remove('pressed');
    }
  };
  return (
    <button
      type="button"
      aria-label={label}
      className={`pad-btn ${className}`}
      onPointerDown={set(true)}
      onPointerUp={set(false)}
      onPointerCancel={set(false)}
      onLostPointerCapture={set(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

/** 화면 아래쪽 큰 터치 버튼: 왼쪽 손은 방향, 오른쪽 손은 가속/브레이크 */
export function TouchControls({ flags }: { flags: MutableRefObject<ControlFlags> }) {
  return (
    <div className="pad">
      <div className="pad-group">
        <Btn flag="left" flags={flags} className="pad-steer" label="왼쪽">◀</Btn>
        <Btn flag="right" flags={flags} className="pad-steer" label="오른쪽">▶</Btn>
      </div>
      <div className="pad-group">
        <Btn flag="brake" flags={flags} className="pad-brake" label="브레이크">멈춤</Btn>
        <Btn flag="gas" flags={flags} className="pad-gas" label="가속">출발!</Btn>
      </div>
    </div>
  );
}
