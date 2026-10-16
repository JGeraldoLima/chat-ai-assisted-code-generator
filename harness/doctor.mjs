#!/usr/bin/env node
// Checks what this machine needs, before you run anything.
//
//   node harness/doctor.mjs [web|android|all] [--agent claude|codex] [--no-agent] [--e2e]
//
// Default: all targets, the selected agent (CHATGEN_AGENT, default claude), E2E tooling, connected device.
import { checkPrereqs, reportPrereqs, selectedAgent } from './lib/doctor.mjs';

const argv = process.argv.slice(2);
const which = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--agent') ?? 'all';
const targets = which === 'all' ? ['web', 'android'] : [which];
const agent = argv.includes('--no-agent') ? null : selectedAgent(argv);
const ok = reportPrereqs(checkPrereqs({ targets, agent, e2e: true, devices: targets.includes('android') }), {
  title: `Prerequisites (${targets.join(' + ')}${agent ? `, agent ${agent}` : ''}, E2E)`,
});
if (ok) console.log('\nAll set.');
process.exit(ok ? 0 : 1);
