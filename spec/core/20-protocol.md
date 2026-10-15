# 20 — Wire protocol (v1)

HTTP/1.1 + JSON (UTF-8). All protocol paths are under `/v1`. Each platform
profile configures the base URL (for example `http://localhost:8080`).
Payload shapes are normative in `schemas/*.schema.json`. This document defines
semantics.

## Common rules

- **REQ-PROTO-001** [client] Every request to `/v1/messages` MUST carry the header `X-Chat-User: <me>`. Requests with a JSON body MUST send `Content-Type: application/json`.
- **REQ-PROTO-002** [server] The server MUST answer CORS preflights for any origin, allowing methods `GET, POST, OPTIONS` and headers `Content-Type, X-Chat-User`. All responses carry `Access-Control-Allow-Origin: *`.
- **REQ-PROTO-003** [server] Every error response has a 4xx/5xx status and the body `{"error":{"code":"<code>","message":"<text>"}}` (`error.schema.json`). Clients branch only on the status and `code`, never on `message`.
- **REQ-PROTO-004** [client] [server] Receivers MUST ignore unknown JSON fields. Senders MUST NOT rely on the receiver echoing unknown fields. This is the forward-compatibility rule that lets features add fields.

## The message object (`message.schema.json`)

| Field | Type | Set by | Rule |
|---|---|---|---|
| `id` | string | client | Lowercase UUID, `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`. Clients generate random v4 UUIDs. Globally unique, and the idempotency key. |
| `kind` | string | client | `"text"` in v1. Features may add kinds. |
| `from` | string | client | Valid name. Equals the `X-Chat-User` header. |
| `to` | string | client | Valid name, `to != from`. |
| `body` | string | client | Not blank (contains at least one non-White_Space character), at most 1000 code points. Stored and delivered **verbatim** (not trimmed). |
| `createdAt` | timestamp | client | Client clock at send time. |
| `seq` | integer >= 1 | server | Global, strictly increasing, assigned once at first acceptance. |
| `receivedAt` | timestamp | server | Server clock at first acceptance. |

## `POST /v1/messages`: send

Request body: `send-request.schema.json`, which holds `{id, kind?, from, to, body, createdAt}`. If `kind` is omitted it means `"text"`.

- **REQ-PROTO-010** [server] Validation is performed **in this order**, and the first failure wins (status 400 unless noted):
  1. `X-Chat-User` missing or invalid name → `invalid_user`
  2. body not a JSON object → `invalid_json`
  3. `from` != `X-Chat-User` → `sender_mismatch`
  4. `id` invalid → `invalid_id`
  5. `kind` present and not a supported kind → `unsupported_kind`
  6. `to` invalid name → `invalid_recipient`
  7. `to == from` → `self_message`
  8. `body` not a string, blank, or > 1000 code points → `invalid_body`
  9. `createdAt` not a valid timestamp → `invalid_created_at`
- **REQ-PROTO-011** [server] If a message with the same `id` already exists:
  - If `kind`, `from`, `to`, `body` and `createdAt` are all identical, respond **200** with the stored message, unchanged (idempotent retry).
  - Otherwise respond **409** `id_conflict`.
- **REQ-PROTO-012** [server] Otherwise assign `seq` = previous max + 1 and `receivedAt` = now, store the message, wake matching long-polls (REQ-PROTO-022), and respond **201** with the stored message. The recipient does not need to have ever connected (store-and-forward).
- **REQ-PROTO-013** [client] Clients MUST treat 200 and 201 identically, as an acknowledgement carrying the authoritative stored message.

## `GET /v1/messages?after=<seq>&wait=<seconds>`: sync

- **REQ-PROTO-020** [server] Parameters:
  - `after`: integer >= 0, default `0`.
  - `wait`: integer >= 0, default `0`. Values above 30 are clamped to 30.
  - A malformed value gives 400 `invalid_cursor` or `invalid_wait`.
  - The `X-Chat-User` rule is the same as for POST (`invalid_user`).
- **REQ-PROTO-021** [server] The **result set** is all stored messages where `from == user` or `to == user` and `seq > after`, in ascending `seq` order, truncated to the first **100**. The response is `sync-response.schema.json`: `{"messages":[...], "cursor":<n>, "hasMore":<bool>}`.
  - `cursor` is the `seq` of the last returned message, or `after` if none were returned.
  - `hasMore` is true iff the result set was truncated.
- **REQ-PROTO-022** [server] If the result set is empty and `wait > 0`, the server holds the request. It responds as soon as a matching message is stored, or after `wait` seconds with `{"messages":[],"cursor":<after>,"hasMore":false}`.
- **REQ-PROTO-023** [client] Clients MUST set their cursor to the response's `cursor` and MUST NOT compute it themselves.

## `GET /v1/health`

- **REQ-PROTO-030** [server] Responds 200 `{"status":"ok","serverTime":<timestamp>}`. This endpoint is never subject to network simulation and needs no header.

## Network simulation portal (server only)

Simulates a user losing connectivity so that every client goes through its **real** network-failure path, with no client-side test hooks.

- **REQ-SIM-001** [server] The server keeps a per-name network flag, `online` by default. While a name is `offline`, every `/v1/messages` request whose `X-Chat-User` is that name MUST be terminated by destroying the TCP connection, with no HTTP response. Clients observe a connection reset, exactly like a dropped network. CORS preflights are not affected.
- **REQ-SIM-002** [server] Setting a name `offline` MUST immediately destroy the connections of that user's in-flight long-polls.
- **REQ-SIM-003** [server] Admin endpoints are never subject to simulation:
  - `GET /admin`: HTML portal listing known users with their network flag (with a toggle button), pending long-polls, and the message log. It refreshes automatically.
  - `GET /admin/api/state` → `{"users":[{"name","online","pendingPolls","lastSeenAt"}], "messages":[...]}`
  - `POST /admin/api/users/:name/network`, body `{"online":<bool>}`, → 200 with that user's entry. The name becomes known if it wasn't already.
  - `POST /admin/api/reset` clears all messages, users and flags, and resets `seq` to 0. It destroys in-flight long-polls.
- **REQ-SIM-004** [server] A name becomes *known* when it appears as a valid `X-Chat-User` or as a stored message's `to`.
