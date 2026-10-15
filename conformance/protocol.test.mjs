// Black-box conformance of the server against spec/core/20-protocol.md.
// Each test names the [server] requirement it verifies.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { serverUnderTest, client, newMessage, assertSchema } from './helpers.mjs';

let srv;
let api;
before(async () => {
  srv = await serverUnderTest();
  api = client(srv.baseUrl);
});
after(() => srv.stop());
beforeEach(() => api.reset());

test('REQ-PROTO-030 health needs no header and reports server time', async () => {
  const r = await api.call('GET', '/v1/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'ok');
  assert.match(r.json.serverTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('REQ-PROTO-002 CORS preflight and headers', async () => {
  const pre = await api.call('OPTIONS', '/v1/messages', {
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-chat-user' },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.match(pre.headers.get('access-control-allow-headers'), /X-Chat-User/i);
  assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  const r = await api.sync('Alice');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
});

test('REQ-PROTO-012 send stores with seq/receivedAt and returns 201 + message schema', async () => {
  const m = newMessage('Alice', 'Bob', '  keeps surrounding whitespace  ');
  const r = await api.send('Alice', m);
  assert.equal(r.status, 201);
  assertSchema('message.schema.json', r.json);
  assert.equal(r.json.seq, 1);
  assert.equal(r.json.body, m.body, 'body stored verbatim');
  assert.equal(r.json.kind, 'text');
  const r2 = await api.send('Bob', newMessage('Bob', 'Alice'));
  assert.equal(r2.json.seq, 2);
});

test('REQ-PROTO-012 kind defaults to text; recipient need not exist (store-and-forward)', async () => {
  const { kind, ...noKind } = newMessage('Alice', 'NeverSeen');
  const r = await api.send('Alice', noKind);
  assert.equal(r.status, 201);
  assert.equal(r.json.kind, 'text');
});

test('REQ-PROTO-011 duplicate id with identical content is an idempotent 200', async () => {
  const m = newMessage('Alice', 'Bob');
  const first = await api.send('Alice', m);
  const again = await api.send('Alice', m);
  assert.equal(again.status, 200);
  assert.deepEqual(again.json, first.json);
  const s = await api.sync('Alice');
  assert.equal(s.json.messages.length, 1);
});

test('REQ-PROTO-011 duplicate id with different content is 409 id_conflict', async () => {
  const m = newMessage('Alice', 'Bob');
  await api.send('Alice', m);
  const r = await api.send('Alice', { ...m, body: 'different' });
  assert.equal(r.status, 409);
  assertSchema('error.schema.json', r.json);
  assert.equal(r.json.error.code, 'id_conflict');
});

test('REQ-PROTO-010 / REQ-PROTO-003 validation codes, in order', async () => {
  const good = newMessage('Alice', 'Bob');
  const cases = [
    [{ user: undefined, body: good }, 'invalid_user'],
    [{ user: 'not valid', body: good }, 'invalid_user'],
    [{ user: 'Alice', raw: '{not json', headers: { 'Content-Type': 'application/json' } }, 'invalid_json'],
    [{ user: 'Alice', body: [1, 2] }, 'invalid_json'],
    [{ user: 'Alice', body: { ...good, from: 'Bob' } }, 'sender_mismatch'],
    [{ user: 'Alice', body: { ...good, id: 'ABC' } }, 'invalid_id'],
    [{ user: 'Alice', body: { ...good, id: good.id.toUpperCase() } }, 'invalid_id'],
    [{ user: 'Alice', body: { ...good, kind: 'sticker' } }, 'unsupported_kind'],
    [{ user: 'Alice', body: { ...good, to: 'b o b' } }, 'invalid_recipient'],
    [{ user: 'Alice', body: { ...good, to: 'Alice' } }, 'self_message'],
    [{ user: 'Alice', body: { ...good, body: ' \n ' } }, 'invalid_body'],
    [{ user: 'Alice', body: { ...good, body: 'x'.repeat(1001) } }, 'invalid_body'],
    [{ user: 'Alice', body: { ...good, body: 42 } }, 'invalid_body'],
    [{ user: 'Alice', body: { ...good, createdAt: '2026-10-15T13:04:05Z' } }, 'invalid_created_at'],
    // order: sender_mismatch is reported before an also-invalid id
    [{ user: 'Alice', body: { ...good, from: 'Bob', id: 'bad' } }, 'sender_mismatch'],
  ];
  for (const [opts, code] of cases) {
    const r = await api.call('POST', '/v1/messages', opts);
    assert.equal(r.status, 400, `${code}: ${r.text}`);
    assertSchema('error.schema.json', r.json);
    assert.equal(r.json.error.code, code, JSON.stringify(opts.body ?? opts.raw));
  }
  const ok = await api.send('Alice', { ...good, body: '😀'.repeat(1000), unknownField: true });
  assert.equal(ok.status, 201, '1000 code points + unknown fields are accepted (REQ-PROTO-004)');
});

test('REQ-PROTO-021 sync returns only my messages after the cursor, ordered, schema-valid', async () => {
  await api.send('Alice', newMessage('Alice', 'Bob', 'a1'));
  await api.send('Carol', newMessage('Carol', 'Dave', 'not yours'));
  await api.send('Bob', newMessage('Bob', 'Alice', 'b1'));
  const all = await api.sync('Alice');
  assert.equal(all.status, 200);
  assertSchema('sync-response.schema.json', all.json);
  assert.deepEqual(all.json.messages.map((m) => m.body), ['a1', 'b1']);
  assert.deepEqual(all.json.messages.map((m) => m.seq), [1, 3]);
  assert.equal(all.json.cursor, 3);
  assert.equal(all.json.hasMore, false);
  const tail = await api.sync('Alice', '?after=1');
  assert.deepEqual(tail.json.messages.map((m) => m.body), ['b1']);
  const none = await api.sync('Alice', '?after=3');
  assert.deepEqual(none.json, { messages: [], cursor: 3, hasMore: false });
});

test('REQ-PROTO-021 pages of 100 with hasMore', async () => {
  for (let i = 0; i < 105; i++) await api.send('Alice', newMessage('Alice', 'Bob', `m${i}`));
  const p1 = await api.sync('Bob');
  assert.equal(p1.json.messages.length, 100);
  assert.equal(p1.json.hasMore, true);
  assert.equal(p1.json.cursor, 100);
  const p2 = await api.sync('Bob', `?after=${p1.json.cursor}`);
  assert.equal(p2.json.messages.length, 5);
  assert.equal(p2.json.hasMore, false);
});

test('REQ-PROTO-020 cursor/wait validation and header requirement', async () => {
  assert.equal((await api.sync('Alice', '?after=-1')).json.error.code, 'invalid_cursor');
  assert.equal((await api.sync('Alice', '?after=abc')).json.error.code, 'invalid_cursor');
  assert.equal((await api.sync('Alice', '?wait=1.5')).json.error.code, 'invalid_wait');
  assert.equal((await api.sync(undefined)).json.error.code, 'invalid_user');
});

test('REQ-PROTO-022 long-poll returns as soon as a matching message arrives', async () => {
  const t0 = Date.now();
  const pending = api.sync('Bob', '?after=0&wait=10');
  await new Promise((r) => setTimeout(r, 300));
  await api.send('Carol', newMessage('Carol', 'Dave', 'unrelated')); // must not wake Bob
  await new Promise((r) => setTimeout(r, 200));
  await api.send('Alice', newMessage('Alice', 'Bob', 'wake up'));
  const r = await pending;
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.messages.map((m) => m.body), ['wake up']);
  assert.ok(Date.now() - t0 < 3000, 'returned promptly');
});

test('REQ-PROTO-022 long-poll times out with an empty page at the same cursor', async () => {
  const t0 = Date.now();
  const r = await api.sync('Bob', '?after=7&wait=1');
  assert.deepEqual(r.json, { messages: [], cursor: 7, hasMore: false });
  assert.ok(Date.now() - t0 >= 900);
});

test('REQ-PROTO-020 wait is clamped to 30 seconds (accepted, not rejected)', async () => {
  const pending = api.sync('Bob', '?wait=999');
  await new Promise((r) => setTimeout(r, 200));
  await api.send('Alice', newMessage('Alice', 'Bob'));
  assert.equal((await pending).status, 200);
});

test('unknown routes return a JSON not_found error (REQ-PROTO-003)', async () => {
  const r = await api.call('GET', '/v1/nope');
  assert.equal(r.status, 404);
  assertSchema('error.schema.json', r.json);
});
