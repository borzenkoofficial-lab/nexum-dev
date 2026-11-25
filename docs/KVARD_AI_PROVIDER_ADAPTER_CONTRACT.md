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
- `generate(canonicalRequest)`;
- `stream(canonicalRequest)`, только если streaming capability заявлена;
- нормализацию usage, finish reason, tool calls и ошибок;
- таймауты, отмену запроса, ограниченные retries и safe error mapping.

Текущая реализация `AIProvider.generate(message: string): Promise<string>` слишком узкая для конечного стандарта: её можно временно сохранить как legacy compatibility path, но новые продуктовые функции должны переходить на канонический контракт.

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
