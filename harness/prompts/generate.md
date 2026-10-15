You are the Chat Generator running headless for target **{{target}}**.

Follow the procedure in `.claude/skills/generate-client/SKILL.md` exactly, for target `{{target}}`.
Preparation (step 1 of that procedure) has already been done by `harness/regen.mjs`:

- The generated roots of `{{project}}/` have been deleted: {{generatedRoots}}.
- The composed spec bundle (spec hash `{{specHash}}`) is at `{{bundlePath}}`. Read it completely before writing any code.
- The target descriptor is `harness/targets/{{target}}.json`.

Start at step 2. You are not interactive, so nobody will answer questions. When the spec is
ambiguous, choose the reading most consistent with `spec/core/` and the scenarios, and record the
ambiguity in your final message under the heading `## Spec ambiguities`, so a human can fix the
spec.

Finish with a short summary: the files you created, the result of your self-verification
(the build and test commands you ran), and any spec ambiguities.
