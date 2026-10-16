# DESIGN

How Chat Generator turns a written spec into working clients, and why it's built this way.

## 1. What is being built

The deliverable is a **generator**: `spec/` + `harness/` + `.claude/`. Running it produces
working clients whose behavior matches the spec. The messaging app (server, web client,
Android client) is the example it is evaluated on.

```
                   spec/ (source of truth)
   core/ (platform-neutral) + features/ (enabled) + platforms/<target>.md + schemas + scenarios
                                │  harness/lib/spec.mjs composes + hashes
                                ▼
             harness/runs/latest-<target>/spec-bundle.md   (sha256 → GENERATED.md)
                                │
   harness/regen.mjs ──► claude -p  (.claude/skills/generate-client, project settings only,
                                │     edit-guard hook, pinned model)
                                ▼
                  generated roots (webclient/src, client/app/src/...)
                                │
          gates: boundary · traceability · build · lint · unit tests   ──fail──► repair loop (≤3)
                                │ pass
          spec-conformance-reviewer sub-agent → CONFORMANCE.md        ──violations──► repair
                                │
                     GENERATED.md stamp → human review → commit (Generated-by trailer)
                                │
          e2e/runner.mjs: spec/scenarios × {web, android, reference} drivers × server portal
```

## 2. Principles

1. **The spec is the product. Code is a build artifact.** Every normative rule has a stable ID
   (`REQ-AREA-NNN`) and a tag saying how it's verified: `[client]` by unit tests in each client,
   `[ui]` by cross-platform scenarios, `[server]` by the conformance suite. When generation exposes
   an ambiguity, the fix lands in the spec, never as a hand patch to generated code. The commit
   history shows this happening (`spec: fix three ambiguities found by the reference E2E run`).

2. **Generic core, thin platform profiles.** `spec/core/` never mentions React, Compose, localStorage
   or OkHttp. `spec/platforms/<target>.md` only maps core concepts to mechanisms: element ID →
   `data-testid` / `testTag`, persistence → localStorage keys / atomic JSON files, wake source →
   `online` event / `ConnectivityManager`. A profile may not add behavior. That's why two clients
   generated independently can still interoperate and behave identically.

3. **Precise where clients usually diverge.** Messaging clients disagree on the edges, so those are
   specified as normative pseudocode, not prose:
   - The sync engine is **one sequential loop**: flush the outbox, then one sync request.
   - The backoff table is fixed (1/2/4/8 s).
   - A wake aborts a long-poll without counting it as a failure.
   - The first sync after a failure is a `wait=0` probe.
   - Ordering is a pure function of stored data (`seq`, then `createdAt` made strictly monotonic, then `id`).
   - Exact UI strings and element IDs are fixed.

   The Alice/Bob scenario follows from these rules. It doesn't depend on timing luck.

4. **One code path for sending.** Every send goes through the persistent outbox, online or not.
   There's no "online fast path" that could behave differently from the offline one.

5. **Offline is simulated outside the clients.** The server's `/admin` portal cuts a user's TCP
   connections (`req.socket.destroy()`), so clients take their *real* network-failure path. The
   clients contain no test hooks, and the same mechanism drives the manual demo and the automated
   E2E runs.

6. **Reproducibility means behavioral equivalence, not byte equality.** LLM output varies between
   runs. What doesn't vary is the bar it must clear: deterministic gates (boundary, traceability,
   build, lint, unit tests) plus the executable scenarios. A regeneration is accepted only when the
   whole bar passes. `GENERATED.md` records the spec hash, model, harness revision and gate results
   of the accepted run.

7. **Humans own the toolchain. The agent owns app code.** Each client has a human-owned scaffold
   (build files, dependency catalog, manifest, configs, theme) and generated roots. The boundary is
   data in `harness/targets/<target>.json`. It's enforced twice: a PreToolUse hook blocks writes
   outside it during harness runs, and a `git status` gate rejects any scaffold change. The scaffold's
   dependency list *is* the allowlist, which keeps messaging SDKs out structurally. The scaffold itself is a
   versioned template (`harness/scaffolds/<target>/`), applied without any LLM involvement. That's how a
   client is generated **from scratch**: an empty folder gets the template, then the agent writes the app.
   Drift between a project and its template fails the boundary gate.

8. **The harness is target-agnostic and feature-agnostic.** No harness code mentions web or
   Android. A target is a JSON descriptor plus a platform profile. A feature is a spec module listed
   in `manifest.yaml`. Adding iOS, or reactions, means adding data, not harness code.

## 3. Protocol design (summary of `spec/core/20-protocol.md`)

| Decision | Choice | Why |
|---|---|---|
| Transport | HTTP/1.1 + JSON; `POST` to send, long-poll `GET` to receive | One mechanism on both platforms; trivial to cut for offline simulation; deterministic to test. WebSocket push is a future transport (see FUTURE.md). |
| Idempotency | Client-generated UUID `id` | Retrying after a lost acknowledgement can't duplicate a message. Same id + same content → 200; different content → 409. |
| Ordering | Server-assigned global `seq` | One total order that every client agrees on. Clients never compute order from clocks for acknowledged messages. |
| Sync | Cursor = last merged `seq`, pages of 100, `hasMore` | Stateless server-side, resumable after any outage, and a fresh login restores history. |
| Identity | `X-Chat-User` header, no auth | Matches the brief ("no security"). Login is local, so it works offline. |
| Extensibility | Ignore unknown fields; `kind` discriminator; unknown kinds render `Unsupported message` | Features add fields and kinds without breaking old clients. Breaking changes go to `/v2`. |

## 4. The agent setup

| Piece | Role |
|---|---|
| `CLAUDE.md` (root and each project), `AGENTS.md` | Ownership map, golden rules, commands, commit conventions. Codex gets the same rules and procedure. |
| `.claude/skills/generate-client/SKILL.md` | **The** generation procedure, shared by interactive (`/generate-client web`) and headless runs: read the bundle → map requirements → implement inside-out → test every `[client]` ID → self-verify with the gate commands → independent review → report spec ambiguities. |
| `.claude/skills/verify-client/SKILL.md` | Re-verifies a client without regenerating it. |
| `.claude/agents/spec-conformance-reviewer.md` | Independent, read-only reviewer with a checklist of where clients usually diverge. Writes `CONFORMANCE.md`. Its violations feed the repair loop. |
| `.claude/hooks/guard-boundary.mjs` | Armed only during harness runs (`CHATGEN_GENERATING`). Blocks edits outside the target's boundary and tells the agent why. |
| `harness/agent-settings.json` | Headless permission profile: build and test commands allowed; `git commit/push`, `npm install`, network fetches and `rm -rf` denied. Loaded with `--setting-sources project`, so the operator's personal settings and MCP servers don't leak into a run. |
| `.claude/skills/{vite,android-native-dev,staff-android-engineer}` | Vendored platform guidance, so the harness works in a clean sandbox. Advisory: the platform profile wins on conflicts (e.g. it forbids Hilt and multi-module setups). |

## 5. Quality strategy

Layered, from cheapest to most end-to-end:

1. **Spec self-consistency** (`npm run test:harness`): IDs are unique, tags are known, every `[ui]`
   requirement is covered by a scenario, composition is deterministic, and the boundary and hook rules
   hold. This already caught a real gap (auto-scroll wasn't covered by any scenario).
2. **Server conformance** (`npm run conformance`): black-box tests for every `[server]` requirement,
   with payloads validated against the spec's JSON Schemas.
3. **Generated unit tests**: the traceability gate requires every `[client]` requirement ID to appear
   in a test, and writes `TRACEABILITY.md`.
4. **Independent review**: the reviewer sub-agent produces `CONFORMANCE.md` requirement by requirement.
5. **Executable scenarios across implementations**: the same YAML runs with any binding (`web`,
   `android`, `reference`). The **reference client** (`e2e/reference/`) is a third, hand-directed
   implementation of the client spec. Running it against itself validated the spec, server and runner
   before any client was generated, and it exposed three spec bugs. Afterwards it lets each generated
   client be tested in isolation, and the `web` × `android` binding proves interop.

## 6. Repository shape

**One repository.** `server/`, `webclient/` and `client/` are plain folders next to the generator (spec,
harness, agent configuration, conformance, e2e), so a single `git clone` gives a working checkout.
They started as separate repos pinned as submodules (one repo per project, as the brief suggested). The
submodule URLs were relative because no remotes existed, and a public clone could not fetch them. Before
publishing, they were folded in with an "ours" subtree merge, which keeps each project's history,
including the `gen(<target>):` commits with their `Generated-by` trailers. Which spec produced which
client is recorded in each project's `GENERATED.md` (spec hash) and in those commits.

## 7. Known limitations

- Determinism is behavioral, not textual. Two regenerations differ in code, and that's by design.
- The Android E2E driver uses `adb` + `uiautomator dump`, which is slow (~1 s per read) but needs no
  extra tooling. Two Android actors need two devices.
- The reference client and the server are hand-directed, so they share an author with the spec. The
  generated clients are the independent implementations.
- Single-tab web assumption: two tabs of the same user would run two engines.
- **Android auto-scroll with the keyboard open (REQ-UI-007, `long-thread`), intermittent.** The generated
  Thread screen calls `scrollToItem(lastIndex)` when a message arrives. When the soft keyboard then
  shrinks the viewport (`imePadding`), Compose keeps the top of the list anchored, and the newest rows
  can end up below the visible area. Whether it fails depends on whether the keyboard settles before or
  after the scroll. In the final matrix on these builds it passed 4/4 with Android as Alice, but it failed
  2 of 3 later runs (Android as Alice; the web client and Android as Bob are not affected). Not fixed, to
  avoid another regeneration. The intended fix goes through the spec, not the generated code: in
  `spec/platforms/android.md`, require the message list to stay anchored to its newest item when the
  viewport changes (for example, `LazyColumn(reverseLayout = true)` over the messages in reverse order),
  then run `node harness/regen.mjs android --no-clean`.
