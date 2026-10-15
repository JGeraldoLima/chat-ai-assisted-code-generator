# Architecture Reference

Detailed patterns and templates for the Staff Android Engineer skill.

---

## Clean Architecture Module Structure

```
app/
├── di/                          # Hilt modules for the app-level graph
├── navigation/                  # NavHost, routes, NavGraph definitions
├── ui/theme/                    # MaterialTheme, Color, Typography, Shape
└── MyApplication.kt

feature-foo/
├── data/
│   ├── remote/
│   │   ├── FooApi.kt            # Retrofit/Ktor interface
│   │   └── FooDto.kt            # Network response model
│   ├── local/
│   │   ├── FooDao.kt            # Room DAO
│   │   └── FooEntity.kt         # Room entity
│   ├── mapper/
│   │   └── FooMapper.kt         # DTO/Entity ↔ Domain mappers
│   ├── repository/
│   │   └── FooRepositoryImpl.kt # Implements domain interface
│   └── di/
│       └── FooDataModule.kt     # @Binds repository, @Provides api/dao
├── domain/
│   ├── model/
│   │   └── Foo.kt               # Domain entity (plain Kotlin)
│   ├── repository/
│   │   └── FooRepository.kt     # Interface (contract)
│   └── usecase/
│       └── GetFooUseCase.kt     # Single-responsibility use case
└── presentation/
    ├── FooViewModel.kt
    ├── FooUiState.kt            # Sealed interface
    ├── FooAction.kt             # Sealed interface for user intents
    └── FooScreen.kt             # Composable
```

---

## Use Case Pattern

```kotlin
class GetFooUseCase @Inject constructor(
    private val repository: FooRepository
) {
    suspend operator fun invoke(id: String): Result<Foo> {
        return runCatching { repository.getFoo(id) }
    }
}
```

Rules:
- One public function (`invoke` via `operator`)
- Returns `Result<T>`, `Flow<T>`, or domain-specific sealed result
- No Android framework dependencies
- Inject repository interfaces, never implementations

---

## Repository Pattern

```kotlin
// Domain layer — interface only
interface FooRepository {
    suspend fun getFoo(id: String): Foo
    fun observeFoos(): Flow<List<Foo>>
}

// Data layer — implementation
class FooRepositoryImpl @Inject constructor(
    private val api: FooApi,
    private val dao: FooDao,
    private val mapper: FooMapper,
    @IoDispatcher private val ioDispatcher: CoroutineDispatcher
) : FooRepository {

    override suspend fun getFoo(id: String): Foo = withContext(ioDispatcher) {
        val cached = dao.getById(id)
        if (cached != null) return@withContext mapper.entityToDomain(cached)

        val remote = api.fetchFoo(id)
        dao.insert(mapper.dtoToEntity(remote))
        mapper.dtoToDomain(remote)
    }

    override fun observeFoos(): Flow<List<Foo>> {
        return dao.observeAll().map { entities ->
            entities.map(mapper::entityToDomain)
        }.flowOn(ioDispatcher)
    }
}
```

---

## Mapper Pattern

```kotlin
class FooMapper @Inject constructor() {

    fun dtoToDomain(dto: FooDto): Foo = Foo(
        id = dto.id,
        name = dto.name,
        createdAt = Instant.parse(dto.createdAt)
    )

    fun entityToDomain(entity: FooEntity): Foo = Foo(
        id = entity.id,
        name = entity.name,
        createdAt = entity.createdAt
    )

    fun dtoToEntity(dto: FooDto): FooEntity = FooEntity(
        id = dto.id,
        name = dto.name,
        createdAt = Instant.parse(dto.createdAt)
    )
}
```

---

## Hilt DI Module Pattern

```kotlin
@Module
@InstallIn(ViewModelComponent::class)
abstract class FooDomainModule {

    @Binds
    abstract fun bindRepository(impl: FooRepositoryImpl): FooRepository
}

@Module
@InstallIn(SingletonComponent::class)
object FooDataModule {

    @Provides
    fun provideApi(retrofit: Retrofit): FooApi =
        retrofit.create(FooApi::class.java)

    @Provides
    fun provideDao(db: AppDatabase): FooDao = db.fooDao()
}
```

---

## Navigation Pattern (Compose)

```kotlin
// Type-safe routes with kotlinx.serialization
@Serializable
data class FooRoute(val id: String)

// In NavHost
composable<FooRoute> { backStackEntry ->
    val route = backStackEntry.toRoute<FooRoute>()
    FooScreen(fooId = route.id)
}
```

---

## Error Handling Strategy

### Domain-Level Result

```kotlin
sealed interface DomainResult<out T> {
    data class Success<T>(val data: T) : DomainResult<T>
    data class Error(val failure: Failure) : DomainResult<Nothing>
}

sealed interface Failure {
    data class Network(val code: Int, val message: String) : Failure
    data class NotFound(val id: String) : Failure
    data object Unauthorized : Failure
    data class Unknown(val throwable: Throwable) : Failure
}
```

### ViewModel Error Mapping

```kotlin
private fun Failure.toUserMessage(): String = when (this) {
    is Failure.Network -> "Connection error. Check your internet."
    is Failure.NotFound -> "Item not found."
    is Failure.Unauthorized -> "Session expired. Please log in."
    is Failure.Unknown -> "Something went wrong. Try again."
}
```

---

## Coroutine Dispatcher Qualification

```kotlin
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class IoDispatcher

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class DefaultDispatcher

@Module
@InstallIn(SingletonComponent::class)
object DispatcherModule {

    @IoDispatcher
    @Provides
    fun provideIoDispatcher(): CoroutineDispatcher = Dispatchers.IO

    @DefaultDispatcher
    @Provides
    fun provideDefaultDispatcher(): CoroutineDispatcher = Dispatchers.Default
}
```

---

## Testing Templates

### ViewModel Test

```kotlin
@OptIn(ExperimentalCoroutinesApi::class)
class FooViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val fakeRepository = FakeFooRepository()
    private val useCase = GetFooUseCase(fakeRepository)
    private lateinit var viewModel: FooViewModel

    @Before
    fun setup() {
        viewModel = FooViewModel(useCase)
    }

    @Test
    fun `initial state is Loading`() = runTest {
        viewModel.uiState.test {
            assertThat(awaitItem()).isEqualTo(FooUiState.Loading)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `load success emits Content`() = runTest {
        fakeRepository.setResult(Result.success(fakeFoo))

        viewModel.onAction(FooAction.Load)

        viewModel.uiState.test {
            skipItems(1) // Loading
            assertThat(awaitItem()).isEqualTo(FooUiState.Content(fakeFoo))
            cancelAndIgnoreRemainingEvents()
        }
    }
}
```

### MainDispatcherRule

```kotlin
@OptIn(ExperimentalCoroutinesApi::class)
class MainDispatcherRule(
    private val dispatcher: TestDispatcher = UnconfinedTestDispatcher()
) : TestWatcher() {

    override fun starting(description: Description) {
        Dispatchers.setMain(dispatcher)
    }

    override fun finished(description: Description) {
        Dispatchers.resetMain()
    }
}
```

### Compose UI Test

```kotlin
class FooScreenTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun `shows loading indicator when state is Loading`() {
        composeTestRule.setContent {
            FooContent(
                uiState = FooUiState.Loading,
                onAction = {}
            )
        }

        composeTestRule
            .onNodeWithTag("loading_indicator")
            .assertIsDisplayed()
    }
}
```
