# Platform profile: android

This profile defines only **how** the Android client realizes `core/`. It adds
no behavior. When in doubt, `core/` wins. Vendored skills
(`android-native-dev`, `staff-android-engineer`) are advisory. Where they
suggest more machinery than is listed here (Hilt, multi-module, Room, use case
per call), this profile wins.

## Stack (fixed by the human-owned scaffold)

- Kotlin (AGP 9 built-in Kotlin), Jetpack Compose + Material 3, single module `:app`, package `com.example.chatclient`, minSdk 28.
- Allowed libraries, all present in `gradle/libs.versions.toml` and `app/build.gradle.kts`:

| Purpose | Library |
|---|---|
| HTTP | OkHttp |
| JSON | kotlinx-serialization-json (plugin applied) |
| Concurrency | kotlinx-coroutines-android |
| ViewModel / lifecycle | androidx lifecycle-viewmodel-compose, lifecycle-runtime-compose |
| Tests | JUnit 4, kotlinx-coroutines-test, OkHttp MockWebServer |

- **Forbidden:** messaging/chat SDKs, Retrofit, Hilt/Dagger/Koin, Room, DataStore, WorkManager, Navigation libraries.
- The generator MUST NOT edit anything under `gradle/`, any `*.gradle.kts`, `AndroidManifest.xml`, `res/`, or `ui/theme/`. If it needs something they don't provide, it stops and reports.

## Scaffold contract

| Provided by the scaffold | Required from the generator |
|---|---|
| Manifest declares `android:name=".ChatApplication"`, launcher activity `.MainActivity`, `INTERNET` + `ACCESS_NETWORK_STATE` permissions, cleartext allowed for `10.0.2.2` and `localhost` | `ChatApplication : Application` (creates the `AppContainer`) and `MainActivity : ComponentActivity` |
| `BuildConfig.CHATGEN_SERVER_URL` (default `http://10.0.2.2:8080`, override with `-Pchatgen.serverUrl=…`) | Read the base URL only from there |
| `ui/theme/` with `ChatClientTheme` | Wrap all UI in `ChatClientTheme` |

## Architecture: MVVM with light Clean layering

One module, four packages. Dependencies point inward: `ui → domain ← data`, and `di` wires them.

| Package | Contents | Rules |
|---|---|---|
| `domain/model` | `Message`, `MessageStatus`, `ConnectionState`, and value rules (`NameRule`, `BodyRule`) | Pure Kotlin, **no Android imports** |
| `domain/repository` | Interfaces: `IdentityRepository`, `MessageRepository` (store + outbox + cursor, exposed as `Flow`/`StateFlow`), `SyncController` (`start/stop/wake`, `connectionState`) | Interfaces only |
| `domain/usecase` | `LoginUseCase`, `LogoutUseCase`, `SendMessageUseCase` (validate + persist + wake), `ObserveConversationsUseCase` / `ObserveThreadUseCase` (apply `REQ-ORDER-*`) | Only where a rule lives. No pass-through use cases. |
| `data/remote` | `ChatApi` (OkHttp + kotlinx-serialization DTOs, `X-Chat-User` header) | Maps HTTP outcomes into a small sealed result: `Ok`, `Rejected(code)`, `NetworkFailure` |
| `data/local` | File-backed stores in `filesDir/chatgen/` (JSON via kotlinx-serialization). Writes go to a temp file, then `Files.move(…, ATOMIC_MOVE)`. A `Mutex` serializes writes, and in-memory `StateFlow` caches are the read path. | Behind an interface so JVM tests can use in-memory fakes |
| `data/sync` | `SyncEngine`: the `40-connectivity` cycle, one coroutine in an application-scoped `CoroutineScope(SupervisorJob() + Dispatchers.IO)`. Wake is a `Channel(CONFLATED)`. Backoff waits are `withTimeoutOrNull(d) { wake.receive() }`. The long-poll races against wake, and the loser is cancelled (cancel the OkHttp `Call`). | Takes `ChatApi`, stores, a clock and a dispatcher via the constructor |
| `data/repository` | Implementations of the domain interfaces | |
| `di/AppContainer` | Manual constructor injection. Built once in `ChatApplication`. | No DI framework |
| `ui/login`, `ui/conversations`, `ui/thread` | One `ViewModel` per screen exposing `StateFlow<…UiState>` (immutable data class) and intent functions (`onNameChange`, `onSubmit`, …). Stateless screen composables take `(state, callbacks)`. Collect state with `collectAsStateWithLifecycle()`. ViewModels are created via `viewModelFactory { initializer { … } }` using the container. | No business rules in composables |
| `ui/ChatApp.kt` | Top-level routing: a small `AppViewModel` exposes `Screen` (sealed: `Login`, `Conversations`, `Thread(peer)`) derived from identity plus navigation events. `BackHandler` maps platform back from Thread to Conversations. | No navigation library |

## Mechanisms (core concept → Android realization)

| Core concept | Android realization |
|---|---|
| Element ID (`50-ui.md`) | `Modifier.testTag("<id>")` on the element. The root composable sets `Modifier.semantics { testTagsAsResourceId = true }` so UI Automator sees tags as `resource-id`. Rows (`message-row`, `conversation-row`) MUST NOT use `mergeDescendants` (a clickable `conversation-row` must keep its children's tags visible, so use `Modifier.clickable` on the row and leave the children with their own tags). Text elements are `Text` composables whose text is exactly the specified content. |
| Inputs | `OutlinedTextField`/`TextField` with `testTag` on the field and `placeholder` text as specified. `login-name` uses `ImeAction.Done`, which triggers submit. |
| UUID | `java.util.UUID.randomUUID().toString()` |
| Timestamp | `Instant.now().truncatedTo(ChronoUnit.MILLIS)` formatted with `DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)` |
| Code-point length | `s.codePointCount(0, s.length)` |
| White_Space trim / blank test | `s.trim()` / `s.isBlank()` |
| Network error | Any `IOException` from OkHttp (connect failure, reset, `SocketTimeoutException`, unexpected end of stream) |
| Timeouts (REQ-CONN-006) | Connect 10 s. Per call: POST `callTimeout(10 s)`, GET `callTimeout(wait + 10 s)` with a matching `readTimeout` (use `client.newBuilder()` per call or per wait value). |
| Wake: network available | `ConnectivityManager.registerDefaultNetworkCallback`, `onAvailable` → `wake()` |
| Wake: foreground | `MainActivity.onStart` → `wake()` |
| Engine lifetime (REQ-CONN-007) | Owned by `AppContainer`; started and stopped by identity changes (observe the identity flow in the application scope). Not tied to Activity lifecycle. |
| Time display `HH:mm` | `DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())` |
| Insets | `enableEdgeToEdge()` + `Scaffold` padding + `imePadding()` on the thread so the composer stays above the keyboard |

## Quality bar

- Every `[client]` requirement ID has at least one JVM unit test (`app/src/test/…`) whose method name or KDoc/comment contains the ID. Use backtick names, e.g. `` fun `REQ-OUTBOX-001 sends strictly FIFO one at a time`() ``.
- Domain rules get plain JUnit tests. `SyncEngine` is tested with a fake `ChatApi`, using `runTest` and virtual time for backoff, wake-abort and flush-before-sync ordering. `ChatApi` is tested against `MockWebServer` (headers, body, status mapping). ViewModels are tested with fake repositories.
- `./gradlew assembleDebug testDebugUnitTest` MUST pass. No `@Ignore`d tests.

## Commands (run in `client/`)

On Windows, use `gradlew.bat`, and set `TEMP`/`TMP` to a path without 8.3 short names. The harness does this automatically.

| Purpose | Command |
|---|---|
| Build | `./gradlew assembleDebug` |
| Unit tests | `./gradlew testDebugUnitTest` |
| Install on the running emulator | `./gradlew installDebug` |
| Launch | `adb shell am start -n com.example.chatclient/.MainActivity` |
| Clear state | `adb shell pm clear com.example.chatclient` |
