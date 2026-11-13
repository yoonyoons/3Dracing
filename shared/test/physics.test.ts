import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACK_DEFS, getTrack, minTurnRadius, createCar, stepWorld, botInput, rankCars, PHYS, locate,
} from '../src/index';

for (const def of TRACK_DEFS) {
  test(`트랙 ${def.id}: 커브가 길 폭보다 완만하다`, () => {
    const t = getTrack(def.id);
    const r = minTurnRadius(t);
    assert.ok(r > t.halfWidth + 3, `min radius ${r.toFixed(1)} <= ${t.halfWidth + 3}`);
    assert.ok(t.n > 100);
  });

  test(`트랙 ${def.id}: 봇 6대가 2바퀴를 완주한다`, () => {
    const t = getTrack(def.id);
    const cars = Array.from({ length: 6 }, (_, i) => createCar(t, 'c' + i, i));
    const bots = cars.map((_, i) => ({ skill: 0.75 + i * 0.05, lane: (i % 3 - 1) * 3 }));
    const dt = 1 / PHYS.tickRate;
    let time = 0;
    while (time < 180 && !cars.every((c) => c.finished)) {
      time += dt;
      stepWorld(t, cars, (id) => botInput(t, cars.find((c) => c.id === id)!, bots[Number(id.slice(1))]), dt, { laps: 2, time });
      for (const c of cars) {
        const loc = locate(t, c.x, c.z, c.idx);
        assert.ok(Math.abs(loc.lateral) <= t.halfWidth + 0.01, '차가 길 밖으로 나감');
      }
    }
    assert.ok(cars.every((c) => c.finished), `완주 실패 (t=${time.toFixed(0)})`);
    const order = rankCars(cars);
    assert.equal(order.length, 6);
    console.log(`  ${def.id}: 길이 ${t.length.toFixed(0)}, 최소반경 ${minTurnRadius(t).toFixed(1)}, 1위 ${cars.find((c) => c.id === order[0])!.finishTime.toFixed(1)}초`);
  });
}

test('벽으로 돌진해도 길 안에 머문다', () => {
  const t = getTrack('oval');
  const c = createCar(t, 'a', 0);
  c.h += 1.2;
  for (let i = 0; i < 300; i++) stepWorld(t, [c], () => ({ steer: 0, throttle: 1, brake: 0 }), 1 / 30, { laps: 3, time: i / 30 });
  const loc = locate(t, c.x, c.z, c.idx);
  assert.ok(Math.abs(loc.lateral) <= t.halfWidth);
  assert.ok(c.prog > 5, '벽을 따라 앞으로 나아가야 함');
});
