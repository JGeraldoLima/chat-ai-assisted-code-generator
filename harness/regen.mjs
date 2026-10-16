#!/usr/bin/env node
// Chat Generator CLI: regenerates a client from spec/ and accepts it only if every gate passes.
//
//   node harness/regen.mjs <target|all> [options]
//
//   --yes            confirm the token spend up front (required when not run from a terminal)
//   --force          regenerate even if the project is already ACCEPTED for the current spec
//   --resume         continue the agent step that was interrupted (usage limit, budget cap) instead of
//                    starting over: same conversation, partial work kept
//   --prepare-only   clean the generated roots and write the spec bundle, then stop (interactive use)
//   --gates-only     don't generate; run the gates (and review) on what's there now
//   --no-clean       generate on top of the existing code (default: clean first)
//   --no-review      skip the spec-conformance review
//   --max-repairs N  repair attempts after failed gates/review (default 3)
//   --sync-scaffold  re-apply harness/scaffolds/<target> to the project and commit it (after editing a template)
//
// Environment: CHATGEN_MODEL (default claude-opus-5-5), CHATGEN_EFFORT (default high),
// CHATGEN_MAX_BUDGET_USD (per agent step; a capped step can be continued with --resume).
// Targets run one at a time, and only one regen.mjs runs at a time (harness/runs/.lock).
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { ROOT, RUNS_DIR } from './lib/paths.mjs';
import { composeBundle } from './lib/spec.mjs';
import { listTargets, loadTarget, cleanGenerated, generatedFiles, isGenerated, isHarnessOutput } from './lib/target.mjs';
import { needsBootstrap, applyScaffold, scaffoldDrift } from './lib/scaffold.mjs';
import { boundaryGate, traceabilityGate, commandGates, changedPaths, runCommand } from './lib/gates.mjs';
import { runAgent, describeEvent, AGENT_DEFAULTS } from './lib/agent.mjs';
import { acquireLock, readStamp, saveCheckpoint, loadCheckpoint, clearCheckpoint } from './lib/runs.mjs';

const HARNESS_VERSION = '1.1.0';

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
  const header = readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1);
  console.log(header.slice(0, header.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  console.log(`Targets: ${listTargets().join(', ')}, all`);
  process.exit(which ? 0 : 2);
}
const options = {
  yes: flag('--yes'),
  force: flag('--force'),
  resume: flag('--resume'),
  prepareOnly: flag('--prepare-only'),
  gatesOnly: flag('--gates-only'),
  clean: !flag('--no-clean') && !flag('--resume'),
  review: !flag('--no-review'),
  maxRepairs: Number(opt('--max-repairs', 3)),
  syncScaffold: flag('--sync-scaffold'),
};

const holder = acquireLock(`regen ${which}`);
if (holder) {
  console.log(`ABORT: another regen.mjs run is active: ${holder}.\n` +
    '  Runs are serialized: parallel runs double the token burn rate and are how usage limits get hit mid-run.');
  process.exit(1);
}

// Plan every target first, so nothing is spent before the user has seen what will run.
const plan = (which === 'all' ? listTargets() : [which]).map((id) => planTarget(loadTarget(id)));
for (const p of plan) console.log(`[${p.target.id}] ${p.note}`);
if (plan.some((p) => p.error)) process.exit(1);
if (plan.some((p) => p.agent) && !(await confirmSpend(plan.filter((p) => p.agent)))) process.exit(1);

let failed = 0;
for (const [i, p] of plan.entries()) {
  if (p.skip) continue;
  const outcome = await regenerate(p);
  if (outcome !== 'ok') failed++;
  const rest = plan.slice(i + 1).filter((q) => !q.skip).map((q) => q.target.id);
  if (outcome === 'limited' && rest.length) {
    console.log(`Not starting ${rest.join(', ')}: the usage limit would stop it too. Run it after the limit resets.`);
    failed += rest.length;
    break;
  }
}
process.exit(failed ? 1 : 0);

// ---- planning ------------------------------------------------------------------------
/** Decides what a target needs: nothing (up to date), a resume, gates only, or a full generation. */
function planTarget(target) {
  const bundle = composeBundle(target.id);
  const base = { target, bundle };
  if (options.prepareOnly) return { ...base, note: 'prepare only (no agent)' };
  if (options.resume) {
    const cp = loadCheckpoint(target.id);
    if (!cp) return { ...base, error: true, note: 'ABORT: --resume, but there is no interrupted run to resume.' };
    if (cp.specHash !== bundle.shortHash) {
      return { ...base, error: true, note: `ABORT: --resume, but the spec changed since the interrupted run (${cp.specHash} → ${bundle.shortHash}). Run without --resume.` };
    }
    return { ...base, agent: 'resume', checkpoint: cp, note: `resume the interrupted ${cp.label} step (session ${cp.sessionId.slice(0, 8)}, from ${cp.savedAt})` };
  }
  if (options.gatesOnly) {
    return { ...base, agent: options.review ? 'review' : null, note: `gates${options.review ? ' + review' : ''} on the current code` };
  }
  const stamp = readStamp(target.projectDir);
  const upToDate = !options.force && !options.syncScaffold && stamp?.accepted && stamp.hash === bundle.shortHash &&
    !needsBootstrap(target) && !changedPaths(target.projectDir).some((p) => isGenerated(target, p));
  if (upToDate) {
    return { ...base, skip: true, note: `up to date: ${target.project}/ is ACCEPTED for spec ${bundle.shortHash}. Nothing to do (--force regenerates anyway).` };
  }
  const why = !stamp ? 'never generated' : stamp.hash !== bundle.shortHash ? `spec changed (${stamp.hash} → ${bundle.shortHash})` : 'forced or not accepted';
  return { ...base, agent: 'generate', note: `${options.clean ? 'clean ' : ''}generation: ${why}` };
}

/** Shows what the run costs and asks before spending tokens. */
async function confirmSpend(runs) {
  console.log(`\nThis runs Claude Code headless (model ${AGENT_DEFAULTS.model}, effort ${AGENT_DEFAULTS.effort}):`);
  for (const p of runs) {
    const e = p.target.estimate;
    const cost =
      p.agent === 'generate' ? (e ? `≈ $${e.usd} in tokens, ${e.minutes} min (measured, incl. review)` : 'cost not measured yet')
      : p.agent === 'review' ? '≈ $1-2 in tokens (review only)'
      : 'less than a full run (continues the interrupted conversation)';
    console.log(`  ${p.target.id.padEnd(8)} ${p.agent.padEnd(9)} ${cost}`);
  }
  console.log([
    '  These are Claude Code token-cost estimates. With ANTHROPIC_API_KEY they are billed. With a Claude',
    '  subscription they count against your plan\'s usage limits, and a full android run may not fit in one',
    '  Pro usage window. If a limit or CHATGEN_MAX_BUDGET_USD stops a step, nothing is lost: re-run with --resume.',
    '  You do not need to regenerate to use the app: the generated clients are committed.',
  ].join('\n'));
  if (options.yes) return true;
  if (!process.stdin.isTTY) {
    console.log('ABORT: not running in a terminal, so I cannot ask. Re-run with --yes to confirm the spend.');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Continue? [y/N] ');
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

// ---- pipeline ------------------------------------------------------------------------
/** @returns {Promise<'ok' | 'failed' | 'limited'>} */
async function regenerate({ target, bundle, checkpoint }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(RUNS_DIR, `${stamp}-${target.id}`);
  mkdirSync(runDir, { recursive: true });
  const say = (msg) => console.log(`[${target.id}] ${msg}`);
  const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
  const resumeHint = `node harness/regen.mjs ${target.id} --resume --yes`;

  // 1. Spec bundle
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
        return 'failed';
      }
    }
  }

  // Preflight: scaffold must be committed (the boundary gate compares against HEAD).
  const dirtyScaffold = changedPaths(target.projectDir).filter((p) => !isGenerated(target, p) && !isHarnessOutput(target, p));
  if (dirtyScaffold.length) {
    say(`ABORT: uncommitted scaffold changes in ${target.project}/ (commit them first):\n  ${dirtyScaffold.join('\n  ')}`);
    return 'failed';
  }
  for (const cmd of target.setup ?? []) {
    say(`setup: ${cmd.join(' ')}`);
    const r = await runCommand(cmd, { cwd: target.projectDir, logFile: join(runDir, 'setup.log') });
    if (!r.ok) {
      say(`ABORT: setup failed\n${r.tail}`);
      return 'failed';
    }
  }

  // 3. Clean
  if (!options.gatesOnly && options.clean) {
    const n = cleanGenerated(target);
    say(`cleaned ${n} generated files under ${vars.generatedRoots}`);
  }
  if (options.prepareOnly) {
    say(`prepared. Now generate (e.g. /generate-client ${target.id}), then run: node harness/regen.mjs ${target.id} --gates-only`);
    return 'ok';
  }

  // 4. Generate (or continue the interrupted generate/repair conversation)
  const meta = { attempts: [], review: null, costUsd: 0 };
  let attempt = 0;
  if (checkpoint && checkpoint.label !== 'review') {
    say(`resuming the interrupted ${checkpoint.label} step…`);
    const r = await agentStep(fill(read('harness/prompts/resume.md'), vars), `${checkpoint.label}-resumed`, checkpoint);
    if (!r.ok) return stopped(r, checkpoint.label);
    attempt = Number(checkpoint.label.match(/^repair-(\d+)$/)?.[1] ?? 0);
  } else if (!options.gatesOnly && !checkpoint) {
    say(`generating with ${AGENT_DEFAULTS.model} (effort ${AGENT_DEFAULTS.effort})…`);
    const r = await agentStep(fill(read('harness/prompts/generate.md'), vars), 'generate');
    writeFileSync(join(runDir, 'generate-summary.md'), r.result ?? '');
    if (!r.ok) return stopped(r, 'generate');
  }

  // 5. Gates → repair loop (→ review → repair loop)
  let reviewed = !options.review;
  while (true) {
    const results = await runGates(target, bundle, runDir, attempt);
    meta.attempts.push(results);
    const failures = results.filter((g) => !g.ok);
    let failureText = failures.map((g) => `### Gate \`${g.name}\` failed\n\n\`\`\`\n${g.tail}\n\`\`\``).join('\n\n');

    if (!failures.length && !reviewed) {
      say('gates green; running spec-conformance review…');
      const r = await agentStep(fill(read('harness/prompts/review.md'), vars), 'review');
      const m = String(r.result).match(/violations=(\d+)\s+unclear=(\d+)\s+ok=(\d+)/);
      if (!m && (r.rateLimited || !r.ok)) {
        // Never accept without a review: an interrupted review is redone (it is cheap), not skipped.
        writeStamp(target, bundle, meta, false);
        say(`ABORT: the review did not finish${r.rateLimited ? ' (usage limit)' : ''}: ${String(r.result).slice(0, 200)}\n` +
          `  The generated code is kept. Finish with: node harness/regen.mjs ${target.id} --gates-only --yes`);
        return r.rateLimited ? 'limited' : 'failed';
      }
      reviewed = true;
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
      return 'failed';
    }
    attempt++;
    say(`repair attempt ${attempt}/${options.maxRepairs}…`);
    const r = await agentStep(fill(read('harness/prompts/repair.md'), { ...vars, attempt: String(attempt), failures: failureText }), `repair-${attempt}`);
    if (!r.ok && (r.rateLimited || r.budgetCapped)) {
      writeStamp(target, bundle, meta, false);
      return stopped(r, `repair-${attempt}`);
    }
    if (!r.ok) say(`repair agent exited with ${r.code}; re-running gates anyway`);
    if (options.review && meta.review?.violations > 0) reviewed = false; // re-review after fixing violations
  }

  writeStamp(target, bundle, meta, true);
  clearCheckpoint(target.id);
  say(`ACCEPTED. ${generatedFiles(target).length} generated files. Run log: ${toRel(runDir)} · agent cost this run: $${meta.costUsd.toFixed(2)}`);
  say(`commit suggestion (review the diff first):\n  git add -A -- ${target.project} && git commit -m "gen(${target.id}): regenerate from spec ${bundle.shortHash}" -m "Generated-by: chatgen-harness ${HARNESS_VERSION} (${AGENT_DEFAULTS.model}) spec@${bundle.shortHash}" -- ${target.project}`);
  return 'ok';

  /** An agent step stopped early. Its conversation was checkpointed, so say how to continue it. */
  function stopped(r, label) {
    const why = r.rateLimited ? 'Claude usage limit reached' : r.budgetCapped ? 'CHATGEN_MAX_BUDGET_USD reached' : `agent stopped (exit ${r.code})`;
    say(`ABORT: ${why} during ${label}: ${String(r.result).slice(0, 300)}`);
    if (r.sessionId) {
      say(`Nothing is lost: the conversation and the partial output are kept. When you are ready (after the limit resets):\n  ${resumeHint}`);
    }
    return r.rateLimited ? 'limited' : 'failed';
  }

  async function agentStep(prompt, label, resumeFrom) {
    const started = Date.now();
    const r = await runAgent(prompt, {
      logFile: join(runDir, `agent-${label}.jsonl`),
      label,
      target: target.id,
      resume: resumeFrom?.sessionId,
      onEvent: (ev) => {
        const d = describeEvent(ev);
        if (d) console.log(`[${target.id}:${label}] ${d}`);
      },
    });
    meta.costUsd += r.costUsd ?? 0;
    say(`${label}: ${r.ok ? 'done' : 'error'} in ${Math.round((Date.now() - started) / 1000)}s, ${r.turns ?? '?'} turns, $${(r.costUsd ?? 0).toFixed(2)}`);
    const stepLabel = resumeFrom?.label ?? label;
    if (!r.ok && r.sessionId && stepLabel !== 'review') {
      saveCheckpoint(target.id, { label: stepLabel, sessionId: r.sessionId, specHash: bundle.shortHash, runDir: toRel(runDir) });
    } else if (r.ok && resumeFrom) {
      clearCheckpoint(target.id);
    }
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
  // Last commit touching the given folder (the repo root for the harness, the project folder for its scaffold).
  const rev = (cwd) => spawnSync('git', ['log', '-1', '--format=%h', '--', '.'], { cwd, encoding: 'utf8' }).stdout.trim();
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
    `| Agent cost (this run) | $${meta.costUsd.toFixed(2)} (Claude Code token-cost estimate) |`,
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
