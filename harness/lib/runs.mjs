// Run bookkeeping that keeps regeneration from wasting tokens: one run at a time (lock), skip targets
// already generated from the current spec, and checkpoints that let an interrupted agent step resume.
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS_DIR } from './paths.mjs';

const LOCK = join(RUNS_DIR, '.lock');

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * Takes the single-run lock. Two runs in parallel double the token burn rate and are the usual way a
 * subscription's usage limit is hit mid-run. Returns null on success, or the holder's description.
 */
export function acquireLock(what, lockFile = LOCK) {
  mkdirSync(join(lockFile, '..'), { recursive: true });
  if (existsSync(lockFile)) {
    try {
      const held = JSON.parse(readFileSync(lockFile, 'utf8'));
      if (held.pid !== process.pid && alive(held.pid)) return `pid ${held.pid} (${held.what}, since ${held.started})`;
    } catch { /* unreadable or stale: take it over */ }
  }
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, what, started: new Date().toISOString() }));
  const release = () => {
    try {
      if (JSON.parse(readFileSync(lockFile, 'utf8')).pid === process.pid) rmSync(lockFile, { force: true });
    } catch { /* already gone */ }
  };
  process.on('exit', release);
  return null;
}

/** Status and spec hash recorded in <project>/GENERATED.md by the last harness run, or null. */
export function readStamp(projectDir) {
  const file = join(projectDir, 'GENERATED.md');
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  const hash = text.match(/\| Spec version \/ hash \| [^|]*\/ `([0-9a-f]+)` \|/)?.[1] ?? null;
  return { accepted: /\*\*Status:\*\* ACCEPTED/.test(text), hash };
}

const checkpointFile = (targetId, dir = RUNS_DIR) => join(dir, `resume-${targetId}.json`);

/** Records an interrupted agent step so `--resume` can continue that conversation. */
export function saveCheckpoint(targetId, data, dir = RUNS_DIR) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(checkpointFile(targetId, dir), JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 2));
}

export function loadCheckpoint(targetId, dir = RUNS_DIR) {
  const f = checkpointFile(targetId, dir);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

export function clearCheckpoint(targetId, dir = RUNS_DIR) {
  rmSync(checkpointFile(targetId, dir), { force: true });
}
