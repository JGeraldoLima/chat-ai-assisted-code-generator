// Prerequisite check ("doctor"): tells the user what is missing before anything runs or spends tokens.
// Used by `npm run doctor`, harness/regen.mjs and e2e/runner.mjs.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { ROOT } from './paths.mjs';

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', timeout: 30_000, ...opts });
const firstLine = (s) => String(s ?? '').trim().split(/\r?\n/)[0];

export function androidSdkDir() {
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Android', 'Sdk')
      : process.platform === 'darwin' ? join(homedir(), 'Library', 'Android', 'sdk') : join(homedir(), 'Android', 'Sdk'));
}

/** The coding agent the harness drives: `claude` (default) or `codex`, from --agent or CHATGEN_AGENT. */
export function selectedAgent(argv = process.argv) {
  const i = argv.indexOf('--agent');
  const a = (i >= 0 ? argv[i + 1] : process.env.CHATGEN_AGENT) ?? 'claude';
  if (!['claude', 'codex'].includes(a)) throw new Error(`unknown agent "${a}" (use claude or codex)`);
  return a;
}

/**
 * @param {{targets?: string[], agent?: 'claude'|'codex'|null, e2e?: boolean, devices?: boolean}} need
 *   targets: web/android platforms to check; agent: the coding agent that will run (null = none);
 *   e2e: browser/emulator tooling for scenarios; devices: an Android device must be connected now.
 * @returns {Array<{name: string, ok: boolean, warn?: boolean, detail: string, fix?: string}>}
 */
export function checkPrereqs({ targets = [], agent = null, e2e = false, devices = false } = {}) {
  const out = [];
  const add = (name, ok, detail, fix, warn = false) => out.push({ name, ok, warn, detail, fix });

  // Always
  const major = Number(process.versions.node.split('.')[0]);
  add('Node.js >= 22', major >= 22, `v${process.versions.node}`, 'Install Node.js 22 or newer (https://nodejs.org).');
  const git = run('git', ['--version']);
  add('git', git.status === 0, firstLine(git.stdout) || 'not found', 'Install git (https://git-scm.com).');
  add('root dependencies', existsSync(join(ROOT, 'node_modules', 'yaml')), existsSync(join(ROOT, 'node_modules', 'yaml')) ? 'installed' : 'missing',
    'Run `npm install` in the repo root (it also installs the server).');
  add('server dependencies', existsSync(join(ROOT, 'server', 'node_modules', 'express')), existsSync(join(ROOT, 'server', 'node_modules', 'express')) ? 'installed' : 'missing',
    'Run `npm install` in the repo root (postinstall runs `npm ci` in server/).');

  // Coding agent
  if (agent === 'claude') {
    const v = run('claude', ['--version']);
    add('Claude Code CLI', v.status === 0, firstLine(v.stdout) || 'not found',
      'Install Claude Code (https://docs.claude.com/en/docs/claude-code), or use Codex with `--agent codex`.');
    if (v.status === 0) {
      let auth = null;
      try { auth = JSON.parse(run('claude', ['auth', 'status']).stdout); } catch { /* older CLI */ }
      const loggedIn = auth ? !!auth.loggedIn : !!process.env.ANTHROPIC_API_KEY;
      const how = process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY (billed per token)'
        : auth?.authMethod ? `${auth.authMethod}${auth.authMethod === 'claude.ai' ? ' subscription (counts against plan usage limits)' : ''}` : 'unknown';
      add('Claude Code login', loggedIn, loggedIn ? how : 'not logged in', 'Run `claude` and then `/login`, or set ANTHROPIC_API_KEY.');
    }
  } else if (agent === 'codex') {
    const v = run('codex', ['--version']);
    add('Codex CLI', v.status === 0, firstLine(v.stdout) || 'not found', 'Install Codex: `npm install -g @openai/codex` (https://developers.openai.com/codex).');
    if (v.status === 0) {
      const s = run('codex', ['login', 'status']);
      const ok = s.status === 0 || !!process.env.CODEX_API_KEY;
      add('Codex login', ok, ok ? (process.env.CODEX_API_KEY ? 'CODEX_API_KEY' : firstLine(s.stdout || s.stderr) || 'logged in') : 'not logged in',
        'Run `codex login`, or set CODEX_API_KEY.');
    }
  }

  // Platforms
  if (targets.includes('web') && e2e) {
    let chromium = '';
    try {
      const req = createRequire(join(ROOT, 'package.json'));
      chromium = req('playwright').chromium.executablePath();
    } catch { /* playwright not installed */ }
    add('Playwright Chromium (web E2E)', !!chromium && existsSync(chromium), chromium && existsSync(chromium) ? 'installed' : 'missing',
      'Run `npx playwright install chromium`.');
  }
  if (targets.includes('android')) {
    const j = run('java', ['-version']);
    const jv = firstLine(j.stderr || j.stdout);
    const jMajor = Number(jv.match(/version "(\d+)(?:\.(\d+))?/)?.slice(1).find((x, i) => (i === 0 && x !== '1') || i === 1) ?? 0);
    add('JDK >= 17', j.status === 0 && jMajor >= 17, jv || 'not found', 'Install JDK 17+ and put `java` on PATH (or set JAVA_HOME).');
    const sdk = androidSdkDir();
    add('Android SDK', existsSync(sdk), sdk, 'Install Android Studio or the SDK command-line tools, then set ANDROID_HOME.');
    const lp = join(ROOT, 'client', 'local.properties');
    if (existsSync(lp) && !/sdk\.dir=/.test(readFileSync(lp, 'utf8'))) add('client/local.properties', false, 'no sdk.dir', 'Delete it; the harness writes it.', true);
    if (e2e || devices) {
      const adb = run('adb', ['devices']);
      add('adb', adb.status === 0, adb.status === 0 ? 'found' : 'not found', `Add ${join(sdk, 'platform-tools')} to PATH.`);
      if (adb.status === 0 && devices) {
        const list = adb.stdout.split(/\r?\n/).slice(1).filter((l) => /\tdevice$/.test(l)).map((l) => l.split('\t')[0]);
        const serial = process.env.ANDROID_SERIAL;
        if (!list.length) add('Android device', false, 'none connected', 'Start an emulator, e.g. `emulator -avd Pixel_8`, and wait for it to boot.');
        else if (list.length > 1 && !serial) {
          add('Android device', false, `${list.length} connected (${list.join(', ')})`,
            'Pick one: set ANDROID_SERIAL=<serial>, or bind `android@<serial>`. Otherwise adb and Gradle may install on all of them.');
        } else add('Android device', true, serial ?? list[0]);
      }
    }
  }
  if (process.platform === 'win32' && /~\d/.test(process.env.TEMP ?? '')) {
    add('TEMP path', true, '8.3 short path (handled: the harness points Gradle at a long path)', undefined, true);
  }
  return out;
}

/** Prints the result. Returns true when nothing required is missing. */
export function reportPrereqs(results, { title = 'Prerequisites', quietIfOk = false } = {}) {
  const missing = results.filter((r) => !r.ok && !r.warn);
  if (quietIfOk && !missing.length) return true;
  console.log(`${title}:`);
  for (const r of results) {
    const mark = r.ok ? (r.warn ? '!' : '✓') : r.warn ? '!' : '✗';
    console.log(`  ${mark} ${r.name.padEnd(30)} ${r.detail}${!r.ok && r.fix ? `\n      → ${r.fix}` : ''}`);
  }
  if (missing.length) console.log(`\n${missing.length} prerequisite(s) missing. Nothing was run and no tokens were spent.`);
  return !missing.length;
}
