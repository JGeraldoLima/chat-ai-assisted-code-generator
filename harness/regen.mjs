#!/usr/bin/env node
// Chat Generator CLI: regenerates a client from spec/ and accepts it only if every gate passes.
//
//   node harness/regen.mjs <target|all> [options]
//
//   --prepare-only   clean the generated roots and write the spec bundle, then stop (interactive use)
//   --gates-only     don't generate; run the gates (and review) on what's there now
//   --no-clean       generate on top of the existing code (default: clean first)
//   --no-review      skip the spec-conformance review
//   --max-repairs N  repair attempts after failed gates/review (default 3)
//   --sync-scaffold  re-apply harness/scaffolds/<target> to the project and commit it (after editing a template)
//
// Environment: CHATGEN_MODEL (default claude-opus-5-5), CHATGEN_EFFORT (default high), CHATGEN_MAX_BUDGET_USD.
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, RUNS_DIR } from './lib/paths.mjs';
import { composeBundle } from './lib/spec.mjs';
import { listTargets, loadTarget, cleanGenerated, generatedFiles, isGenerated, isHarnessOutput } from './lib/target.mjs';
import { needsBootstrap, applyScaffold, scaffoldDrift } from './lib/scaffold.mjs';
import { boundaryGate, traceabilityGate, commandGates, changedPaths, runCommand } from './lib/gates.mjs';
import { runAgent, describeEvent, AGENT_DEFAULTS } from './lib/agent.mjs';

const HARNESS_VERSION = '1.0.0';

// ---- CLI -----------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] === '--max-repairs'));
const which = positional[0];
if (!which || flag('--help')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  console.log(`Targets: ${listTargets().join(', ')}, all`);
  process.exit(which ? 0 : 2);
}
const options = {
  prepareOnly: flag('--prepare-only'),
  gatesOnly: flag('--gates-only'),
  clean: !flag('--no-clean'),
  review: !flag('--no-review'),
  maxRepairs: Number(opt('--max-repairs', 3)),
  syncScaffold: flag('--sync-scaffold'),
};

const targets = which === 'all' ? listTargets() : [which];
let failed = 0;
for (const id of targets) {
  const ok = await regenerate(loadTarget(id));
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);

// ---- pipeline ------------------------------------------------------------------------
async function regenerate(target) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(RUNS_DIR, `${stamp}-${target.id}`);
  mkdirSync(runDir, { recursive: true });
  const say = (msg) => console.log(`[${target.id}] ${msg}`);
  const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);

  // 1. Spec bundle
  const bundle = composeBundle(target.id);
  const bundlePath = join(runDir, 'spec-bundle.md');
  writeFileSync(bundlePath, bundle.text);
  const latest = join(RUNS_DIR, `latest-${target.id}`);
  rmSync(latest, { recursive: true, force: true });
  cpSync(runDir, latest, { recursive: true });
  const vars = {
    target: target.id,
    project: target.project,
    generatedRoots: target.generated.include.map((r) => `\`${target.project}/${r}\``).join(', ') +
      (target.generated.exclude.length ? ` (except ${target.generated.exclude.map((e) => `\`${target.project}/${e}\``).join(', ')})` : ''),
    specHash: bundle.shortHash,
    bundlePath: toRel(join(latest, 'spec-bundle.md')),
  };
  say(`spec ${bundle.manifest.specVersion} · hash ${bundle.shortHash} · ${bundle.files.length} files → ${toRel(bundlePath)}`);

  // 2. Scaffold: bootstrap a project from scratch, or re-sync it, from harness/scaffolds/<target>.
  if (target.scaffold) {
    if (needsBootstrap(target)) {
      say(`${target.project}/ has no scaffold: bootstrapping from ${target.scaffold}`);
      say(applyScaffold(target, { reason: 'bootstrap' }));
    } else if (options.syncScaffold) {
      say(applyScaffold(target, { reason: 'sync' }));
    } else {
      const { changed, extra } = scaffoldDrift(target);
      if (changed.length || extra.length) {
        say(`ABORT: ${target.project}/ scaffold differs from ${target.scaffold}:\n  ${[...changed, ...extra.map((e) => `${e} (not in template)`)].join('\n  ')}\n` +
          '  Edit the template (it is the source of truth) and re-run with --sync-scaffold.');
        return false;
      }
    }
  }

  // Preflight: scaffold must be committed (the boundary gate compares against HEAD).
  const dirtyScaffold = changedPaths(target.projectDir).filter((p) => !isGenerated(target, p) && !isHarnessOutput(target, p));
  if (dirtyScaffold.length) {
    say(`ABORT: uncommitted scaffold changes in ${target.project}/ (commit them first):\n  ${dirtyScaffold.join('\n  ')}`);
    return false;
  }
  for (const cmd of target.setup ?? []) {
    say(`setup: ${cmd.join(' ')}`);
    const r = await runCommand(cmd, { cwd: target.projectDir, logFile: join(runDir, 'setup.log') });
    if (!r.ok) {
      say(`ABORT: setup failed\n${r.tail}`);
      return false;
    }
  }

  // 3. Clean
  if (!options.gatesOnly && options.clean) {
    const n = cleanGenerated(target);
    say(`cleaned ${n} generated files under ${vars.generatedRoots}`);
  }
  if (options.prepareOnly) {
    say(`prepared. Now generate (e.g. /generate-client ${target.id}), then run: node harness/regen.mjs ${target.id} --gates-only`);
    return true;
  }

  // 4. Generate
  const meta = { attempts: [], review: null, costUsd: 0 };
  if (!options.gatesOnly) {
    say(`generating with ${AGENT_DEFAULTS.model} (effort ${AGENT_DEFAULTS.effort})…`);
    const r = await agentStep(fill(read('harness/prompts/generate.md'), vars), 'generate');
    writeFileSync(join(runDir, 'generate-summary.md'), r.result ?? '');
    if (!r.ok) {
      if (r.rateLimited) say('ABORT: Claude usage limit reached. Re-run after it resets (add --no-clean to keep the partial output).');
      say(`generator failed (exit ${r.code}): ${String(r.result).slice(0, 500)}`);
      return false;
    }
  }

  // 5. Gates → repair loop (→ review → repair loop)
  let attempt = 0;
  let reviewed = !options.review;
  while (true) {
    const results = await runGates(target, bundle, runDir, attempt);
    meta.attempts.push(results);
    const failures = results.filter((g) => !g.ok);
    let failureText = failures.map((g) => `### Gate \`${g.name}\` failed\n\n\`\`\`\n${g.tail}\n\`\`\``).join('\n\n');

    if (!failures.length && !reviewed) {
      say('gates green; running spec-conformance review…');
      const r = await agentStep(fill(read('harness/prompts/review.md'), vars), 'review');
      reviewed = true;
      const m = String(r.result).match(/violations=(\d+)\s+unclear=(\d+)\s+ok=(\d+)/);
      meta.review = m ? { violations: +m[1], unclear: +m[2], ok: +m[3] } : { raw: String(r.result).slice(0, 200) };
      say(`review: ${m ? m[0] : 'no summary line'}`);
      if (m && +m[1] > 0) {
        const report = existsSync(join(target.projectDir, 'CONFORMANCE.md')) ? read(join(target.project, 'CONFORMANCE.md')) : '';
        failureText = `### Spec-conformance review found ${m[1]} violation(s)\n\nFull report: \`${target.project}/CONFORMANCE.md\`. Fix every row marked **violation**:\n\n${report.slice(0, 12000)}`;
      }
    }

    if (!failureText) break;
    if (attempt >= options.maxRepairs) {
      say(`FAILED after ${attempt} repair attempt(s). See ${toRel(runDir)}`);
      writeStamp(target, bundle, meta, false);
      return false;
    }
    attempt++;
    say(`repair attempt ${attempt}/${options.maxRepairs}…`);
    const r = await agentStep(fill(read('harness/prompts/repair.md'), { ...vars, attempt: String(attempt), failures: failureText }), `repair-${attempt}`);
    if (r.rateLimited) {
      say(`ABORT: Claude usage limit reached during repair: ${String(r.result).slice(0, 200)}
  Re-run later with: node harness/regen.mjs ${target.id} --no-clean`);
      writeStamp(target, bundle, meta, false);
      return false;
    }
    if (!r.ok) say(`repair agent exited with ${r.code}; re-running gates anyway`);
    if (options.review && meta.review?.violations > 0) reviewed = false; // re-review after fixing violations
  }

  writeStamp(target, bundle, meta, true);
  say(`ACCEPTED. ${generatedFiles(target).length} generated files. Run log: ${toRel(runDir)}`);
  say(`commit suggestion (review the diff first):\n  git -C ${target.project} add -A && git -C ${target.project} commit -m "gen(${target.id}): regenerate from spec ${bundle.shortHash}" -m "Generated-by: chatgen-harness ${HARNESS_VERSION} (${AGENT_DEFAULTS.model}) spec@${bundle.shortHash}"`);
  return true;

  async function agentStep(prompt, label) {
    const started = Date.now();
    const r = await runAgent(prompt, {
      logFile: join(runDir, `agent-${label}.jsonl`),
      label,
      target: target.id,
      onEvent: (ev) => {
        const d = describeEvent(ev);
        if (d) console.log(`[${target.id}:${label}] ${d}`);
      },
    });
    meta.costUsd += r.costUsd ?? 0;
    say(`${label}: ${r.ok ? 'done' : 'error'} in ${Math.round((Date.now() - started) / 1000)}s, ${r.turns ?? '?'} turns, $${(r.costUsd ?? 0).toFixed(2)}`);
    return r;
  }
}

async function runGates(target, bundle, runDir, attempt) {
  const say = (msg) => console.log(`[${target.id}] ${msg}`);
  const results = [boundaryGate(target), traceabilityGate(target, bundle)];
  results.push(...(await commandGates(target, runDir, attempt)));
  for (const g of results) say(`gate ${g.name.padEnd(13)} ${g.ok ? 'PASS' : 'FAIL'}${g.ms ? ` (${Math.round(g.ms / 1000)}s)` : ''}${g.ok ? '' : `\n${indent(g.tail)}`}`);
  return results;
}

function writeStamp(target, bundle, meta, accepted) {
  const rev = (cwd) => spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' }).stdout.trim();
  const last = meta.attempts.at(-1) ?? [];
  const lines = [
    '<!-- @generated by chatgen-harness. Do not edit; regenerate instead. -->',
    `# Generated code: ${target.id}`,
    '',
    `**Status:** ${accepted ? 'ACCEPTED (all gates passed)' : 'REJECTED (gates failing)'}`,
    '',
    '| Field | Value |',
    '|---|---|',
    `| Regeneration boundary | ${target.generated.include.map((r) => `\`${r}\``).join(', ')}${target.generated.exclude.length ? ` minus ${target.generated.exclude.map((r) => `\`${r}\``).join(', ')}` : ''} |`,
    `| Spec version / hash | ${bundle.manifest.specVersion} / \`${bundle.shortHash}\` |`,
    `| Spec files | ${bundle.files.length} (see \`spec/manifest.yaml\`) |`,
    `| Harness | chatgen-harness ${HARNESS_VERSION} @ root \`${rev(ROOT)}\` |`,
    `| Scaffold commit | \`${rev(target.projectDir)}\` |`,
    `| Agent | Claude Code, model \`${AGENT_DEFAULTS.model}\`, effort \`${AGENT_DEFAULTS.effort}\` |`,
    `| Repair attempts | ${Math.max(0, meta.attempts.length - 1)} |`,
    `| Review | ${meta.review ? (meta.review.raw ?? `violations=${meta.review.violations} unclear=${meta.review.unclear} ok=${meta.review.ok}`) : 'skipped'} |`,
    `| Gates (last run) | ${last.map((g) => `${g.name} ${g.ok ? '✅' : '❌'}`).join(' · ')} |`,
    `| Generated at | ${new Date().toISOString()} |`,
    '',
    'To regenerate: `node harness/regen.mjs ' + target.id + '` from the repo root (see root README).',
    '',
  ];
  writeFileSync(join(target.projectDir, 'GENERATED.md'), lines.join('\n'));
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}
function toRel(abs) {
  return relative(ROOT, abs).split('\\').join('/');
}
function indent(s) {
  return String(s).split('\n').map((l) => `    ${l}`).join('\n');
}
