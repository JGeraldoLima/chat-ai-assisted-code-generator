// Runs the coding agent headless with a pinned, project-scoped configuration.
// Two backends with the same contract: Claude Code (default) and OpenAI Codex (`--agent codex` or
// CHATGEN_AGENT=codex). Each returns {ok, code, result, costUsd?, tokens?, turns?, sessionId?,
// rateLimited?, budgetCapped?}.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { ROOT, childEnv } from './paths.mjs';
import { selectedAgent } from './doctor.mjs';

const agent = selectedAgent();
const model = process.env.CHATGEN_MODEL ?? (agent === 'claude' ? 'claude-opus-5-5' : undefined);

export const AGENT_DEFAULTS = {
  agent,
  model,
  effort: agent === 'claude' ? (process.env.CHATGEN_EFFORT ?? 'high') : undefined,
  maxBudgetUsd: agent === 'claude' ? process.env.CHATGEN_MAX_BUDGET_USD : undefined,
  /** Human-readable name, also used in the Generated-by trailer. */
  label: agent === 'claude' ? model : `codex${model ? `/${model}` : ''}`,
  title: agent === 'claude' ? 'Claude Code' : 'OpenAI Codex',
};

export function runAgent(prompt, opts = {}) {
  return agent === 'codex' ? runCodex(prompt, opts) : runClaude(prompt, opts);
}

/**
 * Claude Code: `claude -p <prompt>` from the repo root.
 * - Only project settings are loaded (`--setting-sources project`) and no user MCP servers, so a run
 *   on another machine sees the same permissions, skills and agents (.claude/ in this repo).
 * - Edits are auto-accepted; Bash is limited to the allow/deny profile in harness/agent-settings.json.
 * - The edit-guard hook (.claude/hooks/guard-boundary.mjs) blocks writes outside the target's boundary.
 * - The full event stream is saved to `logFile` (JSONL) for audit.
 * - The session is persisted, and its id returned, so an interrupted step (usage limit, budget cap,
 *   crash) can be continued with `resume` instead of being redone from scratch.
 */
function runClaude(prompt, { logFile, label = 'agent', onEvent, target, resume } = {}) {
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
  ];
  if (resume) args.push('--resume', resume);
  if (AGENT_DEFAULTS.maxBudgetUsd) args.push('--max-budget-usd', AGENT_DEFAULTS.maxBudgetUsd);

  // CHATGEN_GENERATING arms .claude/hooks/guard-boundary.mjs for this target.
  const env = agentEnv(childEnv(target ? { CHATGEN_GENERATING: target } : {}));
  let final = { result: '', costUsd: undefined, turns: undefined, isError: false, rateLimited: false, budgetCapped: false };
  let sessionId;
  return spawnJsonl('claude', args, { env, logFile, shell: false }, (ev) => {
    onEvent?.(ev, label);
    if (ev.session_id) sessionId = ev.session_id;
    if (ev.type === 'result') {
      final = {
        result: ev.result ?? '',
        costUsd: ev.total_cost_usd,
        turns: ev.num_turns,
        isError: !!ev.is_error,
        // Usage/session limits: retrying is pointless until the limit resets.
        rateLimited: ev.api_error_status === 429 || isLimitMessage(ev.result),
        // CHATGEN_MAX_BUDGET_USD reached (--max-budget-usd): resumable like a usage limit.
        budgetCapped: /budget/i.test(String(ev.subtype ?? '')),
      };
    }
  }, () => ({ ...final, sessionId }));
}

/**
 * OpenAI Codex: `codex exec --json --sandbox workspace-write -` from the repo root, prompt on stdin.
 * - Codex reads AGENTS.md (repo root) and follows the same tool-agnostic procedure
 *   (.claude/skills/generate-client/SKILL.md is plain Markdown).
 * - There is no edit-guard hook: the boundary is enforced after the step by the boundary gate.
 * - JSONL events: `thread.started` (thread_id = session id), `item.completed` with an
 *   `agent_message` item (final answer), `turn.completed` (usage), `turn.failed` / `error`.
 * - Resume: `codex exec ... resume <thread_id> -`. Not verified on a real usage limit yet.
 * - Codex reports tokens, not dollars.
 */
function runCodex(prompt, { logFile, label = 'agent', onEvent, resume } = {}) {
  const args = ['exec', '--json', '--sandbox', 'workspace-write'];
  if (AGENT_DEFAULTS.model) args.push('-m', AGENT_DEFAULTS.model);
  if (resume) args.push('resume', resume);
  args.push('-'); // prompt from stdin: no shell quoting of a multi-line prompt
  const env = agentEnv(childEnv());
  let result = '';
  let failure = '';
  let sessionId;
  let turns = 0;
  const tokens = { input: 0, cached: 0, output: 0 };
  return spawnJsonl('codex', args, { env, logFile, shell: process.platform === 'win32', stdin: prompt }, (ev) => {
    onEvent?.(ev, label);
    if (ev.type === 'thread.started') sessionId = ev.thread_id;
    if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') result = ev.item.text ?? result;
    if (ev.type === 'turn.completed') {
      turns++;
      tokens.input += ev.usage?.input_tokens ?? 0;
      tokens.cached += ev.usage?.cached_input_tokens ?? 0;
      tokens.output += ev.usage?.output_tokens ?? 0;
    }
    if (ev.type === 'turn.failed' || ev.type === 'error') failure = ev.error?.message ?? ev.message ?? JSON.stringify(ev);
  }, () => ({
    result: result || failure,
    isError: !!failure,
    turns,
    tokens,
    sessionId,
    rateLimited: isLimitMessage(failure),
    budgetCapped: false,
  }));
}

/** Spawns a CLI that prints JSONL on stdout; resolves with summary() merged with ok/code. */
function spawnJsonl(cmd, args, { env, logFile, shell, stdin }, onJson, summary) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, shell, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    if (stdin !== undefined) child.stdin.end(stdin);
    const log = logFile ? createWriteStream(logFile) : null;
    let buf = '';
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
        onJson(ev);
      }
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      stderr += d;
      log?.write(JSON.stringify({ type: 'stderr', text: d }) + '\n');
    });
    child.on('error', (err) => resolve({ ok: false, code: -1, result: `failed to start ${cmd}: ${err.message}` }));
    child.on('close', (code) => {
      log?.end();
      const s = summary();
      const result = s.result || stderr.slice(-2000);
      resolve({ ...s, ok: code === 0 && !s.isError, code, result, rateLimited: s.rateLimited || isLimitMessage(result) });
    });
  });
}

/** Usage/session limit messages from either CLI ("You've hit your session limit · resets 1am"). */
export function isLimitMessage(text) {
  return /hit your (session|usage|weekly) limit|usage limit|rate.?limit/i.test(String(text ?? ''));
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

/** Compact one-line progress for the console from either CLI's JSONL events. */
export function describeEvent(ev) {
  if (ev.type === 'item.started' && ev.item) {
    const i = ev.item;
    const detail = i.command ?? i.path ?? (Array.isArray(i.changes) ? i.changes.map((c) => c.path).join(', ') : '') ?? '';
    return `${i.type}${detail ? ` ${String(detail).replace(ROOT, '.').slice(0, 110)}` : ''}`;
  }
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

/** Token usage as a short string, for agents that report tokens instead of dollars. */
export function formatUsage(r) {
  if (r.costUsd !== undefined) return `$${r.costUsd.toFixed(2)}`;
  if (r.tokens) return `${Math.round((r.tokens.input + r.tokens.output) / 1000)}k tokens (${Math.round(r.tokens.cached / 1000)}k cached)`;
  return 'usage unknown';
}
