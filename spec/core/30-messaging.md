# 30 — Messaging (client behavior)

## Local data model

A **local message** is a protocol message plus client bookkeeping:

| Field | Notes |
|---|---|
| `id`, `kind`, `from`, `to`, `body`, `createdAt` | As in the protocol |
| `seq` | `null` until acknowledged or synced |
| `receivedAt` | `null` until acknowledged or synced |
| `status` | One of `queued`, `sent`, `received`, `failed` |
| `errorCode` | Server `error.code` when `status == failed`, else `null` |

**Status meaning:**

| Status | Meaning |
|---|---|
| `queued` | Created on this client, in the outbox, not yet acknowledged |
| `sent` | `from == me` and the server holds it (has `seq`) |
| `received` | `from != me` and it came from the server (has `seq`) |
| `failed` | The server rejected it with 400/409. It will never be retried. No `seq`. |

- **REQ-MSG-001** [client] Status transitions are only:
  - `queued → sent` (REQ-OUTBOX-002 or REQ-SYNC-002)
  - `queued → failed` (REQ-OUTBOX-004)
  - insert as `sent` / `received` (REQ-SYNC-002)

  No other transition exists. In particular `sent`, `received` and `failed` are terminal.

## Sending

- **REQ-SEND-001** [client] Body validation happens on the client when the user presses Send. It uses the protocol body rule (not blank, at most 1000 code points). On failure, nothing is created, the input keeps its text, and `composer-error` shows exactly one of these:
  - blank: `Message cannot be empty.`
  - too long: `Message is too long (max 1000 characters).`
- **REQ-SEND-002** [client] A valid send creates a local message with:
  - `id`: new random v4 UUID, lowercase
  - `kind`: `"text"`
  - `from`: me
  - `to`: the open thread's peer
  - `body`: the input text **verbatim**
  - `createdAt`: now, as a timestamp
  - `status`: `queued`
  - `seq`, `receivedAt`, `errorCode`: `null`
- **REQ-SEND-003** [client] The new message MUST be durably written to the message store **and** appended to the tail of the outbox before the UI reflects it. After the write, the client clears the input and hides `composer-error`.
- **REQ-SEND-004** [client] After a send is persisted, the client MUST **wake** the sync engine (REQ-CONN-005). Sending never performs network I/O directly. All sends go through the outbox, online or not.

## Outbox flush

- **REQ-OUTBOX-001** [client] Flushing is strictly FIFO and sequential: at most one `POST /v1/messages` is in flight per client at any time, and it is always for the outbox **head**. Messages are never reordered or sent in parallel.
- **REQ-OUTBOX-002** [client] On 200/201, the client updates the local message from the response (`seq`, `receivedAt`, status `sent`), removes it from the outbox head, and continues with the next head.
- **REQ-OUTBOX-003** [client] On a network error, timeout, connection reset or any 5xx, the head stays in the outbox with status `queued`, and the flush stops. This counts as a **failed request** (REQ-CONN-003).
- **REQ-OUTBOX-004** [client] On 400 or 409, the client sets the message's status to `failed` and `errorCode` to the response `error.code`, removes it from the outbox, and continues with the next head. The request reached the server, so this counts as a **successful request** for connection state.
- **REQ-OUTBOX-005** [client] The outbox and message store survive app restart and process death. After restart, queued messages are still `queued`, in the same order, and are flushed by the engine's next cycle.

## Sync merge

- **REQ-SYNC-001** [client] A sync request is `GET /v1/messages?after=<cursor>&wait=<w>`:
  - `w = 0` if the previous sync response in this engine run had `hasMore == true`.
  - Otherwise `w = 25`.
- **REQ-SYNC-002** [client] Each received message is **upserted** by `id`:
  - **Existing id:** set `seq`, `receivedAt` and the protocol fields from the server copy. Set status to `sent` if `from == me`, else `received`. If the id is in the outbox (its POST acknowledgement was lost), remove it from the outbox.
  - **New id:** insert it with status `sent` if `from == me`, else `received`.
- **REQ-SYNC-003** [client] After merging a response, the client sets the cursor to the response `cursor` (REQ-PROTO-023). The merged messages and the new cursor MUST be persisted before the next request is issued. Merging is idempotent: re-receiving a message has no further effect.
- **REQ-SYNC-004** [client] Messages whose `kind` the client does not support are stored and shown, with display body `Unsupported message`. They count as normal messages for ordering and conversation membership.

## Ordering

- **REQ-ORDER-001** [client] Within a conversation, messages are ordered:
  1. All messages with a `seq`, ascending by `seq`.
  2. Then all messages without a `seq` (`queued` or `failed`), ascending by `createdAt`, ties broken by `id` ascending.

  This order is a pure function of the stored data. Every platform MUST produce the same order for the same data.
- **REQ-ORDER-002** [client] Conversations (one per peer that has at least one message) are ordered by the activity time of their **last** message in REQ-ORDER-001 order, newest first. A message's activity time is its `receivedAt`, or its `createdAt` if `receivedAt` is null. Ties are broken by peer name, ascending (code-point order).

## Persistence

- **REQ-PERSIST-001** [client] The persisted state is exactly: identity, message store, outbox (ordered ids) and cursor. UI state such as the open thread or draft text MAY be persisted, but doesn't have to be. Every write MUST be atomic: a crash leaves either the old or the new value, never a partial one.
