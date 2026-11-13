import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNickname, randomNickname, NICK_MAX } from '../src/index';

test('닉네임 검사', () => {
  assert.equal(checkNickname('번개호랑이'), null);
  assert.equal(checkNickname('  rocket 7 '), null);
  assert.ok(checkNickname(''));
  assert.ok(checkNickname('아주아주아주긴별명이에요'));
  assert.ok(checkNickname('시1발'));
  assert.ok(checkNickname('F.u.c.k'));
  assert.ok(checkNickname('<b>hi</b>'));
  for (let i = 0; i < 200; i++) {
    const n = randomNickname();
    assert.equal(checkNickname(n), null, n);
    assert.ok([...n].length <= NICK_MAX);
  }
});
