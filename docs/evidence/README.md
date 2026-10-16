# Evidence

Results of the runs made for this submission on 2026-10-15. Machine: Windows 11, Node 24, JDK 17, Pixel_8 emulator (API 36), Claude Code 2.1.282 with `claude-opus-5-5`. Raw logs are in [`logs/`](logs/). Full run directories (agent event streams, spec bundles, gate logs) stay in `harness/runs/`, which is gitignored.

## 0. Spec v1.1 (2026-10-16)

Spec 1.1.0 resolves the reviewers' "unclear" items from the v1.0 runs. [`spec/CHANGELOG.md`](../../spec/CHANGELOG.md) maps each finding to its resolution. Both clients were then regenerated from the spec alone. No generated code was edited by hand. Sections 1–4 below are the original v1.0 runs, kept for comparison.

**Before regenerating:** `npm run test:harness` 7/7, `npm run conformance` 20/20 (a new test pins the glossary whitespace set; the server needed no change), and the reference E2E 5/5 ([log](logs/e2e-v1.1-reference.log)).

| Target | Run | Generate | Gates | Review | Result |
|---|---|---|---|---|---|
| web | clean, spec `2459a4cf87d0` | 1213 s · 71 turns · $5.26 | boundary ✅ traceability ✅ build ✅ lint ✅ unit-tests ✅ | violations=0 · **unclear=1** (was 6) · ok=48 | **ACCEPTED**, 28 files ([log](logs/regen-web-v1.1.log)) |
| android | clean, spec `3db663d27b07` | 1663 s · 109 turns · $8.26 | boundary ✅ traceability ✅ build ✅ unit-tests ✅ | violations=0 · **unclear=1** (was 2) · ok=51 | **ACCEPTED**, 53 files ([log](logs/regen-android-v1.1.log)), but failed E2E (see below) |
| android | `--no-clean` after a spec fix, spec `29b795f02f37` | 499 s · 30 turns · $2.77 | all ✅ | violations=0 · unclear=2 · ok=68 | **ACCEPTED**. Only the two list screens changed ([log](logs/regen-android-v1.1-emptystate.log)) |

**What happened along the way:**
- **Usage limit.** The first attempts ran web and android in parallel. Both hit the Claude usage limit mid-generation (web after 37 turns, android after 28), and one later android attempt stopped after 138 turns. The harness aborted cleanly each time, and the next clean run deleted the partial output. Targets were then run one at a time.
- **Stale preview.** The first web attempt failed in `npm ci` with `EPERM` because a `vite preview` left over from an earlier session held the rolldown native binding. It was stopped. The E2E runner reuses any server already on :4173, so it would also have tested the old v1.0 build.
- **E2E caught what review could not.** With the first v1.1 Android build as Alice, `validation-and-identity` failed in two bindings: an empty Thread showed "No messages yet." on screen, but `thread-empty` was missing from the UI Automator tree. The generated `Text` sat **under** a `fillMaxSize()` `LazyColumn` in a `Box`, and Compose drops semantics nodes that a later sibling fully covers. This was fixed in the spec (`50-ui` element rules plus the android profile's empty-state mechanism, commit `spec: shown elements must be in the automation tree…`), and Android was regenerated.

**Remaining review items**, queued for v1.2 in [`FUTURE.md`](../../FUTURE.md):
- web: an id collision between a local `queued`/`sent` message and a server copy with a different `from`.
- android: the deletion order on logout vs REQ-PERSIST-002.
- android: whether a REQ-CONN-008 "integer" accepts `1.0`.

### E2E matrix on the v1.1 clients (`node e2e/runner.mjs --all --bind …`)

The final Android APK (spec `29b795f02f37`) was installed with `--install`, and its install time was checked before the matrix ran. Web is `webclient` at spec `2459a4cf87d0`. The only spec change after that hash is the automation-tree rule, which the DOM client already met.

| Binding | alice-bob-offline | offline-fifo-restart | validation-and-identity | conversation-order | long-thread | Log |
|---|---|---|---|---|---|---|
| reference ↔ reference | ✅ | ✅ | ✅ | ✅ | ✅ | [log](logs/e2e-v1.1-reference.log) |
| **web** (Alice) ↔ reference | ✅ | ✅ | ✅ | ✅ | ✅ | [log](logs/e2e-v1.1-web-alice.log) |
| reference ↔ **web** (Bob) | ✅ | ✅ | ✅ | ✅ | ✅ | [log](logs/e2e-v1.1-web-bob.log) |
| **android** (Alice) ↔ reference | ✅ | ✅ | ✅ | ✅ | ✅ | [log](logs/e2e-v1.1-android-alice.log) |
| reference ↔ **android** (Bob) | ✅ | ✅ | ✅ | ✅ | ✅ | [log](logs/e2e-v1.1-android-bob.log) |
| **web (Alice) ↔ android (Bob)** | ✅ | ✅ | ✅ | ✅ | ✅ | [log](logs/e2e-v1.1-alice_web_bob_android.log) |
| **android (Alice) ↔ web (Bob)** | ✅ | ✅ | ✅ | ✅ | ✅ | [log](logs/e2e-v1.1-alice_android_bob_web.log) |

35/35 scenario runs passed, with no reruns on the final builds.

## 1. Generation runs (`node harness/regen.mjs <target>`)

| Target | Start state | Generate | Gates | Repairs | Review | Result |
|---|---|---|---|---|---|---|
| web | Vite template scaffold, template `src/` deleted | 1230 s · 73 turns · $5.08 | boundary ✅ traceability ✅ build ✅ lint ✅ unit-tests ✅ (first try) | 0 | violations=0 · unclear=6 · ok=43 | **ACCEPTED**, 32 files ([log](logs/regen-web.log)) |
| android | **empty `client/` folder** (only `.git`); scaffold bootstrapped from `harness/scaffolds/android` | 1825 s · 118 turns · $9.00 | boundary ✅ traceability ✅ build ✅ unit-tests ✅ | 0 code changes (see note) | violations=0 · unclear=2 · ok=44 | **ACCEPTED**, 44 files ([log](logs/regen-android-from-scratch.log), [gates + review](logs/regen-android-gates-and-review.log)) |

The dollar figures are Claude Code's token-based cost estimates (`total_cost_usd`). With a subscription login they count against plan usage; nothing is billed per run.

**Note on the Android build gate.** The first build attempt failed before compiling anything. The scaffold pinned the Gradle daemon to JDK 25, downloaded from foojay.io, which was unreachable. The repair agent diagnosed this correctly and **changed nothing**, because the file is outside its boundary ([its report](logs/android-generate-summary.md) and the harness run log). The fix was a human-owned scaffold change: the template no longer downloads a JDK, so builds stay local-only. Gates were then re-run on the unchanged generated code, and all passed.

## 2. Executable scenarios (`node e2e/runner.mjs`)

Five platform-neutral scenarios from `spec/scenarios/`, each run against every binding. Unbound actors use the headless reference client.

| Binding | alice-bob-offline | offline-fifo-restart | validation-and-identity | conversation-order | long-thread |
|---|---|---|---|---|---|
| reference ↔ reference | ✅ | ✅ | ✅ | ✅ | ✅ |
| **web** (Alice) ↔ reference | ✅ | ✅ | ✅ | ✅ | ✅ |
| reference ↔ **web** (Bob) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **android** (Alice) ↔ reference | ✅ | ✅ | ✅ | ✅ | ✅ |
| reference ↔ **android** (Bob) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **web (Alice) ↔ android (Bob)** | ✅ | ✅ | ✅ | ✅¹ | ✅ |
| **android (Alice) ↔ web (Bob)** | ✅ | ✅ | ✅² | ✅ | ✅ |

The brief's scenario (`alice-bob-offline`, steps 1–7, plus an epilogue) passes in **both** cross-platform directions, and once more in a `--headed` run watched live ([log](logs/e2e-headed-demo.log)).

1. The first attempt failed because a person typed on the emulator during the run (login showed "Geraldo"). The re-run passed ([log](logs/e2e-rerun-order.log)).
2. The first attempt failed in the Android E2E driver: `adb input text` dropped characters of a 1001-character body. The driver now self-corrects, and the re-run passed ([log](logs/e2e-rerun-validation.log)).

**Driver problems found and fixed on the way** (none were client bugs; see commit `e2e: harden the Android driver…`):
- Typing before the IME had focus was lost.
- Long `adb input text` strings dropped characters.
- A tap computed from pre-keyboard bounds hit the keyboard's Enter key.

## 3. Spec defects found by the quality layers

| Found by | Defect | Fix |
|---|---|---|
| reference ↔ reference E2E | A fresh client stayed `offline` until its first 25 s long-poll returned | REQ-SYNC-001 probe (`wait=0`) on start and after failure |
| reference ↔ reference E2E | Messages queued in the same millisecond were shuffled by the random-id tie-break | REQ-SEND-002: strictly increasing `createdAt` |
| reference ↔ reference E2E | Node `fetch` sometimes never settles an aborted long-poll | REQ-CONN-005: abandon the request; don't await it |
| harness self-tests | REQ-UI-007 (auto-scroll) was covered by no scenario | `long-thread` scenario |
| conformance suite | Bad regex escape in `defs.schema.json` | Fixed the schema |
| web review (`CONFORMANCE.md`) | 6 "unclear" items, e.g. a 4xx on sync vs REQ-CONN-004, Unicode White_Space vs JS `trim()`, cross-key atomicity | Resolved in spec v1.1 (section 0, `spec/CHANGELOG.md`) |
| v1.1 android E2E | `thread-empty` drawn under a list, so missing from the automation tree | `50-ui` element rule plus the android profile's empty-state mechanism |

## 4. Other checks

- `npm run test:harness`: 7/7, including bootstrapping every target into an empty directory.
- `npm run conformance`: 19/19 against the server.
- Server unit tests: 9/9.
