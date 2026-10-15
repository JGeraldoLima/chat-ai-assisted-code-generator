# Scaffold templates

Human-owned, versioned toolchain scaffolds, one per target. They're the **single source of truth**
for everything in a client project that isn't generated: build files, dependency catalog (= the
dependency allowlist), manifest, resources, theme, configs, lockfile, agent guide.

| Template | Applied to | Origin |
|---|---|---|
| `android/` | `client/` | Android Studio "Empty Activity" template (AGP 9.4.1, Kotlin 2.2.10), plus the Chat Generator scaffold changes: dependency allowlist, `BuildConfig.CHATGEN_SERVER_URL`, permissions, cleartext config, `.ChatApplication` |
| `web/` | `webclient/` | `npm create vite@9.2.1 -- --template react-ts`, plus test tooling (Vitest + jsdom + Testing Library), fixed ports, `oxlint --deny-warnings` |

## How the harness uses them

- **Bootstrap (from scratch).** If a target's project directory is missing or has no scaffold yet, `harness/regen.mjs` copies the template in and makes it a git repo if needed, with a `scaffold:` commit. The agent then generates only the app code. No LLM touches the toolchain. On machines without `ANDROID_HOME`, the Android bootstrap also writes `local.properties` pointing at the default SDK location.
- **Drift check.** The boundary gate fails if any template file differs from the project's copy (line endings normalized). Changing the scaffold means editing the template here, then re-applying it to the project (`node harness/regen.mjs <target> --sync-scaffold`) in the same change.

Binary files (`gradle-wrapper.jar`, launcher `.webp`s) are committed as-is. They're standard upstream artifacts.
