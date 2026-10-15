# Chat Generator specification

The **source of truth** for Chat Generator clients. If code and spec disagree, the code
is wrong. If the spec is silent or ambiguous, fix the spec, then regenerate.

## Layout

| Path | What it holds | Platform-specific? |
|---|---|---|
| `manifest.yaml` | Spec version, which modules are composed, enabled features, targets | no |
| `CHANGELOG.md` | What changed in each spec version, and which finding it resolves. Not composed into the bundle | no |
| `core/00-glossary.md` | Vocabulary used everywhere else | no |
| `core/10-identity.md` | Login / logout / identity rules | no |
| `core/20-protocol.md` | HTTP wire protocol (server + client obligations) and the network-simulation portal | no |
| `core/30-messaging.md` | Local data model, send path, outbox, sync merge, display order | no |
| `core/40-connectivity.md` | Sync engine cycle, online/offline state, backoff, wake-ups, timeouts | no |
| `core/50-ui.md` | Abstract UI contract: screens, element IDs, exact strings | no |
| `core/schemas/*.schema.json` | JSON Schemas for every wire payload | no |
| `scenarios/*.yaml` | Executable acceptance scenarios (platform-neutral) | no |
| `features/*.md` | Optional feature modules that extend core (see `features/_template.md`) | no |
| `platforms/<target>.md` | **Only** how a target realizes core: stack, storage, test-ID mechanism, layout, commands, scaffold contract | yes |

## Precedence

1. `core/` and enabled `features/` define **what** happens. They are identical for every target.
2. `platforms/<target>.md` defines **how** one target does it. It may not change behavior; it can only choose mechanisms.
3. Vendored skills (`.claude/skills/*`) are advisory. Where a skill disagrees with the spec, the spec wins.

## Requirement IDs

Every normative rule has an ID of the form `REQ-<AREA>-<NNN>` followed by a tag:

| Tag | Meaning | Verified by |
|---|---|---|
| `[client]` | Client behavior logic | Unit tests in **each** generated client. The test name or a `@req` comment must contain the ID (traceability gate) |
| `[ui]` | Observable UI contract | Scenarios in `scenarios/` (each scenario lists the IDs it covers), optionally also component tests |
| `[server]` | Server obligation | `conformance/` suite against the server |

IDs are never reused or renumbered. A removed requirement is marked `(withdrawn)`.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## Versioning

- `specVersion` (in `manifest.yaml`) follows semver. Behavior change → minor. Breaking protocol change → major, plus a new `/vN` protocol prefix.
- Generated code records the hash of the composed spec it was built from (`GENERATED.md` in each generated root).

## Adding a feature

1. Copy `features/_template.md` to `features/<name>.md` and fill in the requirements, protocol deltas and UI deltas.
2. Add new scenarios under `scenarios/` that cover it.
3. Add the feature to `features.enabled` in `manifest.yaml`.
4. Update the server (outside generator discipline) and run `npm run conformance`.
5. Regenerate the clients (`node harness/regen.mjs all`). No harness code changes are needed.
