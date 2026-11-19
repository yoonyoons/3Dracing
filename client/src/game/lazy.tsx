import { lazy, Suspense, type ComponentProps } from 'react';

// 3D 화면(three.js, 약 220KB)은 실제로 보여 줄 때 불러옵니다.
// 첫 화면·입장 화면이 학교 와이파이에서도 빨리 뜨게 하려는 것입니다.
const RaceSceneLazy = lazy(() => import('./RaceScene').then((m) => ({ default: m.RaceScene })));
const ShowroomLazy = lazy(() => import('./Showroom').then((m) => ({ default: m.Showroom })));
const PodiumLazy = lazy(() => import('./Showroom').then((m) => ({ default: m.PodiumScene })));

type RaceProps = ComponentProps<typeof import('./RaceScene').RaceScene>;
type ShowProps = ComponentProps<typeof import('./Showroom').Showroom>;
type PodiumProps = ComponentProps<typeof import('./Showroom').PodiumScene>;

export function RaceScene(p: RaceProps) {
  return <Suspense fallback={<div className="race-canvas loading3d">🏎️ 준비 중…</div>}><RaceSceneLazy {...p} /></Suspense>;
}
export function Showroom(p: ShowProps) {
  return <Suspense fallback={<div className={`${p.className ?? 'showroom'} loading3d`}>🚗</div>}><ShowroomLazy {...p} /></Suspense>;
}
export function PodiumScene(p: PodiumProps) {
  return <Suspense fallback={<div className="podium-canvas loading3d">🏆</div>}><PodiumLazy {...p} /></Suspense>;
}
