---
name: verify-client
description: Verify a Chat Generator client against the spec without regenerating it. Runs the deterministic gates (boundary, traceability, build, lint, unit tests), the spec-conformance review, and optionally the cross-platform E2E scenarios. Use when asked to check, validate or verify a client.
argument-hint: <web|android> [--e2e]
---

# verify-client

Checks the code currently in a target's generated roots. Never modifies generated code.

1. Run the deterministic gates and the review:
   ```bash
   node harness/regen.mjs <target> --gates-only --yes
   ```
   `--yes` confirms the review's token spend (about $1–2; the gates themselves cost nothing). Use `--no-review` instead to check only the gates.
   This writes `<project>/TRACEABILITY.md`, `<project>/CONFORMANCE.md` and `<project>/GENERATED.md`.
   If a gate fails, the harness starts its repair loop. Pass `--max-repairs 0` for a pure check.
2. With `--e2e`, also run the executable scenarios against the client, paired with the headless reference client:
   ```bash
   node e2e/runner.mjs --all --bind alice=<target>
   node e2e/runner.mjs --all --bind bob=<target>
   ```
   Android needs a running emulator (see the root README).
3. Report every failing gate or scenario step verbatim, the requirement IDs involved, and whether the fault is in the **client** (regenerate or repair) or in the **spec** (ambiguous or contradictory, so fix the spec).
