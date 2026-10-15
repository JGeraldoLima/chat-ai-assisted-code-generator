# chat-client (Android)

The Chat Generator Android client: Kotlin, Jetpack Compose, Material 3, MVVM with light Clean layering.

**Regeneration boundary:** the Kotlin sources under `app/src/main/java/com/example/chatclient/`
(except `ui/theme/`), plus `app/src/test/` and `app/src/androidTest/`, are produced by the chatgen
harness from the root repo's `spec/`. Everything else (Gradle files, version catalog, manifest,
resources, theme) is the human-owned scaffold. It's applied from the root repo's `harness/scaffolds/android/` template, which the harness also uses to bootstrap this project from an empty folder.

```bash
./gradlew assembleDebug        # build
./gradlew testDebugUnitTest    # JVM unit tests
./gradlew installDebug         # install on the running emulator (e.g. Pixel_8, API 36)
```

The server must be running on the host at port 8080 (`npm run server` in the root repo). The app reaches
it as `http://10.0.2.2:8080`. Override with `-Pchatgen.serverUrl=...`.

Provenance of the generated code is in `GENERATED.md`, the requirement → test mapping in
`TRACEABILITY.md`, and the independent spec review in `CONFORMANCE.md`.
