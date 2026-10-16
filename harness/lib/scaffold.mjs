// Scaffold templates (harness/scaffolds/<target>/): bootstrap a project from scratch, re-sync it,
// and detect drift. The template is the single source of truth for every non-generated file.
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { ROOT } from './paths.mjs';
import { isGenerated, isHarnessOutput } from './target.mjs';

const toPosix = (p) => p.split(sep).join('/');
const BINARY = /\.(jar|webp|png|jpg|jpeg|gif|ico)$/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

export function templateDir(target) {
  return join(ROOT, target.scaffold);
}

/** Template files, project-relative posix paths. */
export function templateFiles(target) {
  const dir = templateDir(target);
  return walk(dir).map((abs) => toPosix(relative(dir, abs))).sort();
}

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
/** True if dir is inside a git work tree (normally this repository; a standalone repo in tests). */
const inRepo = (dir) => git(dir, 'rev-parse', '--is-inside-work-tree').stdout.trim() === 'true';

function sameContent(a, b, rel) {
  if (!existsSync(b)) return false;
  const x = readFileSync(a);
  const y = readFileSync(b);
  if (BINARY.test(rel)) return x.equals(y);
  const norm = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n');
  return norm(x) === norm(y);
}

/**
 * Drift between template and project:
 * - `changed`: template files missing or different in the project
 * - `extra`: files tracked by the project's git that are neither template, generated nor harness output
 */
export function scaffoldDrift(target) {
  const tdir = templateDir(target);
  const changed = templateFiles(target).filter((rel) => !sameContent(join(tdir, rel), join(target.projectDir, rel), rel));
  // ls-files run in the project folder lists only that folder, with project-relative paths.
  const tracked = existsSync(target.projectDir) && inRepo(target.projectDir)
    ? git(target.projectDir, 'ls-files').stdout.split('\n').filter(Boolean)
    : [];
  const inTemplate = new Set(templateFiles(target));
  const extra = tracked.filter((p) => !inTemplate.has(p) && !isGenerated(target, p) && !isHarnessOutput(target, p));
  return { changed, extra };
}

/** True when the project has none of its scaffold yet (missing or emptied directory). */
export function needsBootstrap(target) {
  if (!existsSync(target.projectDir)) return true;
  return !templateFiles(target).some((rel) => existsSync(join(target.projectDir, rel)));
}

/** Values usable in `bootstrapFiles` templates, e.g. {ANDROID_SDK}. */
function placeholders() {
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Android', 'Sdk')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Android', 'sdk')
        : join(homedir(), 'Android', 'Sdk'));
  // local.properties is a Java properties file: escape backslashes and the drive colon.
  return { ANDROID_SDK: sdk.replace(/\\/g, '\\\\').replace(/:/g, '\\:') };
}

/**
 * Copies the template into the project (creating it), removes tracked non-template scaffold files,
 * writes machine-local `bootstrapFiles` (never committed), and records the result as a `scaffold:`
 * commit if anything changed. Returns a short description of what happened.
 */
export function applyScaffold(target, { reason }) {
  const tdir = templateDir(target);
  mkdirSync(target.projectDir, { recursive: true });
  if (!inRepo(target.projectDir)) {
    git(target.projectDir, 'init', '-q', '-b', 'main');
  }
  for (const rel of templateFiles(target)) {
    const dst = join(target.projectDir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(tdir, rel), dst);
    if (rel === 'gradlew' || rel.endsWith('.sh')) chmodSync(dst, 0o755);
  }
  const { extra } = scaffoldDrift(target);
  for (const rel of extra) {
    git(target.projectDir, 'rm', '-q', '--cached', '--', rel);
    rmSync(join(target.projectDir, rel), { force: true });
  }
  const vars = placeholders();
  for (const f of target.bootstrapFiles ?? []) {
    const dst = join(target.projectDir, f.path);
    if (!existsSync(dst)) writeFileSync(dst, f.content.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m));
  }

  // Commit only scaffold paths; generated roots are left to the generation run.
  const scaffoldPaths = [...templateFiles(target), ...extra];
  git(target.projectDir, 'add', '-A', '--', ...templateFiles(target));
  const staged = git(target.projectDir, 'diff', '--cached', '--name-only', '--', ...scaffoldPaths).stdout.trim();
  if (!staged) return 'scaffold already matches the template';
  const identity = git(target.projectDir, 'config', 'user.name').stdout.trim()
    ? []
    : ['-c', 'user.name=chatgen-harness', '-c', 'user.email=chatgen-harness@localhost'];
  const r = git(
    target.projectDir,
    ...identity,
    'commit',
    '-q',
    '-m',
    `scaffold: ${reason} from ${target.scaffold}`,
    '-m',
    `Applied verbatim by harness/regen.mjs (${scaffoldPaths.length} paths). The template is the human-owned source of truth.`,
    // Only the scaffold paths: the repository may hold other staged or modified files.
    '--',
    ...scaffoldPaths,
  );
  if (r.status !== 0) throw new Error(`scaffold commit failed: ${r.stderr}`);
  return `committed scaffold (${staged.split('\n').length} files changed)`;
}
