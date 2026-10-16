// Self-tests for the harness: boundary rules, the edit-guard hook, spec composition and traceability parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../lib/paths.mjs';
import { loadTarget, isGenerated, isHarnessOutput, listTargets } from '../lib/target.mjs';
import { composeBundle, extractRequirements, scenarioCoverage } from '../lib/spec.mjs';

test('every target descriptor loads and has a platform profile in the manifest', () => {
  const { manifest } = composeBundle('web');
  assert.deepEqual(listTargets(), Object.keys(manifest.targets).sort());
  for (const id of listTargets()) {
    const t = loadTarget(id);
    assert.ok(t.generated.include.length > 0, id);
    assert.ok(new RegExp(t.tests.pattern), id);
  }
});

test('boundary: android theme is excluded, sources and tests are included, scaffold is not', () => {
  const a = loadTarget('android');
  assert.equal(isGenerated(a, 'app/src/main/java/com/example/chatclient/MainActivity.kt'), true);
  assert.equal(isGenerated(a, 'app/src/main/java/com/example/chatclient/data/sync/SyncEngine.kt'), true);
  assert.equal(isGenerated(a, 'app/src/test/java/com/example/chatclient/SyncEngineTest.kt'), true);
  assert.equal(isGenerated(a, 'app/src/main/java/com/example/chatclient/ui/theme/Theme.kt'), false);
  assert.equal(isGenerated(a, 'app/src/main/AndroidManifest.xml'), false);
  assert.equal(isGenerated(a, 'app/build.gradle.kts'), false);
  assert.equal(isHarnessOutput(a, 'GENERATED.md'), true);

  const w = loadTarget('web');
  assert.equal(isGenerated(w, 'src/App.tsx'), true);
  assert.equal(isGenerated(w, 'package.json'), false);
  assert.equal(isGenerated(w, 'index.html'), false);
});

function hook(target, filePath) {
  try {
    execFileSync(process.execPath, [join(ROOT, '.claude', 'hooks', 'guard-boundary.mjs')], {
      input: JSON.stringify({ tool_input: { file_path: filePath } }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, ...(target ? { CHATGEN_GENERATING: target } : {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 0;
  } catch (e) {
    return e.status;
  }
}

test('guard hook blocks edits outside the boundary only during harness runs', () => {
  const pkg = join(ROOT, 'client', 'app', 'src', 'main', 'java', 'com', 'example', 'chatclient');
  assert.equal(hook('web', 'webclient/src/App.tsx'), 0);
  assert.equal(hook('web', join(ROOT, 'webclient', 'src', 'data', 'api.ts')), 0);
  assert.equal(hook('web', 'webclient/package.json'), 2);
  assert.equal(hook('web', 'spec/core/50-ui.md'), 2);
  assert.equal(hook('web', 'client/app/src/main/java/com/example/chatclient/MainActivity.kt'), 2, 'other target');
  assert.equal(hook('web', 'webclient/CONFORMANCE.md'), 0, 'reviewer report');
  assert.equal(hook('web', 'harness/runs/latest-web/notes.md'), 0, 'scratch');
  assert.equal(hook('android', join(pkg, 'data', 'remote', 'ChatApi.kt')), 0);
  assert.equal(hook('android', join(pkg, 'ui', 'theme', 'Color.kt')), 2, 'theme is scaffold');
  assert.equal(hook('android', join(ROOT, 'client', 'app', 'build.gradle.kts')), 2);
  assert.equal(hook(null, 'spec/core/50-ui.md'), 0, 'humans are not restricted');
});

test('scaffold bootstrap: an empty directory becomes a committed project equal to the template', async () => {
  const { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const { needsBootstrap, applyScaffold, scaffoldDrift, templateFiles } = await import('../lib/scaffold.mjs');
  for (const id of listTargets()) {
    const target = { ...loadTarget(id), projectDir: mkdtempSync(join(tmpdir(), `chatgen-${id}-`)) };
    try {
      assert.equal(needsBootstrap(target), true, `${id}: empty dir needs bootstrap`);
      const msg = applyScaffold(target, { reason: 'bootstrap' });
      assert.match(msg, /committed scaffold/, id);
      assert.equal(needsBootstrap(target), false);
      assert.deepEqual(scaffoldDrift(target), { changed: [], extra: [] }, `${id}: no drift right after bootstrap`);
      const log = spawnSync('git', ['log', '--format=%s'], { cwd: target.projectDir, encoding: 'utf8' }).stdout;
      assert.match(log, /^scaffold: bootstrap from harness\/scaffolds\//, id);
      for (const f of target.bootstrapFiles ?? []) {
        assert.ok(existsSync(join(target.projectDir, f.path)), `${id}: ${f.path} written`);
        assert.doesNotMatch(readFileSync(join(target.projectDir, f.path), 'utf8'), /\{ANDROID_SDK\}/);
      }
      assert.match(applyScaffold(target, { reason: 'sync' }), /already matches/, `${id}: re-sync is a no-op`);

      // Drift: editing a template-owned file or committing a stray file is detected.
      const first = templateFiles(target).find((f) => /\.(json|kts|toml|md)$/.test(f));
      writeFileSync(join(target.projectDir, first), 'tampered\n');
      writeFileSync(join(target.projectDir, 'stray.txt'), 'x');
      spawnSync('git', ['add', 'stray.txt'], { cwd: target.projectDir });
      const drift = scaffoldDrift(target);
      assert.deepEqual(drift.changed, [first]);
      assert.deepEqual(drift.extra, ['stray.txt']);
    } finally {
      rmSync(target.projectDir, { recursive: true, force: true });
    }
  }
});

test('gate commands resolve the Gradle wrapper to an absolute path', async () => {
  const { resolveCmd } = await import('../lib/target.mjs');
  const [bin] = resolveCmd(['{gradlew}', 'assembleDebug'], join(ROOT, 'client'));
  assert.equal(bin, join(ROOT, 'client', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'));
});

test('spec composition is deterministic and per-target', () => {
  const a = composeBundle('web');
  const b = composeBundle('web');
  const c = composeBundle('android');
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, c.hash, 'platform profile is part of the bundle');
  assert.ok(a.files.includes('spec/platforms/web.md'));
  assert.ok(!a.files.includes('spec/platforms/android.md'));
  assert.ok(!a.files.some((f) => f.includes('features/reactions')), 'draft features are not composed');
});

test('requirement extraction: unique ids, known tags, every [ui] requirement covered by a scenario', () => {
  const reqs = extractRequirements(composeBundle('web').text);
  const ids = reqs.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'requirement ids are unique');
  for (const r of reqs) for (const t of r.tags) assert.ok(['client', 'ui', 'server'].includes(t), `${r.id} tag ${t}`);
  const coverage = scenarioCoverage();
  const known = new Set(ids);
  for (const id of coverage.keys()) assert.ok(known.has(id), `scenario covers unknown requirement ${id}`);
  const uncovered = reqs.filter((r) => r.tags.includes('ui') && !coverage.has(r.id)).map((r) => r.id);
  assert.deepEqual(uncovered, []);
});

test('boundary in the one repository: changedPaths sees only the project folder, project-relative', async () => {
  const { writeFileSync, rmSync } = await import('node:fs');
  const { changedPaths } = await import('../lib/gates.mjs');
  const inside = join(ROOT, 'webclient', 'src', '.chatgen-selftest.tmp');
  const outside = join(ROOT, '.chatgen-selftest.tmp');
  try {
    writeFileSync(inside, 'x');
    writeFileSync(outside, 'x');
    const paths = changedPaths(join(ROOT, 'webclient'));
    assert.ok(paths.includes('src/.chatgen-selftest.tmp'), 'project-relative path of a change inside the project');
    assert.ok(!paths.some((p) => p.includes('..') || p === '.chatgen-selftest.tmp'), 'changes outside the project are not reported');
  } finally {
    rmSync(inside, { force: true });
    rmSync(outside, { force: true });
  }
});

test('token guards: stamp parsing, single-run lock, resume checkpoints, usage-limit detection', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { readStamp, acquireLock, saveCheckpoint, loadCheckpoint, clearCheckpoint } = await import('../lib/runs.mjs');
  const { isLimitMessage } = await import('../lib/agent.mjs');
  for (const id of listTargets()) {
    const s = readStamp(loadTarget(id).projectDir);
    assert.ok(s && /^[0-9a-f]{12}$/.test(s.hash), `${id}: GENERATED.md has a spec hash`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'chatgen-runs-'));
  try {
    const lock = join(dir, '.lock');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, what: 'other run', started: 'now' }));
    assert.match(acquireLock('test', lock) ?? '', /other run/, 'a live holder blocks a second run');
    writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, what: 'dead run', started: 'then' }));
    assert.equal(acquireLock('test', lock), null, 'a stale lock is taken over');

    assert.equal(loadCheckpoint('web', dir), null);
    saveCheckpoint('web', { label: 'generate', sessionId: 'abc', specHash: '0123456789ab' }, dir);
    assert.equal(loadCheckpoint('web', dir).sessionId, 'abc');
    clearCheckpoint('web', dir);
    assert.equal(loadCheckpoint('web', dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(isLimitMessage("You've hit your session limit · resets 1am (America/Sao_Paulo)"));
  assert.ok(!isLimitMessage('violations=0 unclear=1 ok=48'));
});
