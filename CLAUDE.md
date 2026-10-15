# chat-client (Android): agent guide

This repo is a submodule of the Chat Generator root repo. Its Kotlin application code is **generated**.

| Path | Owner | Rule |
|---|---|---|
| `app/src/main/java/com/example/chatclient/**` (except `ui/theme/`) | **generated** by chatgen-harness | Never hand-edit. Change `../spec/` and run `node harness/regen.mjs android` from the root. |
| `app/src/test/**`, `app/src/androidTest/**` | **generated** | Same |
| `GENERATED.md`, `TRACEABILITY.md`, `CONFORMANCE.md` | harness reports | Rewritten on every run |
| `app/src/main/java/com/example/chatclient/ui/theme/**`, `res/`, `AndroidManifest.xml`, `*.gradle.kts`, `gradle/` | human-owned scaffold | Change deliberately in a `scaffold:` commit, never during generation. `gradle/libs.versions.toml` is the dependency allowlist. |

Behavior is defined by `../spec/core/*` (platform-neutral) and `../spec/platforms/android.md`
(Android mechanisms, MVVM + light Clean architecture). Answer behavior questions from the spec, not from the code.

Commands (Windows: `gradlew.bat`, with `TEMP`/`TMP` set to a path without `~`):
`./gradlew assembleDebug` · `./gradlew testDebugUnitTest` · `./gradlew installDebug`.
The app talks to `BuildConfig.CHATGEN_SERVER_URL` (default `http://10.0.2.2:8080`, the host as seen from the emulator).
