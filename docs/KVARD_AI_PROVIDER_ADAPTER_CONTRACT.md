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


## 13. Реестр существующих интеграций и фактический уровень совместимости

Эта таблица описывает именно текущую реализацию КВАРД в репозитории, а не гарантии или сертификацию со стороны поставщиков.

| Provider ID | Текущий HTTP-протокол в адаптере | Текущий путь генерации | Модели | Ограничения текущего адаптера |
|---|---|---|---|---|
| `openai` | OpenAI Responses API (native); Chat Completions (legacy facade) | `/responses`; legacy `/chat/completions` | `/models` | Native canonical adapter v2; model-level advanced capabilities remain unknown until verified |
| `anthropic` | Anthropic Messages API | `/messages` | `/models?lifecycle=active` | Native canonical adapter v2; model capabilities read from provider model metadata |
| `openrouter` | OpenAI-compatible Chat Completions | `/chat/completions` | `/models` | Legacy text bridge; нет canonical native adapter |
| `orcarouter` | OpenAI-compatible Chat Completions (как реализовано в текущем клиенте) | `/chat/completions` | `/models` | Legacy text bridge; совместимость ограничена фактически проверенными полями |
| `anymodel` | OpenAI-compatible Chat Completions (как реализовано в текущем клиенте) | `/chat/completions` | `/models` | Legacy text bridge; совместимость ограничена фактически проверенными полями |
| `ollama` | Ollama Chat API | `/api/chat` | `/api/tags` | Legacy text bridge; нет canonical native adapter |

### Правило добавления нового провайдера

Нельзя подключать новый endpoint только потому, что он похож на OpenAI API. Перед включением нужно зафиксировать:
1. точный API protocol и endpoint family (Chat Completions, Responses, Anthropic Messages, Ollama Chat или собственный);
2. способ авторизации и проверку credentials;
3. формат сообщений, ролей, content parts, tools и structured output;
4. фактический формат ответа, finish reason и provider request ID;
5. usage-поля и правила расчёта стоимости;
6. модельный каталог, стабильные model IDs и capabilities по каждой модели;
7. поведение 401/403/404/429/5xx, quota exhausted, timeout и cancellation;
8. поддерживаемые регионы, ограничения аккаунта и version/deprecation policy.

Если новый поставщик реализует только OpenAI-compatible endpoint, он всё равно получает отдельный adapter/configuration и собственный conformance suite. Нельзя считать его совместимым со всеми возможностями OpenAI автоматически.

**Текущий статус:** внутренний canonical contract, validation, strict legacy bridge, provider conformance tests и CI gate реализованы. OpenAI подключён через native Responses adapter; его старый string facade сохраняет Chat Completions. Anthropic подключён через native Messages adapter. Остальные четыре перечисленных поставщика пока используют legacy text bridge. Реальные sandbox проверки с аккаунтами провайдеров не выполнялись; streaming и неподтверждённые capabilities остаются закрыты.


## 14. Проверяемость каталога моделей

`GET /api/ai/models` сохраняет старое поле `models` для обратной совместимости и дополнительно возвращает `catalog.providers[]`:
- `source=provider_api`, `verified=true`, `status=available` — provider API вернул непустой список model IDs;
- `source=configured_fallback`, `verified=false`, `status=unavailable` — каталог недоступен или provider не реализует discovery;
- `source=configured_fallback`, `verified=false`, `status=empty` — provider API ответил пустым списком.

В fallback сохраняется настроенная модель, чтобы старые экраны не ломались, но клиент теперь может отличить её от подтверждённого каталога. Ошибки discovery не раскрывают provider response, URL, credentials или внутренние детали. Отмена запроса не маскируется как обычный fallback.

Важно: наличие model ID в каталоге не подтверждает доступность модели конкретному аккаунту на платном вызове и не подтверждает все capabilities. Реальный health/credential check и sandbox smoke test остаются отдельными проверками.


## 14. Protocol metadata and verified model discovery

- `AIProviderProtocol` identifies the actual upstream wire protocol (OpenAI Responses, OpenAI Chat Completions, OpenAI-compatible Chat Completions, Anthropic Messages, Ollama Chat, Mock, or a custom protocol). The type remains extensible for future providers.
- Each native adapter must declare both `protocol` and `adapterVersion`; Gateway rejects a native adapter that omits either. Provider IDs must be unique.
- Existing adapters now declare protocol metadata:
  - OpenAI native: `openai-responses`; legacy string facade: `legacyProtocol=openai-chat-completions`
  - Anthropic: `anthropic-messages`
  - OpenRouter / OrcaRouter / AnyModel: `openai-compatible-chat-completions`
  - Ollama: `ollama-chat`
  - Mock: `mock`
- `AIGateway.getModelCatalog()` distinguishes provider-verified model lists from configured fallback model IDs. Empty or failed catalog requests are explicitly unverified and carry an error category.
- `AIModelRegistry.list()` exposes verified state/source/status for display. `AIModelRegistry.select()` only selects a model that the provider API actually listed; configured fallback IDs cannot be silently selected for real inference.
- Dedicated workflow `45709473332` passed on commit `7746b9b8263fed0eef503d1c4fe73e2ffaf70211`: API typecheck passed; 66/66 focused AI provider contract tests passed.


### Model catalog cache and credential invalidation

- `AIGateway.getModelCatalog()` caches the provider catalog for 60 seconds and coalesces concurrent requests into one in-flight refresh.
- Updating/rotating any provider API key invalidates the cache immediately; stale in-flight results cannot overwrite a newer cache revision.
- Legacy `getModels()` reads from the same catalog cache, keeping model discovery consistent across callers.
- Dedicated workflow `45710089229` passed on commit `63115817de617dd4803cf5f100f4a0aa8962fab9`: API typecheck passed; 67/67 focused AI provider contract tests passed.


## 15. Native OpenAI Responses adapter

OpenAI is the first production provider adapter migrated to the canonical contract.

### Protocol selection

- Canonical requests use `POST /responses` and the official Responses API.
- Existing `generate(message)` product callers continue to use `POST /chat/completions` as a compatibility facade; this is explicitly exposed as `legacyProtocol`, not confused with the native protocol.
- The Responses base URL and model discovery can be configured independently with `OPENAI_RESPONSES_BASE_URL`; `OPENAI_BASE_URL` continues to control only the legacy Chat Completions path.
- The official API reference identifies Responses as the endpoint for text/image input, text/JSON output and function tools. The OpenAI migration guide says to use Responses for new integrations; Assistants API sunset is documented for August 26, 2026.
  - https://developers.openai.com/api/reference/resources/responses/methods/create
  - https://platform.openai.com/docs/api-reference/models/list
  - https://platform.openai.com/playground/assistants

### Canonical mapping implemented

- System/developer/user/assistant messages map to Responses input messages while preserving order.
- Image URL and base64 content map to `input_image`; base64 is sent as a data URL.
- Assistant tool-call history maps to `function_call`; tool results map to `function_call_output`.
- Canonical function definitions and tool choice map to Responses function tools.
- JSON and JSON Schema response formats map to `text.format`.
- `maxTokens`, `temperature`, `topP`, timeout, AbortSignal and request idempotency key are forwarded.
- Response output text, function calls, actual model ID, response ID, finish status and usage (input/output/total/cached/reasoning tokens) are normalized. Partial usage is retained for diagnostics but marked `usageSource=unavailable` unless input, output and total counts are all valid; billing must not treat incomplete usage as authoritative.
- Malformed tool arguments and unsupported stop sequences fail explicitly; streaming remains rejected by the complete-response Gateway API.
- Model discovery now returns provider-reported IDs only; it no longer appends hard-coded defaults and calls those IDs verified.
- Text/code capabilities are enabled only for recognized text-generation model families. Embedding/image/audio/unknown model families remain unverified. Vision, tool calling, structured output and reasoning remain `unknown` until a model-level capability source is confirmed.

### Verification and remaining gates

- Dedicated workflow `45710906329` passed on commit `83e1de544b2b`: API typecheck passed; 85/85 focused AI provider contract tests passed. This includes fake-HTTP tests for Responses request/response mapping, image payloads, function calls, JSON Schema, usage, idempotency, cancellation and model discovery. No real provider credentials or paid requests were used.
- Still pending: real-account sandbox smoke test; model-level capabilities for vision/tools/structured output/reasoning; dedicated streaming event contract; native adapters for Anthropic, OpenRouter, OrcaRouter, AnyModel and Ollama; billing ledger integration and cost reconciliation.


## 15. Authority of provider model discovery

A provider's `listModels()` implementation is the source of truth for catalog verification. It must return only model IDs actually returned by the authenticated upstream API. It must not merge static defaults or configured model IDs into a successful provider response, and it must propagate discovery failures instead of returning a plausible-looking fallback list.

- OpenAI: returns only model IDs returned by `GET /models`.
- Anthropic: requires a configured credential and returns only IDs returned by `GET /models`; it no longer advertises built-in defaults when credentials are absent or discovery fails.
- OrcaRouter: returns only IDs from its `/models` response; it no longer converts API failures into a list containing the configured/default model.
- AnyModel: returns only IDs from its `/models` response; the configured model remains a separate fallback diagnostic, not a provider-confirmed catalog item.
- OpenRouter and Ollama already return the IDs received from their upstream model-list endpoints.

The gateway may still expose the configured model as an explicitly unverified fallback for diagnostics and backwards-compatible display. `AIModelRegistry.select()` must never select such a fallback for real inference or plan entitlement assignment.

Dedicated workflow `45710389512` passed on commit `5fbbd6b50784eeabf136175019d1e196fdac44db`: API typecheck passed and 79/79 API tests passed, including provider catalog discovery conformance tests.


### OpenAI usage accounting hardening — 2026-11-26

- OpenAI Responses usage fields are accepted only when they are non-negative safe integers.
- Partial usage values are preserved as partial diagnostic data but now carry `usageSource=unavailable`; they are not treated as complete provider-reported usage and must not be used as a final billable amount.
- No missing input/output/total token fields are fabricated as zero.
- Dedicated workflow `45710906329` passed on commit `83e1de544b2b4c289ea0b4d2b8a8b383ac1c69f8`: API typecheck passed; all API tests passed, including the partial-usage regression test.


## 16. Native Anthropic Messages adapter

Anthropic is the second native adapter. Its implementation follows the current Messages and Models API references.

### Protocol and versioning

- Canonical requests use `POST /v1/messages`.
- Model discovery uses `GET /v1/models?lifecycle=active&limit=1000`, follows `after_id` cursors, and excludes deprecated/retired models.
- Authentication uses `Authorization: Bearer`; the `anthropic-version` header defaults to `2026-10-21` and can be overridden with `ANTHROPIC_API_VERSION`.
- The adapter's protocol metadata is `anthropic-messages`, version `2.0.0`.
- Current official references:
  - https://platform.claude.com/docs/en/api/messages
  - https://platform.claude.com/docs/en/api/models/list

### Canonical mapping implemented

- Leading system/developer messages are mapped to the top-level `system` field. Interleaved system/developer messages are rejected because moving them would change message semantics.
- User/assistant turns, base64 images, assistant `tool_use` blocks, user `tool_result` blocks, function definitions and tool choice are mapped to Messages API structures.
- JSON Schema output maps to `output_config.format`; plain JSON mode without a schema is rejected.
- `maxTokens`, `temperature`, `topP`, stop sequences, timeout and AbortSignal are mapped. URL image sources are rejected rather than fetched server-side (SSRF-safe); supported base64 image media types are accepted.
- Text, tool calls, actual model ID, message ID, stop reason and stop sequence are normalized.
- Model API metadata is used for lifecycle, context window, image input, structured outputs and thinking/reasoning capabilities. Missing capability data remains `unknown`; it is never promoted to `true` from the model name alone.
- Streaming remains disabled in the complete-response Gateway contract.
- Usage maps input/output, cache-read, cache-creation and thinking tokens. `totalTokens` is derived only when all four provider counters are present; otherwise `usageSource=unavailable`.

### Billing boundary — must be completed before production charging

The adapter now preserves Anthropic cache-read and cache-creation token dimensions in the canonical usage object. However, the current `usage_records` table in migration `010_usage_billing.sql` stores only input/output tokens, tool calls, duration and estimated cost. It does not yet persist cache-read, cache-creation, reasoning tokens, provider request ID or usage source. Therefore cost reconciliation for cached Anthropic requests is **not production-ready**. Before enabling paid subscriptions or production AI calls, add the missing usage-ledger columns, idempotent settlement keyed by provider request/operation ID, provider-specific price dimensions and reconciliation tests.

### Verification

- Dedicated workflow `45712044538` passed on commit `04ef04e1283c`: API typecheck passed; 93/93 focused AI provider contract tests passed, including Anthropic serialization, tool/image/JSON Schema mapping, lifecycle pagination, capability metadata, cache usage and cancellation.
- No live Anthropic credentials, live provider requests, production secrets or paid calls were used.
- Full NEXUM CI for the latest Anthropic implementation is pending; do not infer E2E success from the focused adapter suite.


## 12. Adapter-specific authentication and verification

Authentication is part of each provider adapter contract and must not be generalized into one universal header. For Anthropic Messages, the adapter sends the provider credential in `x-api-key` and the API version in `anthropic-version`; it must not send the key as a Bearer token. The regression test asserts both the required header and absence of `Authorization`.

Provider acceptance remains staged: source-level contract tests do not equal a live provider smoke test. A provider is not marked operationally verified until an authorized sandbox request succeeds and returns a valid model identity and usage metadata.


## 13. Canonical streaming contract

The canonical streaming API is an async event stream. Event types are `message_start`, `text_delta`, `tool_call_start`, `tool_call_delta`, `usage`, `message_end`, and provider errors are surfaced as classified gateway errors (not as fabricated text). Provider adapters must preserve event order, honor AbortSignal and request timeout, parse incomplete SSE chunks safely, and never expose upstream credentials or raw sensitive error payloads. Usage is authoritative only when the provider supplies the required counters; otherwise emit `source: unavailable` and do not synthesize zeroes.

The gateway rejects streaming before provider invocation unless the adapter implements `streamRequest` and the selected model explicitly reports streaming support. A completed-response API must not silently buffer a streaming request.

Anthropic Messages now implements SSE streaming with text deltas, tool-call start/JSON argument deltas, finish reason, request identity, and reported usage. Its adapter tests use deterministic in-memory SSE responses and reject streams that close before `message_stop`; the reader is cancelled on early consumer exit. These are contract tests, not a live Anthropic connectivity test.


### OpenAI Responses streaming adapter

OpenAI uses the native `POST /responses` endpoint with `stream: true` and Bearer authentication. The adapter maps `response.created`, `response.output_text.delta`, `response.output_item.added` for function calls, `response.function_call_arguments.delta`, and terminal `response.completed` / `response.incomplete` events into the canonical stream. It preserves provider response identity and reported token dimensions; partial/missing usage is explicitly marked unavailable. SSE parsing supports arbitrary chunk boundaries, multiline data, and a final frame without a trailing blank line. A stream that closes without a terminal response event is rejected as truncated.

Streaming capability is declared for recognized OpenAI text-generation model families; unknown model families remain fail-closed in the Gateway. Deterministic fake-stream tests cover text, function arguments, final usage, arbitrary chunk splitting, and truncated-stream rejection. This is not a live OpenAI connectivity or billing verification.


### OpenRouter Chat Completions streaming

OpenRouter's Chat Completions adapter uses its native `/chat/completions` SSE endpoint. A model is considered stream-capable only after it is present in the provider's model catalog; the `openrouter/free` alias remains unverified until its concrete routed model can be resolved. The adapter maps content deltas, incremental function-call headers/arguments, finish reason and complete provider usage into canonical events. It reads cached and reasoning token dimensions when supplied, ignores SSE keep-alive comments, handles arbitrary chunk boundaries and the final `[DONE]` sentinel, and rejects mid-stream error frames, missing finish reasons and truncated streams. The provider response ID is used as the canonical request identity when available.

The deterministic test suite exercises catalog gating, SSE comments and chunk splitting, text, tool calls, usage and truncated streams. This is not a live OpenRouter request. The adapter does not assume that OpenRouter's Responses API and Chat Completions API share the same event schema; the current integration explicitly targets Chat Completions.


### Shared OpenAI-compatible SSE parser and additional gateways

OpenRouter, OrcaRouter and AnyModel now share `streamOpenAICompatibleChat` in `apps/api/ai/openaiCompatibleAdapter.ts`. Each provider retains its own base URL, authentication, timeout and request lifecycle; only the Chat Completions SSE event normalization is shared. The parser handles keep-alive comments, arbitrary byte/chunk boundaries, text deltas, incremental tool-call IDs/names/arguments, provider usage dimensions, finish reasons, mid-stream errors and mandatory `[DONE]` termination. The three providers enable streaming only after the selected model has been loaded from that provider's model catalog. OrcaRouter requests the standard usage frame; it does not opt into its additional cost metadata because the canonical usage ledger does not yet persist provider-specific currency amounts.

Provider-specific streaming support was checked against current documentation: OpenRouter documents Chat Completions and Responses SSE separately; OrcaRouter documents `stream: true` and `stream_options.include_usage`; AnyModel documents standard OpenAI-compatible streaming. Contract tests use deterministic in-memory responses and do not establish live service availability or provider billing correctness.


### Ollama native NDJSON streaming

Ollama's `/api/chat` streaming format is newline-delimited JSON, not SSE. The adapter parses NDJSON frames, emits text deltas, and reads prompt/evaluation token counts and the cached-prompt counter when supplied in the final `done: true` frame. It does not invent a finish reason when Ollama omits one. It requires the selected model to have been discovered through `/api/tags`, honors timeout and AbortSignal, cancels the reader on early exit, and rejects truncated streams without the terminal frame. The current canonical implementation is intentionally text-only: images, tool calls and structured output are rejected before network invocation until their streaming semantics are separately implemented and verified. This is based on Ollama's current streaming/API documentation and deterministic local contract tests, not a live Ollama runtime test.
