import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNickname, hasBannedWord, randomNickname, NICK_MAX } from '../src/index';

test('나쁜 별명은 막는다 (변형 표기 포함)', () => {
  const bad = [
    '시1발', 'ㅅㅂ', 'ㅆ ㅂ', '씨빨', '시팔놈', 'ㅄ', '병1신', 'ㅁㅊ', '개.새', 'ㅗㅗ', '존나빠름', '느개비',
    'tlqkf', 'QUDTLS', 'F.u.c.k', 'f4ck', 'sh1t', 'b!tch', 'sex', 'dick', 'kill', 'ass', 'wtf', '18', '18놈', '번개18새', 'ㅅ1ㅂ',
  ];
  for (const n of bad) assert.ok(hasBannedWord(n), `막아야 함: ${n}`);
});

test('정상 별명은 막지 않는다', () => {
  const good = [
    '번개호랑이', '시바견', '보라돌이', '시원한바람', 'skill', 'glass', 'class', 'diet', 'kiwi', 'rocket7', '고양이123',
    '빠른토끼', '하늘색', '구름빵', '강아지', '수박바', 'sussex', 'dice', 'ssam', '레이서', '번개18', '선수18', '번개180', '2018', '거북이',
  ];
  for (const n of good) assert.equal(hasBannedWord(n), false, `통과해야 함: ${n}`);
});

test('닉네임 검사: 길이·문자', () => {
  assert.equal(checkNickname('번개호랑이'), null);
  assert.equal(checkNickname('  rocket 7 '), null);
  assert.ok(checkNickname(''));
  assert.ok(checkNickname('아주아주아주긴별명이에요'));
  assert.ok(checkNickname('<b>hi</b>'));
});

test('추천 별명 1000개는 모두 통과', () => {
  for (let i = 0; i < 1000; i++) {
    const n = randomNickname();
    assert.equal(checkNickname(n), null, n);
    assert.ok([...n].length <= NICK_MAX);
  }
});
