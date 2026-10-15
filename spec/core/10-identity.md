# 10 — Identity

## Name rule

A candidate name is **normalized** by removing leading and trailing Unicode
White_Space characters. The normalized name is **valid** iff it matches:

```
^[A-Za-z0-9_-]{1,32}$
```

Case is preserved and significant. Clients and the server apply the same rule.

## Requirements

- **REQ-ID-001** [client] On startup, if a persisted identity exists, the client MUST show the Conversations screen directly and start the sync engine. Otherwise it MUST show the Login screen, and the sync engine MUST NOT run.
- **REQ-ID-002** [client] Login normalizes the entered text with the name rule. If the normalized name is invalid, the client MUST stay on the Login screen, MUST show the `login-error` element with the exact text `Name must be 1-32 characters: letters, digits, '_' or '-'.`, and MUST NOT persist anything.
- **REQ-ID-003** [client] If the normalized name is valid, login is **local only**: no network request is made, and login succeeds while offline. The client MUST persist the normalized name as the identity, navigate to the Conversations screen, and start the sync engine. The persisted identity is the normalized name, not the raw input.
- **REQ-ID-004** [client] Logout MUST stop the sync engine (aborting any in-flight request), delete **all** local state (identity, message store, outbox, cursor), and show the Login screen with an empty `login-name` field. Queued messages are discarded. There is no confirmation prompt.
- **REQ-ID-005** [client] A new login after logout starts from empty state with cursor `0`. The client therefore receives that user's full history from the server on its first sync.

## Notes (non-normative)

- A server-side "account" does not exist. The server learns about a name the first time it sees it in an `X-Chat-User` header or as a message recipient.
- Two devices may log in with the same name. Both receive the same history, because sync covers all messages where the user is sender or recipient. Messages that I sent from another device appear with status `sent` (see `REQ-SYNC-002`).
