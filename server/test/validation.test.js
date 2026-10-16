import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidName, isValidTimestamp, isValidBody, validateSendRequest, parseNonNegativeInt } from '../src/validation.js';

const ok = {
  id: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  from: 'Alice',
  to: 'Bob',
  body: 'hi',
  createdAt: '2026-10-15T13:04:05.120Z',
};

test('names follow the name rule (case-sensitive, no trimming on the wire)', () => {
  for (const n of ['Alice', 'a', 'A_b-9', 'x'.repeat(32)]) assert.equal(isValidName(n), true, n);
  for (const n of ['', ' Alice', 'Al ice', 'x'.repeat(33), 'Bób', null, 42]) assert.equal(isValidName(n), false, String(n));
});

test('timestamps need exact format and a real instant', () => {
  assert.equal(isValidTimestamp('2026-10-15T13:04:05.120Z'), true);
  for (const t of ['2026-10-15T13:04:05Z', '2026-10-15T13:04:05.12Z', '2026-02-30T00:00:00.000Z', '2026-10-15 13:04:05.120Z']) {
    assert.equal(isValidTimestamp(t), false, t);
  }
});

test('body: non-blank, <= 1000 code points, counted as code points', () => {
  assert.equal(isValidBody('x'.repeat(1000)), true);
  assert.equal(isValidBody('x'.repeat(1001)), false);
  assert.equal(isValidBody('😀'.repeat(1000)), true); // 2000 UTF-16 units, 1000 code points
  assert.equal(isValidBody(' \n\t '), false);
  assert.equal(isValidBody('  padded  '), true);
});

test('REQ-PROTO-010 validation order: first failure wins', () => {
  assert.equal(validateSendRequest('bad name', { ...ok, from: 'x' })?.code, 'invalid_user');
  assert.equal(validateSendRequest('Alice', [])?.code, 'invalid_json');
  assert.equal(validateSendRequest('Alice', { ...ok, from: 'Mallory', id: 'nope' })?.code, 'sender_mismatch');
  assert.equal(validateSendRequest('Alice', { ...ok, id: 'NOPE', kind: 'gif' })?.code, 'invalid_id');
  assert.equal(validateSendRequest('Alice', { ...ok, kind: 'gif', to: '' })?.code, 'unsupported_kind');
  assert.equal(validateSendRequest('Alice', { ...ok, to: 'b b', body: '' })?.code, 'invalid_recipient');
  assert.equal(validateSendRequest('Alice', { ...ok, to: 'Alice', body: '' })?.code, 'self_message');
  assert.equal(validateSendRequest('Alice', { ...ok, body: ' ', createdAt: 'x' })?.code, 'invalid_body');
  assert.equal(validateSendRequest('Alice', { ...ok, createdAt: 'x' })?.code, 'invalid_created_at');
  assert.equal(validateSendRequest('Alice', ok), null);
  assert.equal(validateSendRequest('Alice', { ...ok, kind: 'text', extra: 1 }), null);
});

test('query int parsing', () => {
  assert.equal(parseNonNegativeInt(undefined, 7), 7);
  assert.equal(parseNonNegativeInt('0', 7), 0);
  assert.equal(parseNonNegativeInt('42', 7), 42);
  for (const v of ['-1', '1.5', 'abc', '', ['1']]) assert.equal(parseNonNegativeInt(v, 7), null, String(v));
});
