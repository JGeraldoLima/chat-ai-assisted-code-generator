# Evidence

Results of the runs made for this submission on 2026-10-15. Machine: Windows 11, Node 24, JDK 17, Pixel_8 emulator (API 36), Claude Code 2.1.282 with `claude-opus-5-5`. Raw logs are in [`logs/`](logs/). Full run directories (agent event streams, spec bundles, gate logs) stay in `harness/runs/`, which is gitignored.

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
| web review (`CONFORMANCE.md`) | 6 "unclear" items, e.g. a 4xx on sync vs REQ-CONN-004, Unicode White_Space vs JS `trim()`, cross-key atomicity | Queued for spec v1.1 (see FUTURE.md) |

## 4. Other checks

- `npm run test:harness`: 7/7, including bootstrapping every target into an empty directory.
- `npm run conformance`: 19/19 against the server.
- Server unit tests: 9/9.
