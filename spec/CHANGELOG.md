# Spec changelog

Not part of the composed spec bundle. Each entry lists what changed and why.

## 1.1.0 (2026-10-15)

Resolves the "unclear" items that the spec-conformance reviewer recorded for the
v1.0 clients (`webclient/CONFORMANCE.md` A1–A8, `client/CONFORMANCE.md` 1–7).
No protocol change: the server already behaved as specified here.

| Finding | Resolution | Requirements |
|---|---|---|
| A1 / android 2: `failed` vs. a server copy with the same id (REQ-MSG-001 vs REQ-SYNC-002) | The local `failed` message wins. The server copy is not stored, and the cursor still advances. | REQ-SYNC-002 (amended), **REQ-SYNC-005** (new), REQ-MSG-001 (note) |
| A2 / android 3: POST statuses outside 200/201/400/409/5xx; error body without `code` | One classification table: acknowledgement, rejection or failure. Any unlisted status (202, 204, 3xx, 404, 408, 413, 429, …) or malformed success body is a failure, so the message stays `queued` and is retried. `errorCode` falls back to `http_<status>`. | **REQ-CONN-008** (new), **REQ-OUTBOX-006** (new), REQ-OUTBOX-002..004, REQ-PROTO-013 (amended) |
| A3 / android 1: 4xx to GET (REQ-CONN-003 vs REQ-CONN-004) | REQ-CONN-004 sets `online` only for an acknowledgement, a rejection or a successful sync response. A 4xx to GET is a failure. | REQ-CONN-001, -003, -004 (amended) |
| A4: REQ-SYNC-001 prose vs. pseudocode | The prose now states the pseudocode's `probe` bookkeeping: after a failure, the next sync is a probe even if POSTs succeeded in between. | REQ-SYNC-001 (amended) |
| A5: "Connecting: at most 10 s" on web | Separate connect bound only where the HTTP stack exposes it (Android: yes; web/`fetch`: no, the total timer is the bound). | REQ-CONN-006 (amended), both profiles |
| A6 / android 5: Unicode White_Space vs. platform `trim()` | Whitespace is now a fixed 25-code-point set in the glossary (equal to ECMAScript `trim()`, which the server already uses). Web keeps `trim()`. Android uses an explicit set instead of Kotlin `trim()`/`isBlank()`. | Glossary, **REQ-ID-006**, **REQ-SEND-005** (new), body rule in 20-protocol |
| A7 / android 4: wake during a probe; wake while nothing is interruptible | Wake aborts any Phase B request. A wake during Phase A is latched and makes the engine skip the Phase B request (or the next backoff sleep) and start a new cycle. | REQ-CONN-005 (amended), **REQ-CONN-009** (new), pseudocode |
| A8: cross-key atomicity, "queued ⇔ in outbox" | Atomicity is per value. The write order is store, outbox, cursor. A specified load-time repair restores the invariant. | REQ-PERSIST-001 (amended), **REQ-PERSIST-002**, **REQ-PERSIST-003** (new) |
| android 6: `Modifier.clickable` on `conversation-row` | Recorded in the Android profile as verified by the `conversation-order` scenario on the emulator. | android profile |

Not addressed in 1.1 (no reviewer marked it unclear; recorded as observations): behavior when a
persistent write itself fails (disk full, `QuotaExceededError`).

## 1.0.0 (2026-10-15)

Initial specification.
