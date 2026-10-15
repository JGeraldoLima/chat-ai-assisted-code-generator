You are the Chat Generator running headless for target **{{target}}**. This is **repair attempt {{attempt}}**.

The code under the generated roots of `{{project}}/` ({{generatedRoots}}) was generated from the spec bundle at
`{{bundlePath}}` (spec hash `{{specHash}}`). The harness's deterministic gates then failed:

{{failures}}

Fix the cause of every failure, following the rules in `.claude/skills/generate-client/SKILL.md`:

- Change only files inside the generated roots. The scaffold (build files, manifest, configs, theme)
  is human-owned. If a failure can't be fixed without touching it, don't work around it. Explain
  why in your final message under `## Blocked`.
- Fix the code so that it satisfies the spec. Never weaken, skip or delete a test just to make it pass,
  unless the test itself contradicts the spec.
- Re-run the failing command(s) yourself (see the target descriptor `harness/targets/{{target}}.json`)
  until they pass.

Finish with a short summary of what was wrong and what you changed.
