# ATTRIBUTION

Who or what produced each artifact. Commit trailers match this table:

- `Co-Authored-By: Claude …`: agent-assisted interactive work.
- `Generated-by: chatgen-harness …`: harness output.

| Category | Artifacts | How they were made |
|---|---|---|
| **Human-authored decisions** (Geraldo Lima) | The problem framing. The architecture decisions taken at planning time:<br>- root repo + 3 submodules<br>- HTTP + long-poll transport<br>- server-side network portal for offline simulation<br>- a "sources only" regeneration boundary<br>- MVVM with light Clean layering on Android<br>- local-only repos<br>- reuse of the installed platform skills<br><br>Approval of the plan, and review of everything below. | Decided by the human in a planning session. The agent proposed options; the human chose. |
| **Human-created starting points** | `client/` Android Studio "Empty Activity" template (first commit of `client/`). The empty `server/` and `webclient/` folders. | Created by the human with Android Studio before the agent session. |
| **Scaffold templates** (`harness/scaffolds/{android,web}/`) | The toolchain scaffold of each client, extracted from the human-created starting points above plus the agent-assisted scaffold commits. The harness applies it verbatim (no LLM) to bootstrap a client from an empty folder. | Human-owned source of truth, kept in sync with each project by the drift check. |
| **Third-party generated templates** | `webclient/` Vite `react-ts` template (first content commit of `webclient/`) | `npm create vite@9.2.1`, unmodified in that commit. |
| **Vendored third-party skills** | `.claude/skills/{vite, nodejs-express-server, android-native-dev, staff-android-engineer}` | Copied verbatim from the operator's skill folders. Sources are listed in `.claude/skills/VENDORED.md`. |
| **Agent-authored, interactive, human-directed** (Claude Code, Opus 5.5) | `spec/`, `harness/`, `.claude/` (own skills, agent, hook, settings), `conformance/`, `e2e/` (including the reference client), `tools/`, `server/`, the scaffold commits in `webclient/` and `client/`, `CLAUDE.md`/`AGENTS.md` files, and the docs (`README`, `DESIGN`, `FUTURE`, this file) | Written in a Claude Code session, step by step, under the human's direction and the approved plan. Every commit carries `Co-Authored-By: Claude Opus 5.5`. |
| **Harness-generated** (regenerable) | `webclient/src/**`; `client/app/src/main/java/com/example/chatclient/**` (except `ui/theme/`), `client/app/src/test/**`, `client/app/src/androidTest/**`; and the reports `GENERATED.md`, `TRACEABILITY.md`, `CONFORMANCE.md` in each client repo | Produced unattended by `node harness/regen.mjs <target>` (headless Claude Code following `.claude/skills/generate-client`). No hand edits. Changes go through the spec. Commits carry `Generated-by: chatgen-harness …`. |

## Notes on honesty of the boundary

- The **server** and the **reference client** (`e2e/reference/`) are agent-written but *not* regenerated. They are
  hand-directed artifacts held to the spec by the conformance suite and the scenarios.
- Spec fixes found while running the reference E2E suite were made interactively and are visible as `spec:` commits.
  They were not made by editing generated code.
- If the human edits any agent-authored artifact (e.g. tightening DESIGN.md or the spec), that commit should *not*
  carry the `Co-Authored-By` trailer. Then the history shows the human's own contributions.
