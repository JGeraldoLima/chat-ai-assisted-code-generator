# 30 — Messaging (client behavior)

## Local data model

A **local message** is a protocol message plus client bookkeeping:

| Field | Notes |
|---|---|
| `id`, `kind`, `from`, `to`, `body`, `createdAt` | As in the protocol |
| `seq` | `null` until acknowledged or synced |
| `receivedAt` | `null` until acknowledged or synced |
| `status` | One of `queued`, `sent`, `received`, `failed` |
| `errorCode` | When `status == failed`: the server's `error.code`, or `http_<status>` if the response body has none (REQ-OUTBOX-006). Otherwise `null`. |

**Status meaning:**

| Status | Meaning |
|---|---|
| `queued` | Created on this client, in the outbox, not yet acknowledged |
| `sent` | `from == me` and the server holds it (has `seq`) |
| `received` | `from != me` and it came from the server (has `seq`) |
| `failed` | The server rejected it with 400/409. It will never be retried. No `seq`. Kept on this client only (REQ-SYNC-005). |

- **REQ-MSG-001** [client] Status transitions are only:
  - `queued → sent` (REQ-OUTBOX-002 or REQ-SYNC-002)
  - `queued → failed` (REQ-OUTBOX-004)
  - insert as `sent` / `received` (REQ-SYNC-002)

  No other transition exists. In particular `sent`, `received` and `failed` are terminal. A `failed` message is never changed by sync (REQ-SYNC-005).

## Sending

- **REQ-SEND-001** [client] Body validation happens on the client when the user presses Send. It uses the protocol body rule (not blank as defined by REQ-SEND-005, at most 1000 code points). On failure, nothing is created, the input keeps its text, and `composer-error` shows exactly one of these:
  - blank: `Message cannot be empty.`
  - too long: `Message is too long (max 1000 characters).`
- **REQ-SEND-002** [client] A valid send creates a local message with:
  - `id`: new random v4 UUID, lowercase
  - `kind`: `"text"`
  - `from`: me
  - `to`: the open thread's peer
  - `body`: the input text **verbatim**
  - `createdAt`: now, as a timestamp, but **strictly greater** than the `createdAt` of every message already in the store with `from == me`. If the clock gives an equal or earlier instant (same millisecond, or the clock moved back), use the previous maximum + 1 ms. This makes REQ-ORDER-001 reproduce creation order for unsent messages.
  - `status`: `queued`
  - `seq`, `receivedAt`, `errorCode`: `null`
- **REQ-SEND-003** [client] The new message MUST be durably written to the message store **and** appended to the tail of the outbox before the UI reflects it. After the write, the client clears the input and hides `composer-error`.
- **REQ-SEND-004** [client] After a send is persisted, the client MUST **wake** the sync engine (REQ-CONN-005). Sending never performs network I/O directly. All sends go through the outbox, online or not.
- **REQ-SEND-005** [client] The blank test is: every code point of the body is in the glossary's whitespace set (an empty body is blank). No other code point counts as whitespace. Examples: a body of only U+3000, or only U+FEFF, is blank (`Message cannot be empty.`). A body of only U+0085, or only U+200B, is not blank and is sent. The body itself is never trimmed (REQ-SEND-002).

## Outbox flush

- **REQ-OUTBOX-001** [client] Flushing is strictly FIFO and sequential: at most one `POST /v1/messages` is in flight per client at any time, and it is always for the outbox **head**. Messages are never reordered or sent in parallel.
Every POST outcome is classified by REQ-CONN-008 as an acknowledgement, a rejection or a failure. Each class is handled as follows.

- **REQ-OUTBOX-002** [client] On an **acknowledgement** (200/201 with a well-formed body, REQ-CONN-008), the client updates the local message from the response (`seq`, `receivedAt`, status `sent`), removes it from the outbox head, and continues with the next head.
- **REQ-OUTBOX-003** [client] On a **failure** (REQ-CONN-008: a network error, timeout, connection reset, any 5xx, or any other status or body that is neither an acknowledgement nor a rejection, for example 202, 204, 3xx, 404, 408, 413 or 429), the head stays in the outbox with status `queued`, and the flush stops. This counts as a **failed request** (REQ-CONN-003), so the head is retried after the backoff. A transient or unexpected status never makes a message `failed`.
- **REQ-OUTBOX-004** [client] On a **rejection** (400 or 409, REQ-CONN-008), the client sets the message's status to `failed` and `errorCode` as in REQ-OUTBOX-006, removes it from the outbox, and continues with the next head. The request reached the server, so this counts as a **successful request** for connection state.
- **REQ-OUTBOX-005** [client] The outbox and message store survive app restart and process death. After restart, queued messages are still `queued`, in the same order, and are flushed by the engine's next cycle.
- **REQ-OUTBOX-006** [client] On a rejection, `errorCode` is the response's `error.code` if the body is a JSON object whose `error.code` is a string. Otherwise (empty, non-JSON or differently shaped body) it is `http_<status>`, for example `http_409`. The status is `failed` in both cases.

## Sync merge

- **REQ-SYNC-001** [client] A sync request is `GET /v1/messages?after=<cursor>&wait=<w>`. `w = 0` (a *probe*: it returns immediately) if any of these holds:
  - No sync request of this engine run has succeeded yet.
  - A request (POST or GET) of this engine run has failed (REQ-CONN-003) since the most recent successful sync request. Successful POSTs in between do **not** clear this: after a failure, the next sync request is a probe even if the flush before it succeeded.
  - The most recent successful sync response had `hasMore == true`.

  Otherwise `w = 25` (a long-poll). A sync request aborted by wake (REQ-CONN-005) is neither a success nor a failure, so it changes none of these conditions. This is exactly the `probe` / `hasMore` bookkeeping in the pseudocode of `40-connectivity.md`. The probe rule lets a starting or reconnecting client learn within one round trip that it is `online`, instead of waiting out a long-poll.
- **REQ-SYNC-002** [client] Each received message is **upserted** by `id`:
  - **Existing id whose local status is `failed`:** REQ-SYNC-005 applies instead.
  - **Existing id with any other status:** set `seq`, `receivedAt` and the protocol fields from the server copy. Set status to `sent` if `from == me`, else `received`. If the id is in the outbox (its POST acknowledgement was lost), remove it from the outbox.
  - **New id:** insert it with status `sent` if `from == me`, else `received`.
- **REQ-SYNC-005** [client] If a received message's `id` belongs to a local message with status `failed`, the local message wins. It is left completely unchanged (status `failed`, its own fields and `errorCode`, `seq` and `receivedAt` still `null`). The server copy is **not** stored, shown or counted anywhere. The rest of the response is merged normally, and the cursor still advances to the response `cursor`. Rationale: the store is keyed by `id`, the idempotency key. After a 409 `id_conflict` the server holds a *different* message under that id, and the local `failed` message must stay visible to the user who wrote it. Only an id collision leads here, so losing the server copy is accepted.
- **REQ-SYNC-003** [client] After merging a response, the client sets the cursor to the response `cursor` (REQ-PROTO-023). The merged messages and the new cursor MUST be persisted before the next request is issued. Merging is idempotent: re-receiving a message has no further effect.
- **REQ-SYNC-004** [client] Messages whose `kind` the client does not support are stored and shown, with display body `Unsupported message`. They count as normal messages for ordering and conversation membership.

## Ordering

- **REQ-ORDER-001** [client] Within a conversation, messages are ordered:
  1. All messages with a `seq`, ascending by `seq`.
  2. Then all messages without a `seq` (`queued` or `failed`), ascending by `createdAt`, ties broken by `id` ascending.

  This order is a pure function of the stored data. Every platform MUST produce the same order for the same data.
- **REQ-ORDER-002** [client] Conversations (one per peer that has at least one message) are ordered by the activity time of their **last** message in REQ-ORDER-001 order, newest first. A message's activity time is its `receivedAt`, or its `createdAt` if `receivedAt` is null. Ties are broken by peer name, ascending (code-point order).

## Persistence

- **REQ-PERSIST-001** [client] The persisted state is exactly: identity, message store, outbox (ordered ids) and cursor. UI state such as the open thread or draft text MAY be persisted, but doesn't have to be. Every write of **one** persisted value MUST be atomic: a crash leaves either the old or the new value, never a partial one. An operation that changes several values (for example, a send changes the message store and the outbox) MAY write them one after another. REQ-PERSIST-002 orders those writes and REQ-PERSIST-003 repairs a crash between them.
- **REQ-PERSIST-002** [client] **Outbox invariant.** In a consistent state, every outbox id is unique and refers to a stored message with status `queued`, and every stored message with status `queued` is in the outbox. When an operation changes the message store and another value, the client writes the **message store first**, then the outbox, then the cursor. A crash after the store write and before the cursor write only makes the next sync re-deliver messages, which merging absorbs (REQ-SYNC-003). A crash between the store and outbox writes can leave only these inconsistencies:
  - a `queued` message that is missing from the outbox (crash during a send), or
  - an outbox id whose message is `sent` or `failed` (crash after an acknowledgement, a rejection, or a lost-ack upsert).
- **REQ-PERSIST-003** [client] **Load-time repair.** When persisted state is loaded (app start, process restart), the client restores REQ-PERSIST-002 before the UI shows the state and before the sync engine starts:
  1. Drop from the outbox every id that has no stored message, whose message is not `queued`, or that already appeared earlier in the outbox. Keep the remaining ids in their order.
  2. Append every `queued` message that is not in the outbox to its tail, ordered by `createdAt` ascending, then `id` ascending (the REQ-ORDER-001 order for messages without `seq`).
  3. If anything changed, persist the repaired outbox.

  The repair never changes a message's status and never deletes a message. On a consistent state it changes nothing.
