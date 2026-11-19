import { PHYS, rankCars, type RaceInfo, type RaceSim } from '@racing/shared';
import type { RenderCar } from '../game/types';
import type { RaceView } from './RaceStream';

/** 교사 화면: 직접 계산하는 레이스를 그대로 보여 줍니다(네트워크 지연 없음). */
export class LocalRace implements RaceView {
  finished = false;
  constructor(readonly race: RaceInfo, private sim: RaceSim) {}

  getCars = (): RenderCar[] => this.sim.renderCars();
  order(): string[] {
    return rankCars(this.sim.cars);
  }
  getLeaderId = (): string | undefined => this.order()[0];
  countdown(): number {
    return Math.ceil((this.sim.startAt - this.sim.clock()) / 1000);
  }
  raceSeconds(): number {
    return this.sim.time;
  }
  latest(id: string) {
    const c = this.sim.cars.find((k) => k.id === id);
    return c ? { prog: c.prog, v: c.v, boost: c.boost, finished: c.finished } : null;
  }
  lapOf(id: string): number {
    const c = this.latest(id);
    if (!c) return 1;
    return Math.max(1, Math.min(this.race.laps, Math.floor(c.prog / this.sim.track.n) + 1));
  }
  speedRatio(id: string): number {
    const c = this.latest(id);
    return c ? Math.abs(c.v) / PHYS.maxSpeed : 0;
  }
  frame(): void {}
}
