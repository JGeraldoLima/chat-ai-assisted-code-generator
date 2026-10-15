// PreToolUse hook: while the harness is generating (CHATGEN_GENERATING=<target>), file edits are only
// allowed inside that target's regeneration boundary (plus harness scratch/report files).
// Outside of harness runs (no env var) it allows everything; humans edit the scaffold and spec.
// Exit code 2 blocks the tool call and feeds stderr back to the agent.
import { readFileSync } from 'node:fs';
import { join, relative, isAbsolute, resolve, sep } from 'node:path';

const targetId = process.env.CHATGEN_GENERATING;
if (!targetId) process.exit(0);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const { tool_input: ti = {} } = JSON.parse(input || '{}');
  const filePath = ti.file_path ?? ti.notebook_path;
  if (!filePath) process.exit(0);

  const target = JSON.parse(readFileSync(join(root, 'harness', 'targets', `${targetId}.json`), 'utf8'));
  const abs = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = relative(root, abs).split(sep).join('/');
  const inProject = rel.startsWith(`${target.project}/`) ? rel.slice(target.project.length + 1) : null;

  const allowed =
    rel.startsWith('harness/runs/') ||
    (inProject !== null &&
      ((target.generated.include.some((p) => inProject.startsWith(p)) &&
        !target.generated.exclude.some((p) => inProject.startsWith(p))) ||
        (target.harnessOutputs ?? []).includes(inProject)));

  if (allowed) process.exit(0);
  process.stderr.write(
    `BLOCKED by chatgen-harness: "${rel}" is outside the regeneration boundary of target "${targetId}". ` +
      `Allowed: ${target.generated.include.map((p) => `${target.project}/${p}`).join(', ')}` +
      (target.generated.exclude.length
        ? ` (except ${target.generated.exclude.map((p) => `${target.project}/${p}`).join(', ')})`
        : '') +
      '. The scaffold and spec are human-owned; if you need a change there, stop and report it under "## Blocked".\n',
  );
  process.exit(2);
});
