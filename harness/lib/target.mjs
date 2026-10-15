// Target descriptors (harness/targets/*.json) and the regeneration boundary.
import { readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ROOT } from './paths.mjs';

export function listTargets() {
  return readdirSync(join(ROOT, 'harness', 'targets'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

export function loadTarget(id) {
  const file = join(ROOT, 'harness', 'targets', `${id}.json`);
  if (!existsSync(file)) throw new Error(`Unknown target "${id}". Known: ${listTargets().join(', ')}`);
  const t = JSON.parse(readFileSync(file, 'utf8'));
  t.projectDir = join(ROOT, t.project);
  return t;
}

const toPosix = (p) => p.split(sep).join('/');

/** True if a project-relative path is inside the generated boundary (include prefixes minus exclude prefixes). */
export function isGenerated(target, relPath) {
  const p = toPosix(relPath);
  return target.generated.include.some((i) => p.startsWith(i)) && !target.generated.exclude.some((e) => p.startsWith(e));
}

/** Paths the harness itself writes (stamps/reports) at the project root. */
export function isHarnessOutput(target, relPath) {
  return (target.harnessOutputs ?? []).includes(toPosix(relPath));
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

/** All files currently inside the generated boundary, project-relative (posix). */
export function generatedFiles(target) {
  const files = [];
  for (const inc of target.generated.include) {
    for (const abs of walk(join(target.projectDir, inc))) {
      const rel = toPosix(relative(target.projectDir, abs));
      if (isGenerated(target, rel)) files.push(rel);
    }
  }
  return files.sort();
}

/** Deletes every generated file (and harness outputs). Excluded subtrees (e.g. android ui/theme) survive. */
export function cleanGenerated(target) {
  const files = generatedFiles(target);
  for (const rel of files) rmSync(join(target.projectDir, rel), { force: true });
  for (const out of target.harnessOutputs ?? []) rmSync(join(target.projectDir, out), { force: true });
  // Remove now-empty directories under the include roots (keep the roots themselves).
  const pruneEmpty = (dir, keep) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) pruneEmpty(abs, false);
    }
    if (!keep && readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
  };
  for (const inc of target.generated.include) pruneEmpty(join(target.projectDir, inc), true);
  return files.length;
}

/**
 * Resolves command placeholders for the current OS. `{gradlew}` becomes an *absolute* path to the
 * project's wrapper: Claude Code (and hardened shells) set NoDefaultCurrentDirectoryInExePath, so
 * Windows cmd will not run `gradlew.bat` from the working directory by bare name.
 */
export function resolveCmd(cmd, projectDir) {
  return cmd.map((c) =>
    c === '{gradlew}' ? join(projectDir ?? '.', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew') : c,
  );
}
