# chat-server: agent guide

This folder is one project of the Chat Generator repository. Unlike the clients, the server is **not** under
generator discipline: it is hand-directed code, written interactively with an agent and reviewed by a human.

- **Contract:** `../spec/core/20-protocol.md` (REQ-PROTO-*, REQ-SIM-*) plus `../spec/core/schemas/`. Any behavior
  change starts as a spec change.
- **Verification:** `npm test` (unit: validation, store) and, from the root, `npm run conformance` (black-box
  suite that checks every `[server]` requirement and validates payloads against the schemas). Both must pass.
- **Scope:** keep it trivial. Single process, in-memory, no auth, no persistence. The `/admin` network portal
  exists only to simulate per-user connectivity loss for demos and E2E.
- **Layout:** `src/validation.js` (value rules), `src/store.js` (messages, users, long-poll waiters), `src/app.js`
  (Express routes), `src/index.js` (process entry), `src/admin/portal.html` (portal UI).
