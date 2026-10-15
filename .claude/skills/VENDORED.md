# Vendored skills

These skills are copied verbatim into the repo so the harness works on a
clean machine or in a sandbox. Nothing in the generator depends on the
operator's global `~/.claude/skills`.

| Skill | Upstream source | Used by |
|---|---|---|
| `vite/` | `~/.agents/skills/vite` (antfu/skills, generated from vitejs/vite) | web target (`spec/platforms/web.md`) |
| `nodejs-express-server/` | `~/.agents/skills/nodejs-express-server` (community) | server (not under generator discipline) |
| `android-native-dev/` | `~/.claude/skills/android-native-dev` | android target (`spec/platforms/android.md`) |
| `staff-android-engineer/` | `~/.claude/skills/staff-android-engineer` | android target: MVVM/Clean guidance |

**Precedence:** `spec/` always wins over a vendored skill. The platform
profiles say explicitly which skill advice applies and which is overridden.
For example, the android profile asks for light Clean layering and forbids
Hilt and multi-module setups, even though `staff-android-engineer` suggests
them for larger apps.

Harness-owned skills (`generate-client/`, `verify-client/`) are authored in
this repo, not vendored.
