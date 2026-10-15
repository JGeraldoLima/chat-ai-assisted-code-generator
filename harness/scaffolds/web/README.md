# chat-webclient

The Chat Generator web client: Vite + React + TypeScript.

**Regeneration boundary:** `src/` is produced by the chatgen harness from the root
repo's `spec/`. Don't edit it by hand. Everything else here is the human-owned
toolchain scaffold. It's applied from the root repo's `harness/scaffolds/web/` template,
which the harness also uses to bootstrap this project from an empty folder.

```bash
npm ci
npm run dev        # http://localhost:5173 ; server expected at http://localhost:8080
npm test           # unit tests (Vitest + jsdom)
npm run build      # typecheck + production bundle
```

Point the client at another server with `VITE_CHATGEN_SERVER_URL` (see `.env.example`).
Provenance of the generated code is in `GENERATED.md`; requirement → test mapping in
`TRACEABILITY.md`; the independent spec review in `CONFORMANCE.md`.
