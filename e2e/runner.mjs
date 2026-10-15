#!/usr/bin/env node
// Executes spec/scenarios/*.yaml against real clients. Each actor is bound to a driver.
//
//   node e2e/runner.mjs [scenario.yaml ...] [--all] [--bind alice=web,bob=android]
//                       [--server URL] [--web-url URL] [--headed] [--install] [--timeout ms]
//
// Unbound actors use the headless reference client. Exit code 0 iff every scenario passed.
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { startServer, isServerUp } from '../tools/server-process.mjs';
import { createReferenceDriver } from './drivers/reference.mjs';
import { childEnv } from '../harness/lib/paths.mjs';
import { resolveCmd } from '../harness/lib/target.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCENARIO_DIR = join(ROOT, 'spec', 'scenarios');

// ---- CLI ---------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const valueFlags = new Set(['--bind', '--server', '--web-url', '--timeout']);
const files = argv.filter((a, i) => !a.startsWith('--') && !valueFlags.has(argv[i - 1]));
const scenarioFiles = argv.includes('--all') || !files.length
  ? readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.yaml')).sort().map((f) => join(SCENARIO_DIR, f))
  : files.map((f) => resolve(f));
const bindings = Object.fromEntries((opt('--bind', '') || '').split(',').filter(Boolean).map((b) => b.split('=')));
const DEFAULT_TIMEOUT = Number(opt('--timeout', 15000));
const headed = argv.includes('--headed');
const artifacts = join(ROOT, 'e2e', 'artifacts', new Date().toISOString().replace(/[:.]/g, '-'));

// ---- infrastructure ------------------------------------------------------------------------
const children = [];
async function ensureServer() {
  const url = opt('--server', 'http://localhost:8080');
  if (await isServerUp(url)) return url;
  if (!/localhost:8080$/.test(url)) throw new Error(`no server at ${url}`);
  const srv = await startServer({ port: 8080 });
  children.push(srv);
  return srv.baseUrl;
}

async function ensureWeb(serverUrl) {
  const url = opt('--web-url', 'http://localhost:4173');
  if (await fetch(url).then((r) => r.ok, () => false)) return url;
  const web = join(ROOT, 'webclient');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const env = { ...process.env, VITE_CHATGEN_SERVER_URL: serverUrl };
  console.log('  building web client…');
  await new Promise((res, rej) => {
    const p = spawn(npm, ['run', 'build'], { cwd: web, env, shell: process.platform === 'win32', stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error('web build failed'))));
  });
  const port = new URL(url).port || '4173';
  const p = spawn(npm, ['run', 'preview', '--', '--port', port, '--strictPort'], { cwd: web, env, shell: process.platform === 'win32', stdio: 'ignore' });
  children.push({ stop: async () => killTree(p) });
  for (let i = 0; i < 60; i++) {
    if (await fetch(url).then((r) => r.ok, () => false)) return url;
    await sleep(250);
  }
  throw new Error(`web preview did not start at ${url}`);
}

async function installAndroid() {
  // Absolute wrapper path: hardened shells (e.g. Claude Code) set NoDefaultCurrentDirectoryInExePath.
  const [gradlew] = resolveCmd(['{gradlew}'], join(ROOT, 'client'));
  console.log('  installing Android app (gradlew installDebug)…');
  await new Promise((res, rej) => {
    const p = spawn(gradlew, ['installDebug', '--console=plain'], { cwd: join(ROOT, 'client'), env: childEnv(), shell: process.platform === 'win32', stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error('installDebug failed'))));
  });
}

function killTree(p) {
  if (p.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  else p.kill();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- scenario execution ----------------------------------------------------------------------
const normalize = (s) => String(s).trim();
const bodyOf = (b) => (typeof b === 'object' && b !== null ? String(b.repeat).repeat(b.count) : String(b));

async function poll(fn, timeout, describe) {
  const deadline = Date.now() + timeout;
  let last;
  while (true) {
    const r = await fn();
    if (r.ok) return r;
    last = r;
    if (Date.now() > deadline) throw new Error(`${describe}\n      expected: ${JSON.stringify(last.expected)}\n      actual:   ${JSON.stringify(last.actual)}`);
    await sleep(250);
  }
}

async function runScenario(file, ctx) {
  const doc = YAML.parse(readFileSync(file, 'utf8'));
  const actors = {};
  console.log(`\n▶ ${doc.id}: ${doc.title}`);
  console.log(`  bindings: ${Object.keys(doc.actors).map((a) => `${a}=${bindings[a] ?? 'reference'}`).join(', ')}`);
  const results = [];
  try {
    for (const [key, a] of Object.entries(doc.actors)) {
      actors[key] = { ...a, driver: await createDriver(bindings[key] ?? 'reference', ctx) };
    }
    let i = 0;
    for (const step of doc.steps) {
      i++;
      const [op, args = {}] = Object.entries(step)[0];
      const label = `${String(i).padStart(2)} ${op}${args.actor ? ` ${args.actor}` : ''}${args.body !== undefined ? ` "${String(bodyOf(args.body)).slice(0, 40)}"` : ''}${args.online !== undefined ? ` online=${args.online}` : ''}`;
      const t0 = Date.now();
      try {
        await OPS[op](args, { actors, ctx, actor: actors[args.actor] });
        results.push({ step: i, op, ok: true, ms: Date.now() - t0 });
        console.log(`  ✓ ${label} (${Date.now() - t0}ms)`);
      } catch (e) {
        results.push({ step: i, op, ok: false, ms: Date.now() - t0, error: e.message });
        console.log(`  ✗ ${label}\n      ${e.message}`);
        mkdirSync(artifacts, { recursive: true });
        const server = await fetch(`${ctx.serverUrl}/admin/api/state`).then((r) => r.json(), (err) => ({ error: String(err) }));
        writeFileSync(join(artifacts, `${doc.id}-step${i}-server.json`), JSON.stringify(server, null, 2));
        for (const [k, a] of Object.entries(actors)) {
          await a.driver.screenshot?.(join(artifacts, `${doc.id}-step${i}-${k}.png`)).catch(() => {});
          const snap = await a.driver.read().catch((err) => ({ error: String(err) }));
          writeFileSync(join(artifacts, `${doc.id}-step${i}-${k}.json`), JSON.stringify(snap, null, 2));
        }
        return { id: doc.id, ok: false, results };
      }
    }
    return { id: doc.id, ok: true, results };
  } finally {
    for (const a of Object.values(actors)) await a.driver?.close().catch(() => {});
  }
}

async function createDriver(spec, ctx) {
  const [kind, serial] = spec.split('@');
  if (kind === 'reference') return createReferenceDriver({ serverUrl: ctx.serverUrl });
  if (kind === 'web') {
    const { createWebDriver } = await import('./drivers/web.mjs');
    return createWebDriver({ webUrl: ctx.webUrl, headed });
  }
  if (kind === 'android') {
    const { createAndroidDriver } = await import('./drivers/android.mjs');
    return createAndroidDriver({ serial });
  }
  throw new Error(`unknown driver "${spec}" (use reference, web, android[@serial])`);
}

// ---- navigation helpers (driver-agnostic) -----------------------------------------------------
async function toConversations(d, timeout) {
  let s = await d.read();
  if (s.screen === 'thread') {
    await d.back();
    s = (await poll(async () => {
      const r = await d.read();
      return { ok: r.screen === 'conversations', expected: 'conversations', actual: r.screen };
    }, timeout, 'back to Conversations')).ok && (await d.read());
  }
  if (s.screen !== 'conversations') throw new Error(`expected Conversations screen, on "${s.screen}"`);
}

async function openThread(d, peer, timeout) {
  const target = normalize(peer);
  const s = await d.read();
  if (s.screen === 'thread' && s.threadPeer === target) return;
  await toConversations(d, timeout);
  await d.openThreadRaw(peer);
  await poll(async () => {
    const r = await d.read();
    return { ok: r.screen === 'thread' && r.threadPeer === target, expected: { screen: 'thread', peer: target }, actual: { screen: r.screen, peer: r.threadPeer, error: r.newConversationError } };
  }, timeout, `open thread with ${target}`);
}

const expectRead = (d, timeout, describe, pick, expected) =>
  poll(async () => {
    const actual = pick(await d.read());
    return { ok: JSON.stringify(actual) === JSON.stringify(expected), expected, actual };
  }, timeout, describe);

// ---- operations (spec/scenarios/README.md) --------------------------------------------------------
const OPS = {
  async reset(_a, { ctx }) {
    await fetch(`${ctx.serverUrl}/admin/api/reset`, { method: 'POST' });
  },
  launch: (_a, { actor }) => actor.driver.launch(),
  async restart(a, { actor }) {
    await actor.driver.restart();
  },
  async login(a, { actor }) {
    const name = a.name ?? actor.name;
    await expectRead(actor.driver, a.timeout ?? DEFAULT_TIMEOUT, 'Login screen', (r) => r.screen, 'login');
    await actor.driver.login(name);
    await expectRead(actor.driver, a.timeout ?? DEFAULT_TIMEOUT, 'Conversations after login', (r) => ({ screen: r.screen, me: r.meName }), { screen: 'conversations', me: normalize(name) });
  },
  async loginExpectError(a, { actor }) {
    await actor.driver.login(a.name);
    await expectRead(actor.driver, a.timeout ?? DEFAULT_TIMEOUT, 'login error', (r) => ({ screen: r.screen, error: r.loginError }), { screen: 'login', error: a.error });
  },
  openThread: (a, { actor }) => openThread(actor.driver, a.peer, a.timeout ?? DEFAULT_TIMEOUT),
  async openThreadExpectError(a, { actor }) {
    await toConversations(actor.driver, DEFAULT_TIMEOUT);
    await actor.driver.openThreadRaw(a.peer);
    await expectRead(actor.driver, a.timeout ?? DEFAULT_TIMEOUT, 'new-conversation error', (r) => ({ screen: r.screen, error: r.newConversationError }), { screen: 'conversations', error: a.error });
  },
  async send(a, { actor }) {
    await openThread(actor.driver, a.to, DEFAULT_TIMEOUT);
    await actor.driver.send(bodyOf(a.body));
    await expectRead(actor.driver, a.timeout ?? DEFAULT_TIMEOUT, 'composer cleared after send', (r) => r.composerText, '');
  },
  async sendExpectError(a, { actor }) {
    await openThread(actor.driver, a.to, DEFAULT_TIMEOUT);
    const body = bodyOf(a.body);
    await actor.driver.send(body);
    await expectRead(actor.driver, a.timeout ?? DEFAULT_TIMEOUT, 'composer error', (r) => ({ error: r.composerError, keepsText: r.composerText === body }), { error: a.error, keepsText: true });
  },
  async network(a, { actor, ctx }) {
    const r = await fetch(`${ctx.serverUrl}/admin/api/users/${encodeURIComponent(actor.name)}/network`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ online: a.online }),
    });
    if (!r.ok) throw new Error(`portal returned ${r.status}`);
  },
  expectConnection: (a, { actor }) =>
    expectRead(actor.driver, a.timeout ?? DEFAULT_TIMEOUT, 'connection state',
      (r) => (a.queued === undefined ? { status: r.connection } : { status: r.connection, queued: r.queued }),
      a.queued === undefined ? { status: a.status } : { status: a.status, queued: a.queued }),
  async expectThread(a, { actor }) {
    await openThread(actor.driver, a.peer, DEFAULT_TIMEOUT);
    const expected = a.messages.map((m) => ({ from: m.from, body: bodyOf(m.body), status: m.status }));
    await expectRead(actor.driver, a.timeout ?? DEFAULT_TIMEOUT, `thread with ${a.peer}`,
      (r) => ({ rows: r.thread, empty: r.threadEmpty }), { rows: expected, empty: expected.length === 0 });
  },
  async expectLastVisible(a, { actor }) {
    await openThread(actor.driver, a.peer, DEFAULT_TIMEOUT);
    await expectRead(actor.driver, a.timeout ?? DEFAULT_TIMEOUT, 'last message visible',
      (r) => ({ last: r.thread.at(-1)?.body ?? null, visible: r.lastRowVisible }), { last: bodyOf(a.body), visible: true });
  },
  async expectConversations(a, { actor }) {
    await toConversations(actor.driver, DEFAULT_TIMEOUT);
    await expectRead(actor.driver, a.timeout ?? DEFAULT_TIMEOUT, 'conversation list',
      (r) => ({ peers: r.conversations.map((c) => c.peer), ...(a.previews ? { previews: r.conversations.map((c) => c.preview) } : {}), empty: r.conversationsEmpty }),
      { peers: a.peers, ...(a.previews ? { previews: a.previews } : {}), empty: a.peers.length === 0 });
  },
  expectScreen: (a, { actor }) => expectRead(actor.driver, a.timeout ?? DEFAULT_TIMEOUT, 'screen', (r) => r.screen, a.screen),
  async logout(a, { actor }) {
    await toConversations(actor.driver, DEFAULT_TIMEOUT);
    await actor.driver.logout();
    await expectRead(actor.driver, a.timeout ?? DEFAULT_TIMEOUT, 'Login after logout', (r) => r.screen, 'login');
  },
  async expectServer(a, { ctx }) {
    await poll(async () => {
      const s = await (await fetch(`${ctx.serverUrl}/admin/api/state`)).json();
      const actual = s.messages.map((m) => ({ from: m.from, to: m.to, body: m.body }));
      const expected = a.messages.map((m) => ({ from: m.from, to: m.to, body: bodyOf(m.body) }));
      return { ok: JSON.stringify(actual) === JSON.stringify(expected), expected, actual };
    }, a.timeout ?? DEFAULT_TIMEOUT, 'server message log');
  },
};

// ---- main ------------------------------------------------------------------------------------------
const summary = [];
let exitCode = 0;
try {
  const kinds = new Set(Object.values(bindings).map((b) => b.split('@')[0]));
  const ctx = { serverUrl: await ensureServer() };
  console.log(`server: ${ctx.serverUrl} (portal ${ctx.serverUrl}/admin)`);
  if (kinds.has('web')) ctx.webUrl = await ensureWeb(ctx.serverUrl);
  if (kinds.has('android') && argv.includes('--install')) await installAndroid();
  for (const f of scenarioFiles) {
    if (!existsSync(f)) throw new Error(`scenario not found: ${f}`);
    const r = await runScenario(f, ctx);
    summary.push(r);
    if (!r.ok) exitCode = 1;
  }
} catch (e) {
  console.error(`\nERROR: ${e.message}`);
  exitCode = 2;
} finally {
  if ([...Object.values(bindings)].some((b) => b.startsWith('web'))) await (await import('./drivers/web.mjs')).closeWebBrowser();
  for (const c of children) await c.stop();
}
console.log(`\n${summary.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.id}`).join('\n')}`);
const report = { bindings, scenarios: summary, at: new Date().toISOString() };
mkdirSync(artifacts, { recursive: true });
writeFileSync(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
console.log(`report: ${join('e2e', 'artifacts', basename(artifacts), 'report.json')}`);
process.exit(exitCode);
