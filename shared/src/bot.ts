// 연습 모드와 테스트에서 쓰는 간단한 자동 운전.
import { CarInput, CarState, PHYS, angleDiff, clamp } from './physics';
import { Track, pointAt } from './track';

export interface BotProfile {
  /** 0.5(느긋) ~ 1(빠름) */
  skill: number;
  /** 선호하는 좌우 위치 */
  lane: number;
}

export function botInput(track: Track, c: CarState, bot: BotProfile): CarInput {
  const look = (7 + Math.abs(c.v) * 0.35) / track.spacing;
  const target = pointAt(track, c.prog + look, bot.lane);
  const want = Math.atan2(target.x - c.x, target.z - c.z);
  const d = angleDiff(want, c.h);
  const sharp = Math.abs(d);
  const limit = PHYS.maxSpeed * bot.skill * (sharp > 0.5 ? 0.6 : 1);
  return {
    steer: clamp(-d * 2.5, -1, 1),
    throttle: c.v < limit ? 1 : 0,
    brake: c.v > limit + 6 ? 1 : 0,
  };
}
