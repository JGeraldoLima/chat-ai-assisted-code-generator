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
5. **Codex regeneration parity — done (2026-10-16).** Clean regeneration with `regen.mjs all --agent codex`
   completed for Android and web. Both passed their build, unit-test, boundary, traceability and conformance
   review gates; web also passed lint. Android needed one automatic repair, web none. Both regenerated clients
   were launched for manual testing. Follow-ups: run the full E2E matrix, record comparable usage/cost estimates,
   and verify `--resume` on a real interruption.
6. **Scaffold as a generated-but-reviewed layer.** Let the generator *propose* scaffold changes (a new dependency
   for a feature) as a separate patch that a human approves, instead of stopping with `## Blocked`.

7. **AI IDE / coding-agent agnostic.** Generalize the agent adapter beyond Claude Code and Codex so other
   AI IDEs and coding agents can use the same spec bundle, generation procedure, boundaries, gates and review
   contract. Define capability checks and adapters for invocation, authentication, progress, usage and resume;
   keep the core workflow independent of any vendor's CLI or IDE-specific skills/hooks.
8. **Cloud deployment entry points for server and web.** Add scriptable preflight, plan, deploy and verify
   commands that an agent can run after generation. Before generating or changing cloud resources, validate
   IAM identity, target account/project and region, required permissions, service availability, quotas and
   configuration viability. Report blockers and the proposed resources/cost assumptions up front. Deploy the
   server and web client with the correct API URL, then verify health, connectivity and access. Prefer existing
   IAM roles or short-lived credentials; make deployments repeatable and provide rollback/teardown commands.

## Spec / protocol

0. **Spec v1.2 from the v1.1 reviews.** Spec v1.1 (see `spec/CHANGELOG.md`) resolved the v1.0 findings.
   The v1.1 reviews left one "unclear" item per client, plus two observations:
   - an id collision between a local `queued`/`sent` message and a server copy with a different `from`
     (REQ-MSG-001 vs REQ-SYNC-002; REQ-SYNC-005 covers only `failed`), from `webclient/CONFORMANCE.md`;
   - the deletion order on logout vs the REQ-PERSIST-002 write order (`client/CONFORMANCE.md`);
   - REQ-SEND-001 precedence when a body is both blank and over 1000 code points;
   - whether REQ-CONN-008 "integer" means a lexical JSON integer or any integral number (`1.0`, `1e2`);
   - the Android profile's wording on `Modifier.clickable` vs "MUST NOT use `mergeDescendants`", and its
     "observe the identity flow" engine-lifetime mechanism, which a reviewer considered racy.
   Also unspecified: what happens when a persistent write itself fails (disk full, `QuotaExceededError`).

   Also in v1.2, fix a **known defect: Android auto-scroll with the keyboard open** (REQ-UI-007, the
   `long-thread` scenario, intermittent with Android as Alice). After `scrollToItem(lastIndex)`, the
   keyboard shrinks the viewport and the newest messages can end up below the visible area (details in
   `DESIGN.md` section 7). Fix it in `spec/platforms/android.md`: require the list to stay anchored to the
   newest item when the viewport changes, e.g. `LazyColumn(reverseLayout = true)` over reversed messages.
   Then run `node harness/regen.mjs android --no-clean` (about $4–5) and the Android E2E bindings.
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

5. **More shared core use cases on Android and web.** Specify and test edge cases such as opening a chat with
   a user who does not exist. The current name-only identity model needs a clear definition of when a user
   exists, a server-side lookup contract, and distinct UI behavior for an unknown user versus an unavailable
   lookup while offline. Define validation/error strings, retry behavior and when a conversation is created;
   add shared executable scenarios and regenerate both clients from the updated spec.

## Server

Persistence (SQLite), auth tokens instead of a trusted header, rate limits, and a proper admin auth. The
brief explicitly scoped these out.
