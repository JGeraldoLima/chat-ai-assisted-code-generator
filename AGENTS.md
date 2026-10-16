# AGENTS.md

Instructions for coding agents other than Claude Code (e.g. Codex). Claude Code reads
`CLAUDE.md`. The rules are identical, and **`CLAUDE.md` is canonical**: read it first.

## To generate or regenerate a client

The generation procedure is tool-agnostic and lives in one file:

1. `node harness/regen.mjs <web|android> --prepare-only`, which cleans the generated roots and writes `harness/runs/latest-<target>/spec-bundle.md`.
2. Follow `.claude/skills/generate-client/SKILL.md` from step 2. It's plain Markdown, and every step applies to any agent.
3. `node harness/regen.mjs <web|android> --gates-only --no-review`, which runs the boundary, traceability, build, lint and unit-test gates (no tokens). Drop `--no-review` and add `--yes` to also run the Claude Code conformance review (about $1–2).

The fully automated path drives a coding agent headless: Claude Code by default, or Codex with
`node harness/regen.mjs <target> --agent codex` (see the README section "Use Codex instead of Claude Code").
The manual three-step loop above works with any agent. Run `npm run doctor -- --agent codex` first.

## Hard rules (summary of CLAUDE.md)

- `spec/` is the source of truth. Never patch generated code. Fix the spec and regenerate.
- Write only inside the target's generated roots (`harness/targets/<target>.json`).
- No new dependencies, no messaging/chat SDKs, no test hooks in client code.
- Don't commit. A human reviews and commits harness output.
