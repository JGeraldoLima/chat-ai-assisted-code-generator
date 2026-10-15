Use the `spec-conformance-reviewer` sub-agent to review the **{{target}}** client in `{{project}}/`
against the spec bundle at `{{bundlePath}}` (spec hash `{{specHash}}`).

The sub-agent writes its report to `{{project}}/CONFORMANCE.md`. When it finishes, reply with only the
report's summary line, in the form `violations=<n> unclear=<n> ok=<n>`.
