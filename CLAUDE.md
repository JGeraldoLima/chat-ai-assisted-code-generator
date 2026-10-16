# Chat Generator: agent guide

This repo is a **spec-driven client generator**. The deliverable is the generator,
meaning `spec/` + `harness/` + `.claude/`. The messaging app (server + web + Android
clients) is the example it gets evaluated on.

## Map

| Path | Owner | What |
|---|---|---|
| `spec/` | human (agent-assisted) | **Source of truth.** Core behavior, protocol, UI contract, scenarios, platform profiles. Start at `spec/README.md`. |
| `harness/` | human (agent-assisted) | `regen.mjs` pipeline, gates, target descriptors, prompt templates, scaffold templates (`harness/scaffolds/`) |
| `.claude/` | human (agent-assisted) | Skills (`/generate-client`, `/verify-client`), the `spec-conformance-reviewer` sub-agent, permissions, the edit-guard hook. Vendored platform skills are listed in `.claude/skills/VENDORED.md`. |
| `conformance/` | human (agent-assisted) | Black-box protocol tests for the server |
| `e2e/` | human (agent-assisted) | Scenario runner + drivers (web/Playwright, android/adb, reference/headless) |
| `server/` | human (agent-assisted) | Express server + `/admin` network portal. **Not** under generator discipline. |
| `webclient/` | scaffold: human · `src/`: **generated** | Vite + React + TS |
| `client/` | scaffold: human · Kotlin sources: **generated** | Android, Compose, MVVM |

The exact generated roots for each target are in `harness/targets/<target>.json` (`generated.include` / `exclude`).

## Golden rules

1. **Behavior questions are answered by `spec/`, never by reading client code.** If the spec is silent or ambiguous, fix the spec (with a requirement ID), then regenerate. Don't patch generated code.
2. **Never hand-edit generated roots.** They are deleted and rewritten on every regeneration. Change the spec or the harness instead, and run `node harness/regen.mjs <target>`.
3. **The scaffold is human-owned.** Build files, manifests, lockfiles, configs and the Android theme come from the templates in `harness/scaffolds/<target>/` (the source of truth). They change only by editing a template and running `node harness/regen.mjs <target> --sync-scaffold`, never as a side effect of generation. An empty or missing project folder is bootstrapped from its template automatically. The boundary gate and `.claude/hooks/guard-boundary.mjs` enforce this during harness runs.
4. **Spec changes keep IDs stable.** Never renumber or reuse a `REQ-*` ID. New behavior gets new IDs, and every `[ui]` requirement must be covered by a scenario (`npm run test:harness` checks this).
5. **Core vs. platform.** `spec/core/` must stay platform-neutral. Platform mechanisms go in `spec/platforms/<target>.md` only.

## Commands

```bash
npm install                                   # root tools (+ server deps via postinstall)
npm run server                                # server on :8080, portal at http://localhost:8080/admin
npm run conformance                           # protocol conformance suite (spawns its own server)
npm run test:harness                          # harness self-tests
node harness/regen.mjs <web|android|all>      # regenerate + gates + review (headless Claude Code; costs tokens: see README "Cost")
node harness/regen.mjs <target> --resume --yes # continue a run that a usage limit interrupted (never restart from scratch)
node harness/regen.mjs <target> --gates-only --no-review  # verify without regenerating (no tokens)
node e2e/runner.mjs --all --bind alice=web,bob=android   # cross-client scenarios
```

On Windows, Gradle needs `TEMP`/`TMP` to be a path without 8.3 short names. The harness handles this, but set it yourself when running `gradlew.bat` by hand.

Token discipline: run one target at a time, never `regen.mjs` in parallel (the lock refuses it), and use `--resume` after a usage limit. Agents must not pass `--yes` or `--force` to a generation run unless the user asked for that run.

## Commit conventions

- Conventional prefixes: `spec:`, `harness:`, `feat:` (server), `scaffold:`, `gen(<target>):`, `e2e:`, `docs:`, `test:`, `chore:`.
- Harness output is committed by a human after review, with the trailer `Generated-by: chatgen-harness <version> (<model>) spec@<hash>` (`regen.mjs` prints the exact command).
- Agent-assisted interactive work carries a `Co-Authored-By:` trailer naming the model.
- Everything lives in this one repository (no submodules). Commit a project's generated output on its own, e.g. `git add -A -- webclient && git commit -- webclient`, which is what `regen.mjs` prints.
