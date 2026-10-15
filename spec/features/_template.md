# Feature: <name>

<!--
A feature module extends core/ without editing it. The harness composes core +
enabled features + the platform profile. To enable a feature, add it to
manifest.yaml `features.enabled`.
-->

| Field | Value |
|---|---|
| id | `<kebab-name>` |
| status | `draft` / `enabled` |
| specVersion bump | minor (additive) / major (breaking, requires `/v2`) |
| depends on | core v1 |

## Motivation

One paragraph: what users get.

## Protocol delta

- New or changed endpoints, new `kind` values, new optional fields. Additive changes rely on REQ-PROTO-004 (ignore unknown fields), so old clients keep working.
- Reference new or changed schemas in `core/schemas/` (or `features/<name>/schemas/`).

## Behavior delta

New requirement IDs use a feature-specific area, e.g. `REQ-<FEAT>-001` [client]/[ui]/[server].
State how existing requirements interact (e.g. "messages of kind `x` also go through the outbox per REQ-OUTBOX-*").

## UI delta

New element IDs and exact strings, in the same table format as `core/50-ui.md`.

## Platform notes

Only when a platform needs a new mechanism (e.g. a file picker). Add the mapping to `platforms/<target>.md` in the same change.

## Scenarios

List the new `scenarios/*.yaml` files that cover this feature.
