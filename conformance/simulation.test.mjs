// Conformance of the network-simulation portal (spec/core/20-protocol.md, REQ-SIM-*).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { serverUnderTest, client, newMessage, outcome } from './helpers.mjs';

let srv;
let api;
before(async () => {
  srv = await serverUnderTest();
  api = client(srv.baseUrl);
});
after(() => srv.stop());
beforeEach(() => api.reset());

test('REQ-SIM-001 offline user: connection is dropped with no HTTP response; others unaffected', async () => {
  await api.network('Alice', false);
  assert.equal(await outcome(api.send('Alice', newMessage('Alice', 'Bob'))), 'reset');
  assert.equal(await outcome(api.sync('Alice')), 'reset');
  assert.equal(await outcome(api.sync('Bob')), 200);
  // Nothing was stored for the dropped send.
  assert.equal((await api.state()).json.messages.length, 0);
  // Health and admin are never simulated (REQ-PROTO-030, REQ-SIM-003).
  assert.equal(await outcome(api.call('GET', '/v1/health', { user: 'Alice' })), 200);
  // CORS preflight is not affected.
  assert.equal(await outcome(api.call('OPTIONS', '/v1/messages')), 204);

  await api.network('Alice', true);
  assert.equal(await outcome(api.send('Alice', newMessage('Alice', 'Bob'))), 201);
});

test('REQ-SIM-002 going offline cuts in-flight long-polls immediately', async () => {
  const t0 = Date.now();
  const pending = outcome(api.sync('Bob', '?wait=20'));
  await new Promise((r) => setTimeout(r, 300));
  const state = (await api.state()).json;
  assert.equal(state.users.find((u) => u.name === 'Bob').pendingPolls, 1);
  await api.network('Bob', false);
  assert.equal(await pending, 'reset');
  assert.ok(Date.now() - t0 < 3000);
});

test('REQ-SIM-003 admin API: state, toggle unknown user, reset', async () => {
  const r = await api.network('Zed', false);
  assert.equal(r.status, 200);
  assert.deepEqual({ name: r.json.name, online: r.json.online }, { name: 'Zed', online: false });
  assert.equal((await api.network('bad name', false)).status, 400);
  assert.equal((await api.call('POST', '/admin/api/users/Zed/network', { body: { online: 'yes' } })).status, 400);

  await api.send('Alice', newMessage('Alice', 'Bob'));
  const s = (await api.state()).json;
  assert.equal(s.messages.length, 1);
  assert.deepEqual(s.users.map((u) => u.name), ['Alice', 'Bob', 'Zed']);

  const html = await api.call('GET', '/admin');
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type'), /text\/html/);

  await api.reset();
  const s2 = (await api.state()).json;
  assert.deepEqual(s2, { users: [], messages: [] });
  assert.equal((await api.send('Alice', newMessage('Alice', 'Bob'))).json.seq, 1, 'seq restarts after reset');
});

test('REQ-SIM-004 names become known via header or as a recipient', async () => {
  await api.sync('Watcher');
  await api.send('Alice', newMessage('Alice', 'Recipient'));
  const names = (await api.state()).json.users.map((u) => u.name);
  assert.deepEqual(names, ['Alice', 'Recipient', 'Watcher']);
});

test('reset destroys in-flight long-polls', async () => {
  const pending = outcome(api.sync('Bob', '?wait=20'));
  await new Promise((r) => setTimeout(r, 300));
  await api.reset();
  assert.equal(await pending, 'reset');
});
