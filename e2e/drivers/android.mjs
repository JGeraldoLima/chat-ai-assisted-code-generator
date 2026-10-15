// Android driver: adb + UI Automator. Elements are located only by the spec's element IDs, which the
// app exposes as resource-ids (Modifier.testTag + testTagsAsResourceId, per spec/platforms/android.md).
// One actor per device; pick a device with `android@<serial>` in --bind (default: the only device).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const PACKAGE = 'com.example.chatclient';
const ACTIVITY = `${PACKAGE}/.MainActivity`;

function adbFactory(serial) {
  const base = serial ? ['-s', serial] : [];
  return async (...args) => (await run('adb', [...base, ...args], { maxBuffer: 16 * 1024 * 1024, windowsHide: true })).stdout;
}

const decode = (s) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');

/** Minimal UI Automator XML → tree. */
export function parseHierarchy(xml) {
  const root = { attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<node\b([^>]*?)(\/?)>|<\/node>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[0] === '</node>') {
      cur = cur.parent ?? root;
      continue;
    }
    const attrs = {};
    for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = decode(a[2]);
    const b = attrs.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    const node = { attrs, children: [], parent: cur, bounds: b ? b.slice(1).map(Number) : [0, 0, 0, 0] };
    cur.children.push(node);
    if (!m[2]) cur = node;
  }
  return root;
}

function* walk(n) {
  for (const c of n.children) {
    yield c;
    yield* walk(c);
  }
}
const idOf = (n) => n.attrs['resource-id']?.replace(/^.*:id\//, '');
const findAll = (root, id) => [...walk(root)].filter((n) => idOf(n) === id);
const find = (root, id) => findAll(root, id)[0] ?? null;

/** Visible text of a node: its own text, else the joined text of its descendants. */
function textOf(n) {
  if (!n) return null;
  if (n.attrs.text) return n.attrs.text.trim();
  const parts = [...walk(n)].map((c) => c.attrs.text).filter(Boolean);
  return parts.length ? parts.join(' ').trim() : '';
}

/** Input fields: empty fields may report their placeholder as text; treat that as empty. */
const PLACEHOLDERS = new Set(['Your name', 'Send to (name)', 'Message']);
function inputText(n) {
  if (!n) return null;
  const t = n.attrs.text ?? '';
  return PLACEHOLDERS.has(t) ? '' : t;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const center = (n) => [Math.round((n.bounds[0] + n.bounds[2]) / 2), Math.round((n.bounds[1] + n.bounds[3]) / 2)];

/** Text for `adb shell input text`: %s encodes spaces; single-quote for the device shell. */
const shellText = (s) => `'${s.replace(/ /g, '%s').replace(/'/g, `'\\''`)}'`;

export async function createAndroidDriver({ serial } = {}) {
  const adb = adbFactory(serial);
  const devices = (await adb('devices')).split('\n').slice(1).filter((l) => /\tdevice$/.test(l.trim()) || /\tdevice/.test(l));
  if (!devices.length) throw new Error('No Android device/emulator connected (adb devices). Start one, e.g. `emulator -avd Pixel_8`.');
  const installed = await adb('shell', 'pm', 'path', PACKAGE).catch(() => '');
  if (!installed.includes('package:')) throw new Error(`${PACKAGE} is not installed. Run with --install or: cd client && gradlew installDebug`);
  const size = (await adb('shell', 'wm', 'size')).match(/(\d+)x(\d+)/);
  const screenH = size ? Number(size[2]) : 2400;

  let last = null;
  async function dump() {
    for (let i = 0; i < 5; i++) {
      const out = await adb('exec-out', 'uiautomator', 'dump', '/dev/tty').catch((e) => String(e.stdout ?? ''));
      const xml = out.slice(out.indexOf('<?xml'), out.lastIndexOf('</hierarchy>') + '</hierarchy>'.length);
      if (xml.startsWith('<?xml')) return (last = parseHierarchy(xml));
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('uiautomator dump failed repeatedly');
  }
  const need = async (id) => {
    const n = find(await dump(), id);
    if (!n) throw new Error(`element "${id}" not found on screen`);
    return n;
  };
  /**
   * Element whose bounds are identical in two consecutive dumps. Tapping on the first dump is unsafe
   * while the IME slides in and `imePadding()` moves the layout: the tap lands on the keyboard instead.
   */
  async function stable(id) {
    let prev = await need(id);
    for (let i = 0; i < 12; i++) {
      await sleep(250);
      const cur = await need(id);
      if (cur.bounds.join() === prev.bounds.join()) return cur;
      prev = cur;
    }
    return prev;
  }
  const tap = async (id) => adb('shell', 'input', 'tap', ...center(await stable(id)).map(String));
  const fieldText = async (id) => inputText(find(await dump(), id)) ?? '';

  /**
   * Types text into a field and verifies it arrived. `adb input text` silently drops characters when
   * the IME isn't focused yet or the string is long, so type in chunks and retry until the field
   * holds exactly `text`.
   */
  async function typeInto(id, text) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await tap(id);
      await stable(id); // keyboard shown, layout settled
      await adb('shell', 'input', 'keycombination', '113', '29').catch(() => {}); // Ctrl+A
      await adb('shell', 'input', 'keyevent', '67'); // Del
      for (let i = 0; i < text.length; i += 80) {
        await adb('shell', 'input', 'text', shellText(text.slice(i, i + 80)));
      }
      if ((await fieldText(id)) === text) return;
    }
    throw new Error(`could not type ${text.length} chars into "${id}" (field holds ${JSON.stringify((await fieldText(id)).slice(0, 40))}…)`);
  }
  const start = () => adb('shell', 'am', 'start', '-W', '-n', ACTIVITY);

  return {
    kind: 'android',
    async launch() {
      await adb('shell', 'am', 'force-stop', PACKAGE);
      await adb('shell', 'pm', 'clear', PACKAGE);
      await start();
    },
    async restart() {
      await adb('shell', 'am', 'force-stop', PACKAGE);
      await start();
    },
    close: () => adb('shell', 'am', 'force-stop', PACKAGE).catch(() => {}),
    async login(name) {
      await typeInto('login-name', name);
      await tap('login-submit');
    },
    logout: () => tap('logout'),
    async openThreadRaw(peer) {
      await typeInto('new-conversation-peer', peer);
      await tap('new-conversation-open');
    },
    back: () => tap('thread-back'),
    async send(body) {
      await typeInto('composer-input', body);
      await tap('composer-send');
    },
    async read() {
      const root = await dump();
      const t = (id, r = root) => textOf(find(r, id));
      const screen = find(root, 'login-name') ? 'login' : find(root, 'thread-peer') ? 'thread' : find(root, 'me-name') ? 'conversations' : 'unknown';
      const rows = findAll(root, 'message-row');
      const lastRow = rows.at(-1);
      const q = t('queued-count');
      return {
        screen,
        loginError: t('login-error'),
        meName: t('me-name'),
        newConversationError: t('new-conversation-error'),
        composerError: t('composer-error'),
        composerText: inputText(find(root, 'composer-input')),
        threadPeer: t('thread-peer'),
        connection: t('connection-status'),
        queued: q && /^\d+ queued$/.test(q) ? Number(q.split(' ')[0]) : q,
        conversationsEmpty: !!find(root, 'conversations-empty'),
        threadEmpty: !!find(root, 'thread-empty'),
        conversations: findAll(root, 'conversation-row').map((r) => ({ peer: t('conversation-peer', r), preview: t('conversation-preview', r) })),
        thread: rows.map((r) => ({ from: t('message-from', r), body: t('message-body', r), status: t('message-status', r) })),
        lastRowVisible: !!lastRow && lastRow.bounds[3] > lastRow.bounds[1] && lastRow.bounds[3] <= screenH,
      };
    },
    async screenshot(path) {
      const { writeFile } = await import('node:fs/promises');
      const png = await run('adb', [...(serial ? ['-s', serial] : []), 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
      await writeFile(path, png.stdout);
    },
    _lastTree: () => last,
  };
}
