# Web client generated (spec `780413cc4e22`)

The client is generated and all three gates pass. The conformance reviewer found **0 violations**. Nothing is committed; a human needs to review it and commit using the trailer `regen.mjs` prints.

## Files created (all under `webclient/src/`)

| Layer | Files |
|---|---|
| Entry and shell | `main.tsx`, `App.tsx`, `config.ts`, `styles.css` |
| `domain/` (pure) | `types.ts`, `nameRule.ts`, `bodyRule.ts`, `time.ts`, `ordering.ts`, `merge.ts` |
| `data/` | `api.ts`, `storage.ts`, `syncEngine.ts`, `wakeSources.ts` |
| `ui/` | `LoginScreen.tsx`, `ConversationsScreen.tsx`, `ThreadScreen.tsx`, `StatusBar.tsx`, plus 4 hooks: `useAppState`, `useLoginViewModel`, `useConversationsViewModel`, `useThreadViewModel` |
| Tests | `App.test.tsx`, `domain/{rules,ordering,merge}.test.ts`, `data/{api,storage,syncEngine,wakeSources}.test.ts` |
| Test helpers | `testing/fakeServer.ts` (in-memory v1 server with long-polls and a network flag), `testing/memoryStorage.ts` |

The scaffold's template files in `src/` (`App.css`, `index.css`, `assets/*`) were already deleted when `regen.mjs` prepared the run. The reviewer also wrote `webclient/CONFORMANCE.md`.

## Self-verification

| Check | Result |
|---|---|
| `npm run build` (tsc + vite) | Pass |
| `npm run lint` (`oxlint --deny-warnings`) | Pass |
| `npm test` (vitest) | Pass: 114 tests in 8 files. No real network and no real sleeps; fake timers throughout. |
| Traceability | Each of the 33 `[client]` requirement IDs is referenced by at least one test |
| Element IDs | All 27 IDs from `50-ui.md` are present as `data-testid` |
| Boundary | `git status` shows changes only under `src/` |
| Spec review | 0 violations, 5 unclear, 40 OK |

The engine tests cover:
- FIFO, one POST at a time
- 400/409 → `failed`
- network error or 5xx → `offline`, with backoff 1/2/4/8/8 s
- wake cutting short both the backoff and a long-poll that never finishes, with the late response thrown away
- sending everything queued before syncing on reconnect
- a lost acknowledgement retried without creating a duplicate
- the cursor saved before the next request
- timeouts of 10 s for a send and `wait` + 10 s for a sync

After the review I made one change: each conversation row is now the clickable element itself, instead of wrapping its children in a `<button>`. A button merges its children in the accessibility tree, which the element rules forbid. The gates were re-run and still pass. Because of this edit, the line numbers `CONFORMANCE.md` gives for that file are slightly off.

The cross-client E2E scenarios were **not** run.

## Spec ambiguities

1. **A failed message that later arrives via sync** (REQ-MSG-001 vs REQ-SYNC-002). After a 409, the server's copy of that id may come back in a sync. I kept the local message `failed`, since REQ-MSG-001 says `failed` is final. As a result, the server's version of that message is never shown.
2. **Other non-5xx responses to a send** (REQ-OUTBOX-004 vs REQ-CONN-004). The spec only covers 200/201, 400/409 and 5xx. Any other status (404, 408, 413, 429, …) is handled like 400/409: the message becomes `failed` and the state goes `online`. Taken literally, the cycle would otherwise resend the same message forever with no delay. The downside is that a temporary status like 429 loses the message for good.
3. **Non-5xx error on a sync** (REQ-CONN-003 vs REQ-CONN-004). A non-200 sync response, or a 200 with a malformed body, is treated as a failure and goes `offline`, as REQ-CONN-003 and the pseudocode say. That contradicts REQ-CONN-004's "any response other than 5xx sets online".
4. **When a sync is a quick check (`wait=0`)** (REQ-SYNC-001). I followed the pseudocode: after any failure, the next sync uses `wait=0`, even if sends succeeded in between. The prose ("the previous request failed") would give a full 25 s wait in that case.
5. **Connect timeout** (REQ-CONN-006). `fetch` can't time the connection step on its own, so only the overall per-request timeout applies. A stalled connection on a 25 s long-poll therefore fails after 35 s, not 10 s. The web profile should say how this limit applies.
6. **Crash between the two writes of a send** (REQ-PERSIST-001 / web profile). The profile requires writing the message store before the outbox, so a crash in between leaves a `queued` message that is not in the outbox. On load I repair this: such messages are added back in creation order, and outbox ids that are no longer queued are dropped. The spec doesn't say whether this repair is expected.
7. **Wake during a quick check** (REQ-CONN-005). The prose only mentions aborting a "long-poll". I abort any sync request, including a `wait=0` check, which matches the pseudocode ("may be aborted by wake").
8. **Order of operations for login and logout**. Login deletes any leftover message, outbox and cursor data before saving the identity. Logout removes the identity first, so a logout interrupted halfway still counts as logged out.

## Blocked

Nothing.

> **Human verification is required** before this code is committed or deployed. That includes reviewing `CONFORMANCE.md` and running the cross-client E2E scenarios (`node e2e/runner.mjs --all …`).