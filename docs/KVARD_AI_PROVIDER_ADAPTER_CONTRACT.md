# КВАРД — стандарт совместимости AI-провайдеров

Статус: целевой технический контракт. Перед объявлением любого провайдера совместимым он должен пройти conformance tests и реальный sandbox smoke test. Наличие похожего HTTP API само по себе не означает полной совместимости.

## 1. Основной принцип

Продуктовые модули КВАРД (чат, агенты, Builder, Runtime, Workforce, тарифы и биллинг) не должны обращаться к API конкретного AI-провайдера напрямую и не должны знать его формат сообщений.

Все запросы проходят через внутренний контракт КВАРД:

`Product module → AI Gateway → Provider Adapter → Provider API`

Ответ идёт обратно тем же путём. Для подключения нового провайдера создаётся/настраивается адаптер. Продуктовые модули не переписываются.

## 2. Канонический запрос КВАРД

Внутренний запрос должен поддерживать:
- messages с ролями system/developer/user/assistant/tool;
- текст и мультимодальные content parts (image; в будущем audio/video);
- выбранные provider/model и policy hints;
- max output tokens, temperature/top_p, stop sequences;
- tool definitions и tool choice;
- JSON/structured output schema;
- streaming flag и AbortSignal;
- metadata: request ID, organization ID, user ID, subscription/plan ID, idempotency key;
- лимиты времени, максимальный размер контекста и выходного ответа.

Поля, которые конкретный провайдер не поддерживает, нельзя молча игнорировать. Адаптер возвращает нормализованную ошибку `unsupported_capability` либо явно объявляет безопасный downgrade, разрешённый policy запроса.

## 3. Канонический ответ

Единый ответ содержит:
- content blocks, а не только одну строку;
- tool calls с нормализованными именами и JSON arguments;
- provider ID и фактически использованную model ID;
- provider request ID;
- finish reason;
- usage: input, output, total, cached, reasoning и другие token classes, если доступны;
- usage source: provider_reported / estimated / unavailable;
- latency и retry/fallback metadata.

Нельзя записывать нулевой расход, если провайдер usage не вернул. В таком случае usage помечается unavailable/estimated и финансовая политика использует консервативную оценку или запрещает платный вызов для тарифа, требующего точный учёт.

## 4. Обязательный интерфейс адаптера

Каждый adapter должен реализовать единый набор операций:
- `id`, display name, protocol/adapter version;
- `listModels()` или статический версионируемый каталог с указанием источника;
- `getModelCapabilities(model)` для конкретной модели;
- `validateCredentials()` без раскрытия секрета;
- `generateRequest(canonicalRequest)`;
- `stream(canonicalRequest)`, только если streaming capability заявлена;
- нормализацию usage, finish reason, tool calls и ошибок;
- таймауты, отмену запроса, ограниченные retries и safe error mapping.

Текущий `AIProvider.generate(message: string): Promise<string>` сохранён как legacy compatibility path. Для нативной реализации добавлен optional `AIProvider.generateRequest(request: AIRequest): Promise<AIResponse>`; новые интеграции должны реализовывать его.

## 5. Модельный каталог и capabilities

Capabilities определяются на уровне конкретной модели, а не только провайдера:
- text, code, vision, audio, video;
- tool calling;
- streaming;
- structured output / JSON schema;
- reasoning;
- context window и max output;
- доступность региона/аккаунта;
- цена input/output/cache/reasoning и валюта;
- дата обновления и источник данных.

Источники каталога:
1. официальный Models API провайдера;
2. официальный pricing/capabilities feed или вручную проверенная версия каталога;
3. локальная конфигурация только как fallback с явным флагом stale/manual.

Отсутствующее свойство считается unknown, а не false или true. Нельзя показывать пользователю функцию модели, пока она не подтверждена. Динамические имена моделей и алиасы нормализуются с сохранением исходного ID поставщика.

## 6. Протоколы и совместимость

Адаптер должен объявлять протокол: native provider API, OpenAI-compatible Chat Completions, OpenAI-compatible Responses, Anthropic Messages, Ollama API или другой подтверждённый протокол. Совместимость с OpenAI-форматом не гарантирует поддержку Responses API, tools, images, streaming или usage одинаковым образом.

Нельзя насильно использовать один формат для всех поставщиков. Для native APIs используются native adapters; общий интерфейс — внутренний контракт КВАРД, а не требование, чтобы все внешние API были одинаковыми.

## 7. Ошибки, retries и fallback

Ошибки нормализуются в категории:
- authentication / invalid_credentials;
- permission / model_not_available;
- rate_limited;
- quota_exceeded / provider_billing_exhausted;
- invalid_request / unsupported_capability;
- timeout / cancelled;
- provider_unavailable;
- unknown_provider_error.

Повтор разрешён только для временных ошибок, с ограничением попыток и jitter. Ошибки аутентификации, невалидного запроса, отсутствующей модели и исчерпанной квоты не повторяются бесконечно.

Fallback:
- включается только policy тарифа/запроса;
- только на разрешённую пользователю модель;
- не может незаметно повысить стоимость;
- фиксирует исходного и фактического провайдера/модель;
- не создаёт двойное списание;
- при неясном результате предыдущего вызова не повторяет платный запрос автоматически без idempotency safety.

## 8. Биллинг и точность usage

Адаптер сообщает сырые usage поля и нормализованный usage. Gateway сохраняет provider/model, точный внешний model ID, pricing version, request ID и источник usage.

Фактическая цена рассчитывается в billing service КВАРД по версионируемому каталогу цен и фактическому usage. Если provider сообщает стоимость напрямую, сохраняются обе величины: provider-reported cost и calculated cost; расхождения мониторятся. Нельзя полагаться на цену, рассчитанную клиентом или на изменяемый каталог без версии.

## 9. Обязательные conformance tests для каждого адаптера

1. Корректная сериализация canonical messages и generation options.
2. Правильный provider/model ID в ответе.
3. Нормализация usage, включая missing/partial usage.
4. Нормализация tool calls и JSON arguments, если поддерживается.
5. Нормализация finish reasons.
6. Корректная обработка 401/403/404/429/5xx и provider quota errors.
7. Timeout, AbortSignal и отсутствие зависающих запросов.
8. Retry policy без бесконечных повторов.
9. Streaming chunks/final usage, если поддерживается.
10. Multimodal payload и отказ на неподдерживаемые capabilities.
11. Credential redaction в logs/errors/traces.
12. Idempotency/usage integration, чтобы повторная обработка не списывала расход дважды.
13. Contract test против fake HTTP server без реальных расходов.
14. Sandbox smoke test с настоящим аккаунтом провайдера перед включением в production.

CI должен запускать fake-server conformance suite для всех adapters. Production enablement требует успешного sandbox smoke test и явного включения провайдера администратором.

## 10. Как добавить нового провайдера

1. Проверить официальную документацию и ограничения API.
2. Создать adapter под канонический контракт КВАРД.
3. Добавить модели и проверенные capabilities/pricing metadata.
4. Пройти conformance tests и проверить ошибки/лимиты.
5. Пройти sandbox smoke test с временным тестовым ключом.
6. Включить в реестр в состоянии disabled/staged.
7. Проверить routing, usage ledger и тарификацию.
8. Только после этого разрешить модели в тарифах и включить production routing.

## 11. Текущие ограничения проекта

На момент подготовки документа текущий `AIProvider` поддерживает упрощённый текстовый вызов `generate(message)`, а `AIResponse` уже описывает часть расширенных полей, но не используется всеми adapters. Текущие provider capabilities в нескольких adapters жёстко заданы как false для vision/tools/streaming/structured output/reasoning. Поэтому нельзя считать эти возможности реализованными только на основании существования полей типов или названия модели.

Переход к каноническому контракту должен быть поэтапным, с legacy bridge и тестами, чтобы не сломать существующие чаты и агентские сценарии.


## 12. Реализованная основа в КВАРД (2026-11-26)

### Уже в коде

- Canonical request v1: роли system/developer/user/assistant/tool, text/image content parts (URL и base64), model ID, generation options, tool definitions/tool choice, response format, timeout, AbortSignal и request metadata.
- Assistant tool-call history: canonical message может содержать toolCalls; tool-only assistant message с пустым текстом допускается и требует capability toolCalling.
- Canonical response: content blocks, provider/model, tool calls, request ID, finish reason, usage categories, latency и usageSource.
- Runtime validation: версия контракта, размеры и типы полей, HTTP(S)-only image URL, MIME/base64 validation, message/tool limits.
- Model-level capabilities имеют приоритет над provider-level capabilities.
- AIGateway.generateRequest() маршрутизирует в native generateRequest() или strict legacy bridge.
- Legacy bridge сохраняет порядок и роли system/user/assistant; явно отклоняет images, developer/tool roles, assistant tool-call history, tools, streaming, JSON/structured output и неподдерживаемые generation options до вызова поставщика.
- Отсутствующий usage отмечается unavailable; частичный usage сохраняется частичным, без подстановки нулей.
- Gateway нормализует provider identity, сохраняет фактически возвращённую model ID и редактирует bearer/API-key-похожие credentials из provider error details.
- Существующие string-based generate()/generateWithMetadata() и их fallback semantics сохранены.
- Добавлен отдельный GitHub Actions workflow `.github/workflows/ai-provider-contract.yml`: API typecheck + полный API test suite без ожидания тяжёлого browser E2E.

### Что пока НЕ реализовано

- Существующие OpenAI, Anthropic, OpenRouter, OrcaRouter, AnyModel и Ollama adapters пока остаются legacy adapters. Новый native contract framework готов, но провайдер-специфичная сериализация и usage parsing для каждой интеграции ещё впереди.
- Наличие image/tool/streaming/structured-output полей в canonical contract не означает, что все реальные модели поддерживают эти функции.
- Не реализованы native audio/video, полноценный streaming protocol, structured JSON schema и tool execution mapping для каждого поставщика.
- Product modules (chat, Builder, agent loops, Runtime, Workforce) ещё не мигрированы на canonical request API; текущие string calls работают через старый фасад.
- Usage ledger, reservations/settlement, pricing versioning, plan entitlements и payment lifecycle остаются отдельными этапами.
- Sandbox smoke tests с реальными provider accounts не выполнялись; реальные API keys, production secrets, billing и deployment не затрагивались.

### Текущая матрица

| Слой | Статус |
|---|---|
| Canonical types + runtime validation | Implemented |
| Native adapter extension point | Implemented |
| Strict text-only legacy bridge | Implemented |
| Gateway routing + model capabilities | Implemented |
| Usage source normalization | Implemented |
| Provider error credential redaction | Implemented + covered by tests |
| Reusable conformance fixture tests | Implemented |
| Native adapters for actual providers | Pending |
| Vision/tools/streaming/structured output per provider | Pending, capability-gated |
| Audio/video | Future |
| Product module migration | Pending |
| Usage ledger + budget reservation | Pending |
| Real provider sandbox checks | Pending before production enablement |

CI evidence: dedicated provider-contract workflow `45705059762` passed (API typecheck and full API test suite) on commit `9f4e9992c017a94409834c8f238926cbe09fceab`. This verifies the contract foundation at that commit, not all future native provider features.


### Additional hardening after first verification

- Canonical assistant messages can contain tool-call history, including tool-call-only messages with no text content. This requires `toolCalling` capability; legacy providers reject it before invocation.
- Token counts must be non-negative integers. Missing, malformed, or contradictory usage metadata is normalized to `unavailable`; no zero values are invented. Explicit estimated usage remains `estimated`.
- Credential redaction applies to both technical details and user-safe messages from already-classified `NexumError` instances, not only raw provider exceptions.
- Latest dedicated workflow `45705690934` passed on commit `53e0be5392fce43a3b623623ab63aa32022d9891`: API typecheck passed and 241/241 API tests passed.


### Unknown capabilities — fail-closed semantics

- `AIModelCapabilities` теперь допускает явное значение `"unknown"` для каждой capability.
- Неизвестная capability не трактуется ни как поддерживаемая, ни как отрицательно подтверждённая. При запросе функции Gateway требует строго `true`; `false` и `unknown` оба блокируют вызов.
- `AIModelRequirement` в каталоге остаётся boolean-only, чтобы нельзя было выбирать модель по требованию "unknown".
- Dedicated workflow `45706535742` passed on commit `d9d2c03b5de7a7800df5972e96d91ea185d5b4d3`: API typecheck passed; 242/242 API tests passed.


### Native-only adapter support

- `AIProvider.generate()` is now optional. A provider may implement only `generateRequest(canonicalRequest)`; Gateway validates that each registered provider implements at least one generation interface.
- The legacy string facade (`generate()` / `generateWithMetadata()`) now converts old string calls into canonical requests when a native adapter exists. This allows Chat/Builder/Agent callers to keep working while provider adapters migrate one by one.
- When both methods exist, the Gateway prefers `generateRequest()`. Existing legacy-only providers continue through the strict bridge.
- Configured transient fallback also supports a native-only fallback provider. The original provider/model selection and fallback metadata remain intact.
- Latest dedicated workflow `45707392285` passed on commit `4d947cc4096519c7e1fdf7fc6732e5a1067c3ad7`: API typecheck passed; 246/246 API tests passed.


### Streaming is explicitly gated

- `AIGateway.generateRequest()` returns one completed `AIResponse`; it is not a streaming API.
- Even if a provider advertises `streaming: true`, `generateRequest({ stream: true })` is rejected before the adapter is invoked. This prevents a provider from claiming streaming while returning a buffered response.
- A separate canonical stream event contract and `AIGateway.streamRequest()` must be implemented and conformance-tested before any real adapter can enable streaming.
- Dedicated workflow `45708228452` passed on commit `83ae24ea58875a3868279bb80820348d6943e900`: API typecheck passed; 247/247 API tests passed.
