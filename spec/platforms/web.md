# Platform profile: web

This profile defines only **how** the web client realizes `core/`. It adds no
behavior. When in doubt, `core/` wins.

## Stack (fixed by the human-owned scaffold)

- Vite + React + TypeScript (`strict`), as pinned in `webclient/package.json`.
- Runtime dependencies: **only** `react` and `react-dom`. No state, routing, HTTP, UUID, date or messaging libraries.
- Test dependencies (already in the scaffold): `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/dom`. Tests import APIs explicitly (`import { describe, it, expect, vi } from 'vitest'`); there are no globals.
- Lint: `oxlint --deny-warnings` with the scaffold's `.oxlintrc.json` (React hooks rules). Warnings fail the gate.
- TypeScript is strict-ish via `tsconfig.app.json`: `verbatimModuleSyntax` (use `import type` for types), `erasableSyntaxOnly` (no `enum`, no parameter properties, no namespaces), `noUnusedLocals`, `noUnusedParameters`. `vite/client` types are already included, so don't create `vite-env.d.ts`.
- The generator MUST NOT edit `package.json`, the lockfile, `index.html`, `vite.config.ts`, the `tsconfig*.json` files, `.oxlintrc.json` or `public/`. If it needs something they don't provide, it stops and reports. It never works around the scaffold.

## Scaffold contract

| Provided by the scaffold | Required from the generator |
|---|---|
| `index.html` loads `/src/main.tsx` and has `<div id="root">` | `src/main.tsx` renders the app into `#root` |
| `import.meta.env.VITE_CHATGEN_SERVER_URL` (optional) | `src/config.ts` exports `SERVER_URL`: that env value or `http://localhost:8080` |
| `vitest` configured with `environment: 'jsdom'` and `include: ['src/**/*.test.{ts,tsx}']` | Tests colocated as `src/**/*.test.ts(x)` |

## Mechanisms (core concept → web realization)

| Core concept | Web realization |
|---|---|
| Element ID (`50-ui.md`) | `data-testid="<id>"` on the element itself. Inputs are `<input>`; `composer-input` may be a `<textarea>`. Buttons are `<button>`. |
| Persistence (REQ-PERSIST-001) | `localStorage` keys `chatgen.v1.identity` (string), `chatgen.v1.messages` (JSON array), `chatgen.v1.outbox` (JSON array of ids) and `chatgen.v1.cursor` (number). Every `setItem` is atomic. Write the message store **before** the outbox. Single-tab use is assumed. |
| UUID | `crypto.randomUUID()` |
| Timestamp | `new Date().toISOString()` (always ms precision with `Z`) |
| Code-point length | `[...str].length` |
| White_Space trim / blank test | `str.trim()`; blank ⇔ `str.trim() === ''` |
| HTTP | `fetch`, with an `AbortController` per request for timeouts and wake-aborts. A `TypeError` from `fetch` is a network error. |
| Wake: network available | `window` `online` event |
| Wake: foreground | `document` `visibilitychange` → `visible` |
| Engine lifetime | One module-level engine instance, started and stopped by the app shell according to identity (REQ-CONN-007). It must survive React StrictMode double-invocation: start is idempotent. |
| Time display `HH:mm` | Local time, zero-padded 24-hour, e.g. `09:05` |
| Back navigation | `thread-back` button. Browser history integration is not required. |

## Architecture

Keep it small and layered. Same responsibilities as the Android client, so the two stay comparable:

```
src/
  main.tsx, App.tsx          app shell: screen routing from state (no router lib)
  config.ts
  domain/                    pure TS, no DOM/React: types, nameRule, bodyRule, ordering, merge
  data/                      api.ts (fetch client), storage.ts (localStorage stores),
                             syncEngine.ts (the 40-connectivity cycle; injectable fetch/clock/sleep/uuid)
  ui/                        React screens + hooks (a hook per screen acts as its view-model)
  styles.css
```

- The sync engine is a plain TypeScript class with injected dependencies (`fetchFn`, `now`, `sleep`, `randomUUID`, `storage`), so tests can drive it with fakes and fake timers.
- UI state flows one way: engine/store → subscribe → React state. Components never call `fetch`.

## Quality bar

- Every `[client]` requirement ID has at least one test whose `it/test` name contains the ID, e.g. `it('REQ-OUTBOX-001 sends strictly FIFO, one at a time', …)`.
- Pure domain functions get table-driven tests. The sync engine is tested with a fake `fetch` (scripted responses, network errors via a rejected promise, resets), fake timers for backoff, and wake.
- `npm run build` (typecheck + bundle), `npm run lint` and `npm test` MUST pass with zero errors.
- Accessibility: inputs have associated labels or `aria-label`; buttons have text.

## Commands

| Purpose | Command (run in `webclient/`) |
|---|---|
| Install | `npm ci` |
| Build + typecheck | `npm run build` |
| Lint | `npm run lint` |
| Unit tests | `npm test` |
| Dev server | `npm run dev` (http://localhost:5173) |
| Preview the production build | `npm run preview -- --port 4173 --strictPort` |
