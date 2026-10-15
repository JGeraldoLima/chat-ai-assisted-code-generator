# 00 — Glossary

| Term | Definition |
|---|---|
| **User** | A person identified only by a **name**. There are no passwords and no accounts. |
| **Name** | A string matching the *name rule* (see `10-identity.md`). Case-sensitive: `Alice` and `alice` are different users. |
| **Me** | The user currently logged in on this client. |
| **Message** | An immutable record `{id, kind, from, to, body, createdAt}`. The server adds `seq` and `receivedAt` (see `20-protocol.md`). |
| **Peer** | For a message on my client: `to` if `from == me`, otherwise `from`. |
| **Conversation** | All messages on my client that share the same peer. Identified by the peer's name. |
| **Thread** | The UI view of one conversation. |
| **Message store** | The client's persisted set of messages, keyed by `id`. |
| **Outbox** | The client's persisted FIFO list of message ids not yet acknowledged by the server. |
| **Cursor** | The highest server `seq` the client has merged. Persisted. Starts at `0`. |
| **Sync engine** | The single client component that performs all network I/O: outbox flush plus long-poll sync (see `40-connectivity.md`). |
| **Flush** | Sending outbox messages to the server, head first, until the outbox is empty or a request fails. |
| **Sync request** | One `GET /v1/messages` long-poll. |
| **Online / Offline** | The client's connection state: whether its **most recent** request reached the server (see `REQ-CONN-001`). |
| **Wake** | A signal that interrupts the sync engine's waiting so it starts a new cycle immediately. |
| **Network portal** | The server's `/admin` page and API, which simulate a user being offline by cutting that user's connections. |
| **Code point** | A Unicode scalar value. All length limits count code points, not bytes or UTF-16 units. |
| **Timestamp** | A UTC instant serialized exactly as `YYYY-MM-DDTHH:mm:ss.sssZ` (always 3 fractional digits, always `Z`). Example: `2026-10-15T13:04:05.120Z`. |
