# Scenarios: executable acceptance tests

A scenario is a platform-neutral YAML script. `e2e/runner.mjs` executes it by
binding each **actor** to a **driver** (`web`, `android` or `reference`).
Because the same file runs against every binding, both clients must behave
identically. A scenario is normative: if a client fails one, the client is
wrong, or the spec is ambiguous and has to be fixed.

```
node e2e/runner.mjs spec/scenarios/alice-bob-offline.yaml --bind alice=web,bob=android
```

Actors that aren't bound default to the `reference` driver, a headless
implementation of the client spec.

## File format

```yaml
id: <kebab-case>
title: <one line>
covers: [REQ-..., ...]        # requirement IDs this scenario verifies (traceability)
actors:
  alice: { name: Alice }      # actor key -> logged-in name
steps:
  - <op>: { ...args }         # each step is a single-key map
```

## Operations

Expectations poll until they match or until `timeout` passes (default **15 s**).
The default covers the 10 s reconnect guarantee in `core/40-connectivity.md`
plus slack. Everything else runs once and fails immediately on error.

| Op | Args | Meaning |
|---|---|---|
| `reset` | none | Server `POST /admin/api/reset`. All network flags go back to online. |
| `launch` | `actor` | Start the actor's client with **empty local state** (fresh install). |
| `restart` | `actor` | Kill the actor's client and start it again, **keeping** local state. |
| `login` | `actor`, `name?` | On Login: type `name` (default: the actor's name) into `login-name` and press `login-submit`. Expect the Conversations screen, with `me-name` equal to the normalized name. |
| `loginExpectError` | `actor`, `name`, `error` | Same input, but expect to stay on Login with `login-error` == `error`. |
| `openThread` | `actor`, `peer` | Go to Conversations if needed, type `peer` into `new-conversation-peer` and press `new-conversation-open`. Expect Thread with `thread-peer` == normalized `peer`. A no-op if that thread is already open. |
| `openThreadExpectError` | `actor`, `peer`, `error` | Same input, but expect to stay on Conversations with `new-conversation-error` == `error`. |
| `send` | `actor`, `to`, `body` | `openThread(to)`, type `body` into `composer-input`, press `composer-send`. Expect `composer-input` to be empty. |
| `sendExpectError` | `actor`, `to`, `body`, `error` | Same, but expect `composer-error` == `error`, with the input still holding `body`. |
| `network` | `actor`, `online` | Portal: `POST /admin/api/users/<name>/network`. This is not a client action. |
| `expectConnection` | `actor`, `status`, `queued?` | `connection-status` == `status`, and `queued-count` == `<queued> queued` if `queued` is given. |
| `expectThread` | `actor`, `peer`, `messages` | `openThread(peer)`. The `message-row`s, in order, must equal `messages` exactly. Each item is `{from, body, status}`. An empty list means `thread-empty` is shown. |
| `expectConversations` | `actor`, `peers`, `previews?` | Go to Conversations. The `conversation-peer` values, in order, must equal `peers`, and the `conversation-preview` values must equal `previews` if given. An empty `peers` list means `conversations-empty` is shown. |
| `expectLastVisible` | `actor`, `peer`, `body` | `openThread(peer)`. The last `message-row` has `message-body` == `body` **and** is inside the visible viewport (auto-scroll). |
| `expectScreen` | `actor`, `screen` | The current screen is `login`, `conversations` or `thread`. |
| `logout` | `actor` | Go to Conversations and press `logout`. Expect Login. |
| `expectServer` | `messages` | Server `GET /admin/api/state`: messages in seq order must equal the list exactly. Each item is `{from, to, body}`. |

`body` may be a string or `{repeat: <string>, count: <n>}` (the string repeated `n` times).
