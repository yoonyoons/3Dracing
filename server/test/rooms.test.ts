import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoomView, Snap } from '@racing/shared';
import { Room } from '../src/rooms';
import { RaceSim } from '../src/race';

function makeRoom() {
  const log = { views: [] as RoomView[], snaps: [] as Snap[] };
  const room = new Room('1234', { room: (_c, v) => log.views.push(v), snap: (_c, s) => log.snaps.push(s), closed: () => {} });
  return { room, log };
}

test('입장: 금칙어 거부, 같은 별명은 번호를 붙임, 재접속', () => {
  const { room } = makeRoom();
  assert.equal(typeof room.join('씨발', 's0'), 'string');
  const a = room.join('번개', 's1');
  const b = room.join('번개', 's2');
  assert.ok(typeof a !== 'string' && typeof b !== 'string');
  assert.equal(a.name, '번개');
  assert.equal(b.name, '번개2');
  room.disconnect(a.id, 's1');
  assert.equal(room.players.get(a.id)!.connected, false);
  const again = room.join('아무거나', 's3', { playerId: a.id, token: a.token });
  assert.ok(typeof again !== 'string' && again.id === a.id && again.connected);
  assert.equal(room.players.size, 2);
});

test('조 편성: 23명 / 8명씩 → 예선 3조, 끝나면 결승 8명 이하', () => {
  const { room } = makeRoom();
  const ids: string[] = [];
  for (let i = 0; i < 23; i++) {
    const p = room.join('선수' + i, 's' + i);
    assert.ok(typeof p !== 'string');
    ids.push(p.id);
  }
  room.makePlan();
  assert.equal(room.plan!.length, 3);
  assert.deepEqual(room.plan!.map((p) => p.ids.length).sort(), [7, 8, 8]);
  assert.equal(new Set(room.plan!.flatMap((p) => p.ids)).size, 23);
  for (let h = 0; h < 3; h++) {
    // 레이스를 실제로 돌리는 대신 결과를 직접 넣습니다.
    room.plan![h].results = room.plan![h].ids.map((id, i) => ({ id, name: id, place: i + 1, time: i < 6 ? 30 + i + h * 0.1 : null }));
    room.phase = 'results';
    room.next();
    assert.equal(room.phase, 'lobby');
  }
  const final = room.plan![3];
  assert.ok(final.isFinal);
  assert.equal(final.ids.length, 8);
  assert.equal(new Set(final.ids).size, 8);
  // 각 조 1·2등은 반드시 결승에
  for (let h = 0; h < 3; h++) for (let i = 0; i < 2; i++) assert.ok(final.ids.includes(room.plan![h].ids[i]));
});

test('인원이 한 조에 다 들어가면 바로 결승', () => {
  const { room } = makeRoom();
  for (let i = 0; i < 5; i++) room.join('선수' + i, 's' + i);
  room.makePlan();
  assert.equal(room.plan!.length, 1);
  assert.ok(room.plan![0].isFinal);
});

test('RaceSim: 카운트다운 동안은 멈춰 있고, 모두 완주하면 끝난다', () => {
  let now = 0;
  const race = new RaceSim('oval', 1, ['a', 'b'], now);
  const x0 = race.cars[0].x;
  race.setInput('a', 0, 1, 0);
  now = 2000;
  assert.equal(race.advance(now), false);
  assert.equal(race.cars[0].x, x0);
  assert.equal(race.started, false);
  // 출발 후: a 는 계속 가속(벽을 타고 감), b 는 접속 끊김
  race.setActive('b', false);
  let ended = false;
  for (let i = 0; i < 30 * 120 && !ended; i++) {
    now += 1000 / 30;
    ended = race.advance(now);
  }
  assert.ok(ended, '레이스가 끝나야 함');
  const res = race.results((id) => id);
  assert.equal(res[0].id, 'a');
  assert.ok(res[0].time! > 5);
  assert.equal(res[1].time, null);
  const snap = race.snapshot(now);
  assert.equal(snap.c.length, 2);
  assert.equal(snap.c[0].length, 7);
});
