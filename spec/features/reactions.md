# Feature: reactions

| Field | Value |
|---|---|
| id | `reactions` |
| status | **draft** (not in `manifest.yaml` `features.enabled`, so not generated) |
| specVersion bump | minor (additive) |
| depends on | core v1 |

> This draft is here to show how the spec evolves. The protocol, offline queue
> and ordering machinery are reused unchanged. Enabling the feature is a spec
> edit plus a server change. The harness doesn't change.

## Motivation

Users can react to a message with a single emoji. Reactions follow the same
offline rules as text: they queue, flush FIFO and sync.

## Protocol delta

- New message `kind`: `"reaction"`. The message fields are reused as follows:
  - `body`: the emoji. Exactly one extended grapheme cluster, at most 16 code points.
  - New field `refId`: the `id` of the message being reacted to. The target must be in the same conversation.
- The server accepts `kind: "reaction"` (it no longer returns `unsupported_kind` for it). It validates `refId` as a UUID (`invalid_ref`); it does not check that the target exists, so a reaction can be queued before its target syncs.
- Old v1 clients render reactions as `Unsupported message` (REQ-SYNC-004). That's acceptable degradation.

## Behavior delta

- **REQ-REACT-001** [client] Reacting creates a `kind: "reaction"` message and sends it through the outbox (REQ-SEND-002..004, REQ-OUTBOX-*). There is no separate path.
- **REQ-REACT-002** [client] Reaction messages are **not** rows in the thread. They are aggregated onto their target: per target, the latest reaction (by REQ-ORDER-001 order) of each user wins.
- **REQ-REACT-003** [client] A reaction whose target isn't (yet) in the store is kept, and shown once the target arrives.
- **REQ-REACT-004** [client] For REQ-ORDER-002, a reaction counts as activity in its conversation.

## UI delta

| Screen | Element ID | Kind | Content / behavior |
|---|---|---|---|
| Thread | `message-react` | button (inside `message-row`) | Label `React`. Opens a picker with 👍 ❤️ 😂 |
| Thread | `message-reactions` | text (inside `message-row`) | The aggregated reactions, e.g. `👍 Bob`. Absent if there are none. |

## Scenarios

- `scenarios/reactions-offline.yaml` (to be written when enabled): Bob reacts while offline. The reaction shows `queued` locally and appears on Alice's message after reconnect.
