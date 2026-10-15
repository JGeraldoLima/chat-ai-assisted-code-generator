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
