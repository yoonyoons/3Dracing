import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, RaceSim, randomHex, type RoomView, type Snap } from '../src/index';

function makeRoom() {
  const log = { views: [] as RoomView[], snaps: [] as Snap[] };
  const room = new Room('1234', { room: (v) => log.views.push(v), snap: (s) => log.snaps.push(s) });
  return { room, log };
}

const P = () => [randomHex(6), randomHex(16)] as const;

test('입장: 금칙어 거부, 같은 별명은 번호를 붙임, 재접속, 끊김 표시', () => {
  const { room, log } = makeRoom();
  assert.equal(typeof room.join('씨발', ...P()), 'string');
  const [pa, ca] = P();
  const a = room.join('번개', pa, ca);
  const b = room.join('번개', ...P());
  assert.ok(typeof a !== 'string' && typeof b !== 'string');
  assert.equal(a.name, '번개');
  assert.equal(b.name, '번개2');
  room.checkOffline(Date.now() + 60_000);
  assert.equal(room.players.get(a.id)!.connected, false);
  assert.equal(typeof room.join('번개', pa, randomHex(16)), 'string', '비밀 값이 다르면 거부');
  const again = room.join('아무거나', pa, ca);
  assert.ok(typeof again !== 'string' && again.id === a.id && again.connected);
  assert.equal(room.players.size, 2);
  // 방 상태에는 비밀 값이 들어가지 않습니다.
  assert.ok(!JSON.stringify(log.views.at(-1)).includes(ca));
});

test('조 편성: 23명 / 8명씩 → 예선 3조, 끝나면 결승 8명 이하', () => {
  const { room } = makeRoom();
  const ids: string[] = [];
  for (let i = 0; i < 23; i++) {
    const p = room.join('선수' + i, ...P());
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
  for (let i = 0; i < 5; i++) room.join('선수' + i, ...P());
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

test('RaceSim: 묶어 보낸 입력을 간격대로 적용하고, 짧은 탭도 사라지지 않는다', () => {
  let now = 0;
  const race = new RaceSim('oval', 1, ['a'], now);
  now = 5000; race.advance(now);
  race.queueInputs('a', [[0, 0, 1, 0]], now);
  for (let i = 0; i < 60; i++) { now += 1000 / 30; race.advance(now); }
  const h0 = race.cars[0].h;
  // 100ms 동안만 오른쪽으로 꺾었다 놓기
  race.queueInputs('a', [[0, 1, 1, 0], [100, 0, 1, 0]], now);
  for (let i = 0; i < 30; i++) { now += 1000 / 30; race.advance(now); }
  assert.ok(race.cars[0].h < h0 - 0.05, '짧은 탭으로도 방향이 바뀌어야 함');
  const r = race.renderCars(now + 10);
  assert.equal(r.length, 1);
  assert.ok(Number.isFinite(r[0].x));
});

test('저장한 방을 다시 불러오면 학생·조 편성이 이어진다', () => {
  const { room } = makeRoom();
  for (let i = 0; i < 12; i++) room.join('선수' + i, ...P());
  room.setSettings({ heatSize: 6, laps: 2, trackId: 'eight' });
  room.makePlan();
  const saved = JSON.parse(JSON.stringify(room.save()));
  const { room: r2 } = makeRoom();
  r2.restore(saved);
  assert.equal(r2.players.size, 12);
  assert.equal(r2.plan!.length, 2);
  assert.equal(r2.settings.trackId, 'eight');
  assert.ok([...r2.players.values()].every((p) => !p.connected));
});
