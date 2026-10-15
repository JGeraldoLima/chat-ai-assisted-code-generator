// Runs the coding agent (Claude Code, headless) with a pinned, project-scoped configuration.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { ROOT, childEnv } from './paths.mjs';

export const AGENT_DEFAULTS = {
  model: process.env.CHATGEN_MODEL ?? 'claude-opus-5-5',
  effort: process.env.CHATGEN_EFFORT ?? 'high',
  maxBudgetUsd: process.env.CHATGEN_MAX_BUDGET_USD,
};

/**
 * Runs `claude -p <prompt>` from the repo root.
 * - Only project settings are loaded (`--setting-sources project`) and no user MCP servers, so a run
 *   on another machine sees the same permissions, skills and agents (.claude/ in this repo).
 * - Edits are auto-accepted; Bash is limited to the allow/deny profile in harness/agent-settings.json.
 * - The edit-guard hook (.claude/hooks/guard-boundary.mjs) blocks writes outside the target's boundary.
 * - The full event stream is saved to `logFile` (JSONL) for audit.
 * @returns {Promise<{ok: boolean, code: number, result: string, costUsd?: number, turns?: number}>}
 */
export function runAgent(prompt, { logFile, label = 'agent', onEvent, target } = {}) {
  const args = [
    '-p', prompt,
    '--model', AGENT_DEFAULTS.model,
    '--effort', AGENT_DEFAULTS.effort,
    '--permission-mode', 'acceptEdits',
    '--setting-sources', 'project',
    '--settings', join(ROOT, 'harness', 'agent-settings.json'),
    '--strict-mcp-config',
    '--output-format', 'stream-json',
    '--verbose',
    '--no-session-persistence',
  ];
  if (AGENT_DEFAULTS.maxBudgetUsd) args.push('--max-budget-usd', AGENT_DEFAULTS.maxBudgetUsd);

  return new Promise((resolve) => {
    // CHATGEN_GENERATING arms .claude/hooks/guard-boundary.mjs for this target.
    const env = agentEnv(childEnv(target ? { CHATGEN_GENERATING: target } : {}));
    const child = spawn('claude', args, { cwd: ROOT, env, shell: false });
    const log = logFile ? createWriteStream(logFile) : null;
    let buf = '';
    let final = { result: '', costUsd: undefined, turns: undefined, isError: false };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      log?.write(chunk);
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        onEvent?.(ev, label);
        if (ev.type === 'result') {
          final = { result: ev.result ?? '', costUsd: ev.total_cost_usd, turns: ev.num_turns, isError: !!ev.is_error };
        }
      }
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      stderr += d;
      log?.write(JSON.stringify({ type: 'stderr', text: d }) + '\n');
    });
    child.on('error', (err) => resolve({ ok: false, code: -1, result: `failed to start claude: ${err.message}` }));
    child.on('close', (code) => {
      log?.end();
      resolve({ ok: code === 0 && !final.isError, code, ...final, result: final.result || stderr.slice(-2000) });
    });
  });
}

/**
 * When regen.mjs itself runs inside a Claude Code session (desktop app, IDE, SDK host), that
 * session's host-auth/session variables leak into the child and make it expect host-provided auth.
 * The generator must behave the same from any shell, so drop them; the child then uses the CLI's
 * own login (`claude` → /login) or ANTHROPIC_API_KEY.
 */
function agentEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'CLAUDECODE' || k === 'ANTHROPIC_BASE_URL' || (k.startsWith('CLAUDE_') && k !== 'CLAUDE_CONFIG_DIR')) continue;
    out[k] = v;
  }
  return out;
}

/** Compact one-line progress for the console from stream-json events. */
export function describeEvent(ev) {
  if (ev.type !== 'assistant') return null;
  const out = [];
  for (const c of ev.message?.content ?? []) {
    if (c.type !== 'tool_use') continue;
    const i = c.input ?? {};
    const detail = i.file_path ?? i.command ?? i.pattern ?? i.description ?? i.skill ?? '';
    out.push(`${c.name}${detail ? ` ${String(detail).replace(ROOT, '.').slice(0, 110)}` : ''}`);
  }
  return out.length ? out.join(' | ') : null;
}
