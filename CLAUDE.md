# chat-webclient: agent guide

This repo is a submodule of the Chat Generator root repo. Its application code is **generated**.

| Path | Owner | Rule |
|---|---|---|
| `src/**` | **generated** by chatgen-harness | Never hand-edit. Change `../spec/` and run `node harness/regen.mjs web` from the root. |
| `GENERATED.md`, `TRACEABILITY.md`, `CONFORMANCE.md` | harness reports | Rewritten on every run |
| everything else (`package.json`, lockfile, `index.html`, `vite.config.ts`, `tsconfig*.json`, `.oxlintrc.json`, `public/`) | human-owned scaffold | Change deliberately in a `scaffold:` commit, never during generation |

Behavior is defined by `../spec/core/*` (platform-neutral) and `../spec/platforms/web.md`
(web mechanisms). Answer behavior questions from the spec, not from `src/`.

Commands: `npm ci` · `npm run build` · `npm run lint` · `npm test` · `npm run dev` (http://localhost:5173, expects the server on :8080).
