# КВАРД — дизайн миграции на канонический AI Provider Contract

Дата: 2026-11-26
Статус: принято к реализации по делегированию владельца проекта.

## Цель

Сделать КВАРД независимым от внешних API-форматов AI-поставщиков. Чат, агенты, Builder, Runtime и Workforce используют внутренний контракт КВАРД. Каждый внешний поставщик подключается отдельным адаптером, который переводит запросы/ответы, capabilities, usage и ошибки.

## Пользовательский результат

- Добавление нового провайдера не требует переписывать продуктовые модули.
- Провайдер не считается совместимым только потому, что его API «похож на OpenAI».
- Не поддерживаемые конкретной моделью функции явно отклоняются, а не теряются молча.
- Старые текстовые сценарии продолжают работать через переходный слой.
- Учёт расхода отличает подтверждённые провайдером токены от неизвестного или расчётного расхода.
- Ошибки, таймауты, отмена, повторы и fallback имеют единое поведение.

## Подходы

1. **Оставить OpenAI-compatible формат как внутренний стандарт.** Быстро для похожих API, но привязывает платформу к чужому контракту и плохо покрывает native API, usage-различия и будущие мультимодальные функции. Отклонён.
2. **Переписать все продуктовые модули под каждый provider API.** Даёт контроль, но создаёт N×M интеграций и высокую вероятность регрессий. Отклонён.
3. **Внутренний canonical contract КВАРД + provider adapters + legacy bridge.** Продуктовые модули говорят только на языке КВАРД; адаптеры отвечают за особенности поставщиков. Выбран как единственный устойчивый путь.

## Текущая база

- Node.js/TypeScript API.
- Существуют AIGateway, AIProvider, AIModelRegistry и адаптеры OpenAI, Anthropic, OpenRouter, OrcaRouter, AnyModel, Ollama и Mock.
- Текущий AIProvider.generate принимает одну строку и возвращает строку.
- AIRequest/AIResponse уже существуют, но не образуют реально используемый универсальный контракт; content строковый, usage ограничен input/output/total.
- В текущих адаптерах capabilities часто статически выключены для vision, tools, streaming, structured output и reasoning. Нельзя объявлять поддержку без реальной сериализации и тестов.
- Gateway уже содержит fallback, поэтому новая реализация обязана сохранить текущие тесты и не расширять fallback автоматически.

## Архитектурное решение

### Канонический запрос

Версионированный внутренний запрос КВАРД должен представлять:
- сообщения с ролями system/developer/user/assistant/tool;
- текстовые и мультимодальные content parts;
- provider/model selection и policy;
- generation options, response format, tool definitions/tool choice;
- stream/abort/timeout;
- request/correlation/idempotency metadata.

На первом безопасном шаге текстовые сообщения поддерживаются всеми legacy adapters. Новые типы мультимодальности, tools, streaming и structured output не должны автоматически считаться поддержанными legacy адаптерами. Запрос с такими функциями отклоняется до отправки внешнему провайдеру, если адаптер явно не реализует соответствующую возможность.

### Канонический ответ

Единый ответ должен содержать content blocks, tool calls, provider/model, request ID, finish reason, usage categories, latency и источник usage (provider_reported / estimated / unavailable). Существующий строковый API сохраняется как совместимый фасад.

### Адаптеры

- AIProvider сохраняет текущий generate(message) для обратной совместимости.
- Добавляется optional generateRequest(request) для нативной реализации канонического контракта.
- Gateway выбирает generateRequest, если он реализован; иначе использует legacy bridge только для гарантированно текстового запроса.
- Legacy bridge не выдумывает usage, не симулирует tool calls и не принимает неподдерживаемые capabilities.
- Capabilities проверяются для конкретной модели через getCapabilities(model), иначе используются capabilities адаптера как консервативный fallback.
- Провайдерские протоколы остаются native (Anthropic Messages, OpenAI APIs, Ollama и т.д.); не навязывать всем одинаковый внешний wire format.

### Ошибки и повторные запросы

- Сохраняется NexumError/classifyAIError как совместимый слой.
- Нормализуются категории authentication, permission, rate limit, quota, invalid request, unsupported capability, timeout/cancelled, unavailable и unknown.
- Retry только для временных ошибок; не повторять auth, quota, invalid request.
- Не добавлять fallback в канонический API в этом этапе. Существующая gateway fallback-логика не меняется.
- Секреты и фрагменты credentials не должны попадать в нормализованные ошибки/логи.

## Границы этапа

Входит:
- канонические типы и runtime-валидация;
- legacy bridge;
- новый gateway method для canonical request;
- нормализация ответа и usage source;
- conformance tests на реальном контракте и legacy ограничения;
- документация и checklist.

Не входит:
- реализация vision/audio/video/tools/streaming для каждого поставщика;
- замена всех продуктовых вызовов в чате/Builder/агентах;
- тарифы, usage ledger, reservations и платежи;
- production secrets, миграции или deploy.

## Критерии приёмки

1. Все существующие AI Gateway тесты проходят без изменения их семантики.
2. Legacy adapters принимают текстовый canonical request и возвращают нормализованный ответ.
3. Legacy adapters отклоняют vision/tools/streaming/structured output до внешнего вызова.
4. Нативный adapter может обработать canonical request через generateRequest.
5. Неполный или отсутствующий usage не превращается в 0 и помечается unavailable.
6. Неверный provider/model и неизвестные capabilities возвращают типизированную безопасную ошибку.
7. AbortSignal передаётся адаптеру.
8. Conformance suite проверяет минимальный контракт, ошибки и отсутствие секретов в публичной ошибке.
9. API typecheck, unit tests и CI проверены; никаких production действий.


## Дополнительные решения после conformance review

- Assistant message может содержать `toolCalls`, даже если текстовый content пустой. Tool-call history — часть canonical conversation, а не только отдельный список доступных tools.
- Usage принимается только как неотрицательные целые token counts. Если usage отсутствует, malformed или противоречит `usageSource`, нормализованный источник становится `unavailable`. Estimated usage остаётся явно estimated.
- Redaction покрывает оба поля `NexumError`: `technicalDetails` и `userSafeMessage`. Нельзя полагаться на то, что уже классифицированная ошибка безопасна.
- Dedicated provider-contract workflow выполняет API typecheck и полный API test suite отдельно от browser E2E.

## Реализация foundation

Реализованы canonical types/validation, strict legacy bridge, `AIGateway.generateRequest()`, model capability checks, response/usage normalization, tool-call history validation, error credential redaction и reusable conformance tests. Реальные provider-specific native adapters и миграция продуктовых call sites остаются следующей фазой.
