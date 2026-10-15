# Chat Generator: a spec-driven client generator

Chat Generator turns a written spec into working messaging clients (web + Android) using Claude Code.
**The generator is the deliverable.** The messaging app is the example it's evaluated on.

> Delete the generated client code, run `node harness/regen.mjs all`, and you get working clients
> that pass the same gates and cross-platform scenarios.

## Where to find things

| # | Deliverable | Where |
|---|---|---|
| 1 | **Agentic harness**: what makes code generation reusable and reliable | [`harness/`](harness/) (pipeline, gates, target descriptors, prompts) · [`.claude/`](.claude/) (skills, reviewer sub-agent, edit-guard hook) · [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) · rationale in [`DESIGN.md`](DESIGN.md) |
| 2 | **Spec**: the source of truth | [`spec/`](spec/) — start at [`spec/README.md`](spec/README.md). Core (platform-neutral) in [`spec/core/`](spec/core/), platform profiles in [`spec/platforms/`](spec/platforms/), executable scenarios in [`spec/scenarios/`](spec/scenarios/), extension modules in [`spec/features/`](spec/features/) |
| 3 | **Generator**: what to run, in which tool | `node harness/regen.mjs <web\|android\|all>` (headless **Claude Code**), or `/generate-client <target>` inside Claude Code. See [Regenerate](#regenerate-the-clients) below. |
| 4 | **Generated client code** (committed, boundary marked) | [`webclient/src/`](webclient/) and [`client/app/src/…/chatclient/`](client/) (minus `ui/theme/`). Each repo has `GENERATED.md` (provenance), `TRACEABILITY.md` and `CONFORMANCE.md`. Boundary table below. |
| 5 | **Server** (not under generator discipline) | [`server/`](server/): Express, in-memory, plus the `/admin` network portal. Verified by [`conformance/`](conformance/). |
| 6 | **Future work** | [`FUTURE.md`](FUTURE.md) |

Also: [`ATTRIBUTION.md`](ATTRIBUTION.md) (who or what wrote each artifact) and [`DESIGN.md`](DESIGN.md) (principles).

## Regeneration boundary

| Repo | Generated (deleted and rewritten by the harness) | Human-owned scaffold |
|---|---|---|
| `webclient/` | `src/**` | `package.json` + lockfile, `index.html`, `vite.config.ts`, `tsconfig*.json`, `.oxlintrc.json`, `public/` |
| `client/` | `app/src/main/java/com/example/chatclient/**` **except** `ui/theme/**`; `app/src/test/**`; `app/src/androidTest/**` | Gradle files, `gradle/libs.versions.toml` (= dependency allowlist), `AndroidManifest.xml`, `res/`, `ui/theme/` |
| `server/` | nothing | everything (hand-directed) |
| root | nothing | everything |

The boundary is data ([`harness/targets/*.json`](harness/targets/)). It's enforced during generation by a hook, and after it by a `git status` gate.

## Prerequisites

- Node.js ≥ 22 (tested with 24), git.
- **Claude Code CLI**, logged in (`claude`, then `/login`) or `ANTHROPIC_API_KEY` set. The generator spawns `claude -p`.
- Android only: Android SDK with an emulator (tested: Pixel_8 AVD, API 36) and JDK 17+. On Windows, Gradle needs `TEMP`/`TMP` without 8.3 short names (`C:\Users\ABCDEF~1\…`). The harness sets this automatically; set it yourself when running `gradlew.bat` by hand.

```bash
git clone <this repo> chatgen && cd chatgen
git submodule update --init      # server/, webclient/, client/
npm install                      # root tools (+ server deps via postinstall)
npx playwright install chromium  # web E2E driver
```

## Regenerate the clients

```bash
node harness/regen.mjs web       # ~10–30 min; streams the agent's tool calls
node harness/regen.mjs android
node harness/regen.mjs all
```

Each run does the following:

1. Composes the spec bundle and hashes it.
2. Deletes the generated roots.
3. Runs Claude Code headless with the `generate-client` skill: pinned model, project settings only, edit guard armed.
4. Runs the gates: boundary, traceability, build, lint, unit tests. If any fail, it repairs (up to 3 times).
5. Has an independent reviewer sub-agent check conformance requirement by requirement.
6. Stamps `GENERATED.md`.

Logs go to `harness/runs/` (gitignored). The run doesn't commit. It prints a commit command with a `Generated-by:` trailer for you to use after review.

The model defaults to `claude-opus-5-5`. Override with `CHATGEN_MODEL`, `CHATGEN_EFFORT`, or `CHATGEN_MAX_BUDGET_USD`.

**Verify without regenerating:** `node harness/regen.mjs <target> --gates-only --max-repairs 0`.

**Interactive variant (any agent):**

1. `node harness/regen.mjs <target> --prepare-only`
2. Follow `.claude/skills/generate-client/SKILL.md` (`/generate-client <target>` in Claude Code).
3. `node harness/regen.mjs <target> --gates-only`

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
├─ server/             submodule: Express server + network portal (hand-directed)
├─ webclient/          submodule: Vite/React scaffold + generated src/
└─ client/             submodule: Android scaffold + generated Kotlin sources
```

> **Human verification required.** All code here, generated or hand-directed, is for local evaluation.
> Review it before any operational use.
