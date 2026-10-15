# FUTURE

What I'd do next with more time, roughly in priority order.

## Generator / harness

1. **Spec linting agent.** A `/review-spec` skill plus a `spec-reviewer` sub-agent that reads a spec change and
   flags ambiguity *before* generation: undefined terms, missing error strings, untestable requirements, scenario
   gaps. Today ambiguities surface after generation (in the `## Spec ambiguities` section of each run summary) or
   through the reference E2E run.
2. **Differential regeneration.** Pass the previous generated code and the spec diff to the agent, so a small spec
   change gives a small, reviewable code diff. Today every run regenerates from a clean slate, which is the
   right default for the "delete and regenerate" criterion but noisy for day-to-day evolution.
3. **Stability metrics.** Regenerate N times per target and record the gate pass rate, repair attempts, cost and
   scenario pass rate. Treat a drop as a regression of the spec or the harness.
4. **CI.** A pipeline that runs `test:harness`, `conformance`, the reference scenarios, and a nightly "delete +
   regenerate + full E2E matrix" on a machine with an emulator. Gate merges to `spec/` on it.
5. **Codex parity runner.** `regen.mjs --agent codex`, driving `codex exec` with the same prompts and gates. The
   procedure is already tool-agnostic (`AGENTS.md`).
6. **Scaffold as a generated-but-reviewed layer.** Let the generator *propose* scaffold changes (a new dependency
   for a feature) as a separate patch that a human approves, instead of stopping with `## Blocked`.

## Spec / protocol

1. **Enable `features/reactions.md`**, then attachments (a `kind: "attachment"` with an upload endpoint) and group
   conversations (`to` becomes a conversation id, with membership rules), each as a feature module with its own
   scenarios.
2. **WebSocket push transport** as an alternative to long-poll, kept behind the same engine contract
   (flush-before-sync, cursor, wake), and negotiated through a capability header.
3. **Delivery/read receipts.** Server-side `deliveredAt`/`readAt` events in the same seq stream.
4. **Retry for `failed` messages** (manual resend creating a new id), and outbox size limits.
5. **Multi-tab web** (BroadcastChannel leader election, so there's one engine per user per browser).

## Clients / quality

1. **Faster Android E2E.** Replace `uiautomator dump` polling with a small instrumentation-based driver, or run
   Compose UI tests generated from the same scenarios.
2. **Android background sync** via WorkManager when the app isn't in the foreground (out of scope here by design).
3. **Accessibility scenarios.** Assert labels and focus order from the UI contract on both platforms.
4. **Visual snapshots** per platform (not cross-platform). They catch unintended UI churn between regenerations.

## Server

Persistence (SQLite), auth tokens instead of a trusted header, rate limits, and a proper admin auth. The
brief explicitly scoped these out.
