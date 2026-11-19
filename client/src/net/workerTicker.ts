import type { Ticker } from '@racing/shared';

/**
 * Web Worker 안의 타이머로 박자를 맞춥니다.
 * 탭이 뒤로 가면 브라우저가 화면 쪽 setInterval 을 1초에 한 번까지 늦추는데,
 * 워커 타이머는 덜 늦춰져서 교사 화면이 가려져도 레이스가 계속 30Hz 로 돌아갑니다.
 * 워커를 못 만드는 환경이면 setInterval 로 돌아갑니다.
 */
export const workerTicker: Ticker = (fn, ms) => {
  try {
    const src = `let t=null;onmessage=(e)=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = () => fn();
    w.postMessage(ms);
    return () => {
      w.postMessage(0);
      w.terminate();
    };
  } catch {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }
};
