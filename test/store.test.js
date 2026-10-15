import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, SYNC_PAGE_SIZE } from '../src/store.js';

let n = 0;
const msg = (from, to, body = 'hi') => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  from, to, body, createdAt: '2026-10-15T13:04:05.120Z',
});

test('accept assigns increasing seq; duplicates are idempotent; conflicts are 409', () => {
  const s = new Store();
  const a = msg('Alice', 'Bob');
  assert.equal(s.accept(a).status, 201);
  assert.equal(s.accept(msg('Bob', 'Alice')).message.seq, 2);
  const again = s.accept(a);
  assert.equal(again.status, 200);
  assert.equal(again.message.seq, 1);
  assert.equal(s.accept({ ...a, body: 'changed' }).status, 409);
  assert.equal(s.messages.length, 2);
});

test('query returns only the user\'s messages after the cursor, paged', () => {
  const s = new Store();
  s.accept(msg('Alice', 'Bob'));
  s.accept(msg('Carol', 'Dave'));
  s.accept(msg('Bob', 'Alice'));
  assert.deepEqual(s.query('Alice', 0).messages.map((m) => m.seq), [1, 3]);
  assert.deepEqual(s.query('Alice', 1), { messages: [s.messages[2]], cursor: 3, hasMore: false });
  assert.deepEqual(s.query('Alice', 3), { messages: [], cursor: 3, hasMore: false });
  for (let i = 0; i < SYNC_PAGE_SIZE + 5; i++) s.accept(msg('Eve', 'Frank'));
  const page = s.query('Eve', 0);
  assert.equal(page.messages.length, SYNC_PAGE_SIZE);
  assert.equal(page.hasMore, true);
  assert.equal(s.query('Eve', page.cursor).messages.length, 5);
});

test('long-poll resolves on a matching message, and is aborted when the user goes offline', async () => {
  const s = new Store();
  const got = await new Promise((resolve) => {
    s.poll({ user: 'Bob', after: 0, waitSeconds: 30, onResult: resolve, onAbort: () => resolve('aborted') });
    s.accept(msg('Carol', 'Dave')); // not Bob's: must not wake him
    s.accept(msg('Alice', 'Bob'));
  });
  assert.equal(got.messages.length, 1);
  assert.equal(s.waiters.size, 0);

  const aborted = await new Promise((resolve) => {
    s.poll({ user: 'Bob', after: 2, waitSeconds: 30, onResult: () => resolve('result'), onAbort: () => resolve('aborted') });
    assert.equal(s.state().users.find((u) => u.name === 'Bob').pendingPolls, 1);
    s.setOnline('Bob', false);
  });
  assert.equal(aborted, 'aborted');
  assert.equal(s.isOffline('Bob'), true);
});

test('long-poll times out with an empty page at the same cursor', async () => {
  const s = new Store();
  const res = await new Promise((resolve) => s.poll({ user: 'Bob', after: 5, waitSeconds: 0.05, onResult: resolve, onAbort: () => {} }));
  assert.deepEqual(res, { messages: [], cursor: 5, hasMore: false });
});
