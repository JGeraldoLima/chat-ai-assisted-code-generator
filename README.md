# chat-ai-assisted-code-generator

**Chat Generator**: a spec-driven client generator

Chat Generator turns a written spec into working messaging clients (web + Android) using Claude Code.
**The generator is the deliverable.** The messaging app is the example it's evaluated on.

> Delete the generated client code, run `node harness/regen.mjs all`, and you get working clients
> that pass the same gates and cross-platform scenarios.
>
> **You don't need to regenerate to try it.** The generated clients are committed, so building and running
> them costs no tokens. Regeneration runs Claude Code and costs real tokens: about $6–7 for web and $10–11 for
> Android per run. See [Cost](#cost-read-before-regenerating).

## Where to find things

| # | Deliverable | Where |
|---|---|---|
| 1 | **Agentic harness**: what makes code generation reusable and reliable | [`harness/`](harness/) (pipeline, gates, target descriptors, prompts) · [`.claude/`](.claude/) (skills, reviewer sub-agent, edit-guard hook) · [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) · rationale in [`DESIGN.md`](DESIGN.md) |
| 2 | **Spec**: the source of truth | [`spec/`](spec/) — start at [`spec/README.md`](spec/README.md). Core (platform-neutral) in [`spec/core/`](spec/core/), platform profiles in [`spec/platforms/`](spec/platforms/), executable scenarios in [`spec/scenarios/`](spec/scenarios/), extension modules in [`spec/features/`](spec/features/) |
| 3 | **Generator**: what to run, in which tool | `node harness/regen.mjs <web\|android\|all>` (headless **Claude Code**, or **Codex** with `--agent codex`), or `/generate-client <target>` inside Claude Code. Check prerequisites first with `npm run doctor`. See [Regenerate](#regenerate-the-clients) below. |
| 4 | **Generated client code** (committed, boundary marked) | [`webclient/src/`](webclient/) and [`client/app/src/…/chatclient/`](client/) (minus `ui/theme/`). Each project has `GENERATED.md` (provenance), `TRACEABILITY.md` and `CONFORMANCE.md`. Boundary table below. |
| 5 | **Server** (not under generator discipline) | [`server/`](server/): Express, in-memory, plus the `/admin` network portal. Verified by [`conformance/`](conformance/). |
| 6 | **Future work** | [`FUTURE.md`](FUTURE.md) |

Also: [`ATTRIBUTION.md`](ATTRIBUTION.md) (who or what wrote each artifact) and [`DESIGN.md`](DESIGN.md) (principles).

## Regeneration boundary

| Folder | Generated (deleted and rewritten by the harness) | Human-owned scaffold (source of truth: `harness/scaffolds/<target>/`) |
|---|---|---|
| `webclient/` | `src/**` | `package.json` + lockfile, `index.html`, `vite.config.ts`, `tsconfig*.json`, `.oxlintrc.json`, `public/` |
| `client/` | `app/src/main/java/com/example/chatclient/**` **except** `ui/theme/**`; `app/src/test/**`; `app/src/androidTest/**` | Gradle files, `gradle/libs.versions.toml` (= dependency allowlist), `AndroidManifest.xml`, `res/`, `ui/theme/` |
| `server/` | nothing | everything (hand-directed) |
| root | nothing | everything |

The boundary is data ([`harness/targets/*.json`](harness/targets/)). It's enforced during generation by a hook, and after it by a `git status` gate. The scaffold itself lives in versioned templates, [`harness/scaffolds/`](harness/scaffolds/). The harness **bootstraps a project from an empty (or deleted) folder** by applying the template, then generates the app code. The same gate fails if a project's scaffold drifts from its template.

## Prerequisites

Check your machine first. Nothing runs and no tokens are spent until this passes:

```bash
npm install          # root tools (+ server deps via postinstall); needed by the check itself
npm run doctor       # all targets, Claude Code, E2E tooling; e.g. `npm run doctor -- web --agent codex`
```

`regen.mjs` and the E2E runner run the same check automatically and stop with a list of what's missing.

| Needed for | What | Checked |
|---|---|---|
| everything | Node.js ≥ 22 (tested with 24), git, `npm install` in the repo root | ✓ |
| generating a client | **one** coding agent CLI, logged in: Claude Code (`claude` then `/login`, or `ANTHROPIC_API_KEY`), the default; **or** OpenAI Codex (`codex login`, or `CODEX_API_KEY`), see [Use Codex](#use-codex-instead-of-claude-code) | ✓ (also says whether you're on a subscription or a billed API key) |
| web E2E | Playwright Chromium: `npx playwright install chromium` | ✓ |
| Android build | JDK 17+, Android SDK (`ANDROID_HOME`, or the default location) | ✓ |
| Android E2E | `adb` and exactly one booted device or emulator (tested: Pixel_8 AVD, API 36). With several, set `ANDROID_SERIAL` or bind `android@<serial>` | ✓ |

On Windows, Gradle needs `TEMP`/`TMP` without 8.3 short names (`C:\Users\ABCDEF~1\…`). The harness sets this automatically; set it yourself when running `gradlew.bat` by hand.

```bash
git clone https://github.com/JGeraldoLima/chat-ai-assisted-code-generator.git chatgen && cd chatgen
npm install
npx playwright install chromium  # web E2E driver
npm run doctor
```

## Cost: read before regenerating

Each regeneration runs Claude Code headless (default `claude-opus-5-5`, effort `high`). It writes the whole client and its tests, iterates on build/lint/test, and then runs an independent review. Measured on this repo:

| Target | One full run (generate + review) | Time | Agent turns |
|---|---|---|---|
| web | ≈ $6–7 | 20–25 min | 71–73 |
| android | ≈ $10–11 | 30–40 min | 109–118 |
| a small spec fix with `--no-clean` (android) | ≈ $4.40 | ~14 min | 30 |

The figures are Claude Code's token-cost estimates (`total_cost_usd`). Details per run are in [`docs/evidence/`](docs/evidence/README.md).
- **API key (`ANTHROPIC_API_KEY`):** you are billed this amount.
- **Claude subscription:** the runs count against your plan's usage limits. A full Android run can exceed one Pro usage window.

The harness is built so tokens are not wasted:

| Guard | What it does |
|---|---|
| Plan, then confirm | Shows which targets will run and their measured cost, then asks `[y/N]`. Outside a terminal it needs `--yes`. |
| Skip up-to-date targets | A project already ACCEPTED for the current spec hash is skipped. Use `--force` to regenerate anyway. |
| One run at a time | A lock (`harness/runs/.lock`) refuses a second `regen.mjs`, and `all` runs targets in sequence. Parallel runs double the burn rate. |
| Stop, don't start over | If a usage limit (or `CHATGEN_MAX_BUDGET_USD`) stops a step, the agent's conversation is checkpointed. `--resume` continues it with its context and partial work, instead of a clean run that pays again. `all` doesn't start the next target after a limit. |
| Never accept unreviewed | An interrupted review fails the run. `--gates-only` finishes it. |

**Ways to spend less:**
- Regenerate only the target whose spec changed.
- Use `--no-clean` for small spec fixes.
- Use `--no-review` while iterating.
- Set `CHATGEN_EFFORT=medium` or a cheaper `CHATGEN_MODEL`. These are untested here; the gates and E2E scenarios tell you whether the result still holds.
- Set `CHATGEN_MAX_BUDGET_USD` to cap each agent step. A capped step can be resumed.

## Regenerate the clients

```bash
node harness/regen.mjs web            # shows the plan and cost, asks before spending
node harness/regen.mjs android --yes  # confirm up front (needed outside a terminal)
node harness/regen.mjs all            # one target after the other
node harness/regen.mjs android --resume --yes   # continue a run a usage limit interrupted
```

Each run does the following:

1. Composes the spec bundle and hashes it.
1. If the project folder is empty or missing, bootstraps it from `harness/scaffolds/<target>/` (Gradle wrapper, build files, manifest, resources, theme / Vite config, lockfile), as a `scaffold:` commit.
2. Deletes the generated roots.
3. Runs Claude Code headless with the `generate-client` skill: pinned model, project settings only, edit guard armed.
4. Runs the gates: boundary, traceability, build, lint, unit tests. If any fail, it repairs (up to 3 times).
5. Has an independent reviewer sub-agent check conformance requirement by requirement.
6. Stamps `GENERATED.md`.

Logs go to `harness/runs/` (gitignored). The run doesn't commit. It prints a commit command with a `Generated-by:` trailer for you to use after review.

The model defaults to `claude-opus-5-5`. Override with `CHATGEN_MODEL`, `CHATGEN_EFFORT`, or `CHATGEN_MAX_BUDGET_USD` (see [Cost](#cost-read-before-regenerating)).

**Verify without regenerating:** `node harness/regen.mjs <target> --gates-only --no-review --max-repairs 0` (no tokens; with the review, ≈ $1–2).

**Interactive variant (any agent):**

1. `node harness/regen.mjs <target> --prepare-only`
2. Follow `.claude/skills/generate-client/SKILL.md` (`/generate-client <target>` in Claude Code).
3. `node harness/regen.mjs <target> --gates-only`

## Use Codex instead of Claude Code

The harness drives either agent through the same pipeline: plan and confirm, generate, gates, repair, review, and stamp.

```bash
npm install -g @openai/codex     # then: codex login   (or set CODEX_API_KEY)
npm run doctor -- --agent codex
node harness/regen.mjs web --agent codex          # or: CHATGEN_AGENT=codex node harness/regen.mjs web
```

**What's the same:**
- Codex reads [`AGENTS.md`](AGENTS.md), which points it to `CLAUDE.md` and to the tool-agnostic procedure in `.claude/skills/generate-client/SKILL.md`.
- The gates, the spec bundle and the acceptance criteria are identical.

**What's different with Codex:**
- **Commands:** it runs as `codex exec --json --sandbox workspace-write`, with the prompt on stdin. Set `CHATGEN_MODEL` to pick a model; Codex's default is used otherwise. `CHATGEN_EFFORT` and `CHATGEN_MAX_BUDGET_USD` are Claude-only.
- **No edit guard during the run.** Claude Code's hook blocks out-of-boundary edits while they happen. With Codex, the boundary gate catches them right after each step, and the run fails.
- **Review:** Codex has no sub-agents, so it gets the `spec-conformance-reviewer` instructions inline.
- **Cost:** Codex reports tokens, not dollars, and the cost estimates in [Cost](#cost-read-before-regenerating) are for Claude Code only.
- **Network:** Codex's `workspace-write` sandbox may block network access inside the agent. Dependency setup (`npm ci`) and the gates run outside the agent, so this mainly affects the agent's own self-checks.
- **Not yet exercised on a real run.** The Codex backend follows the documented `codex exec` interface (JSONL events `thread.started`, `item.completed`, `turn.completed`; `codex exec resume <id>`), but no client in this repo has been generated with it. The gates still decide acceptance, so a bad Codex run is rejected, not committed.


## Run it

```bash
npm run server                   # http://localhost:8080 , network portal: http://localhost:8080/admin
npm --prefix webclient run dev   # http://localhost:5173
cd client && ./gradlew installDebug && adb shell am start -n com.example.chatclient/.MainActivity
```

The Android emulator reaches the host as `10.0.2.2:8080`. To go "offline", open the portal and press
**Go offline** for a user. The server then drops that user's connections, and the client queues messages
until you press **Go online**.

## Verify it

```bash
npm run test:harness                     # spec consistency + harness self-tests
npm run conformance                      # server vs. protocol spec (JSON Schemas)
npm --prefix webclient test              # generated web unit tests
(cd client && ./gradlew testDebugUnitTest)

# Executable scenarios (spec/scenarios/*.yaml). Unbound actors use the headless reference client.
node e2e/runner.mjs --all                                      # reference <-> reference (spec/server sanity)
node e2e/runner.mjs --all --bind alice=web                     # web vs reference
node e2e/runner.mjs --all --bind alice=android --install       # android vs reference (emulator running)
node e2e/runner.mjs spec/scenarios/alice-bob-offline.yaml --bind alice=web,bob=android   # interop
node e2e/runner.mjs spec/scenarios/alice-bob-offline.yaml --bind alice=android,bob=web
```

The Alice/Bob scenario from the brief is [`spec/scenarios/alice-bob-offline.yaml`](spec/scenarios/alice-bob-offline.yaml).
Results of the runs made for this submission are in [`docs/evidence/`](docs/evidence/).

## Layout

```
chatgen/                 root repo: the generator
├─ spec/               source of truth (core · platforms · scenarios · features · schemas)
├─ harness/            regen.mjs, gates, target descriptors, prompt templates, self-tests
├─ .claude/            skills, reviewer sub-agent, edit-guard hook, vendored platform skills
├─ conformance/        server protocol conformance suite
├─ e2e/                scenario runner, drivers (web / android / reference), reference client
├─ tools/              shared helpers (server process)
├─ docs/evidence/      E2E and regeneration run results
├─ server/             Express server + network portal (hand-directed)
├─ webclient/          Vite/React scaffold + generated src/
└─ client/             Android scaffold + generated Kotlin sources
```

> **Human verification required.** All code here, generated or hand-directed, is for local evaluation.
> Review it before any operational use.
