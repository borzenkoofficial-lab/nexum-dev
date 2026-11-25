# КВАРД — архитектура AI-провайдеров, подписок и биллинга

Статус: архитектурное решение / реализация не завершена. Документ является спецификацией для последующих изменений backend, БД, интерфейса и платёжных интеграций.

## 1. Цель

Сделать единый AI Gateway КВАРД, через который проходят все платные запросы. Ключи провайдеров принадлежат платформе, хранятся на сервере и не раскрываются пользователям. Подписка определяет доступные модели, лимиты и бюджет. После каждого запроса система фиксирует фактическое потребление, стоимость и остаток лимита. При исчерпании бюджета новые платные запросы блокируются до продления или пополнения.

## 2. Что обнаружено в текущем коде

- В проекте уже есть AI Gateway и провайдеры: OpenAI, Anthropic, OpenRouter, OrcaRouter, AnyModel и Ollama.
- Список моделей и capabilities можно получить через существующие provider adapters.
- Пользовательские API-ключи сейчас помещаются в in-memory Map на конкретном экземпляре API. После рестарта процесса они теряются; между несколькими экземплярами API состояние не разделяется.
- В .env.example предусмотрены серверные ключи AnyModel/OpenRouter; для остальных провайдеров конфигурация частично читается из переменных окружения.
- Есть organization_subscriptions и subscription_plans, но сейчас в них нет полноценного жизненного цикла платёжных событий и привязки тарифных прав к конкретным моделям.
- usage_records содержит provider/model/input_tokens/output_tokens/estimated_cost, но таблица пока не является полноценным ledger: отсутствует idempotency key, reservation/settlement state и связь с подпиской/тарифным периодом.
- Существующие платежные webhooks и автоматическое пополнение баланса AI-провайдера в изученных модулях не обнаружены. Это нужно подтвердить отдельным аудитом интеграций перед подключением конкретного платёжного провайдера.

## 3. Целевая архитектура

### 3.1 Platform Provider Registry

Серверный реестр провайдеров и моделей:
- provider id, название, тип API, base URL, enabled;
- credential state: missing/configured/invalid/unknown — без значения ключа и без его фрагментов;
- last health check, latency, error category;
- default model, fallback policy;
- модели и capabilities (text, code, vision, tool calling, reasoning, structured output, streaming);
- источник цены и дата обновления цены.

Секреты хранятся в PostgreSQL только в AES-256-GCM envelope. Ключ шифрования — отдельный секрет окружения AI_PROVIDER_ENCRYPTION_KEY, не совпадающий с JWT/MFA secret и не хранящийся в БД или репозитории. API возвращает только состояние секрета и метаданные. Запись/ротация секрета требует отдельного permission, свежего MFA step-up, аудита и проверки подключения. Секреты запрещено логировать, отправлять в браузер или включать в экспорт.

### 3.2 Plans and entitlements

Тариф должен определять:
- доступные provider/model IDs или model groups;
- включённый AI-бюджет в валюте биллинга;
- лимиты input/output tokens и/или стоимость за период;
- разрешённые функции (vision, tools, long context, agents);
- concurrency, rate limits и лимит параллельных запросов;
- overage policy: hard stop, платное превышение с отдельным согласием или покупка пакета.

Проверка тарифа выполняется backend перед каждым вызовом. UI не является источником разрешений. Модель, выбранная пользователем, проверяется по entitlements; недоступная модель отклоняется сервером. Fallback разрешён только на модели, также доступные по тарифу и укладывающиеся в бюджет.

### 3.3 Usage ledger and budget enforcement

Каждый вызов получает уникальный request/idempotency ID. До вызова модели backend:
1. проверяет активную подписку и период;
2. проверяет разрешение на выбранную модель;
3. оценивает максимальный возможный расход и резервирует бюджет атомарно;
4. отклоняет запрос, если бюджет/лимит уже исчерпан или резерва недостаточно.

После ответа backend сохраняет provider-reported usage (input/output/cache/reasoning tokens, если доступны), цену по актуальному тарифному справочнику и фактическую стоимость. Резерв превращается в списание; при ошибке резерв освобождается. Повторный webhook/повторная обработка одного request ID не должны списывать средства второй раз. Если провайдер не сообщает usage, запись помечается estimated и не должна называться точным фактическим расходом.

Счётчики и финансовый ledger должны быть согласованы транзакциями PostgreSQL. Для конкурентных запросов нужна атомарная блокировка/резервирование бюджета, чтобы параллельные запросы не превысили лимит.

### 3.4 Payments and automatic provisioning

Платёжная интеграция должна обрабатывать только подтверждённые server-to-server webhooks:
- проверка подписи, суммы, валюты, заказа и статуса;
- идемпотентная регистрация события;
- создание/продление/отмена подписки;
- применение entitlements и периода тарифа;
- запись финансового аудита;
- уведомление пользователя.

Оплата подписки КВАРД не должна означать покупку отдельного API-ключа или токенов на аккаунте пользователя. Платформа использует собственные provider accounts и оплачивает фактическое потребление по своим договорам/балансам. Это позволяет автоматически включать AI после оплаты, но требует контроля платформенного денежного лимита и достаточного баланса у провайдера.

Автоматический top-up провайдерского баланса реализуется только для тех поставщиков, у которых есть официально поддерживаемый API/механизм автопополнения. Если его нет, система должна заранее предупреждать о низком балансе и блокировать/переводить трафик на разрешённый резервный provider, а не имитировать покупку. Любой автоматический платёж провайдеру должен иметь жёсткий месячный cap, лимит одной операции, аудит и выключатель.

### 3.5 Routing and failover

- Единый backend gateway для всех agent, chat, builder и workforce запросов.
- Запрещены обходные вызовы провайдера из frontend.
- Выбор модели хранится в настройках пользователя/организации, но сервер валидирует её против активного тарифа.
- Fallback не должен неожиданно переводить запрос на более дорогую или запрещённую модель.
- Таймауты, rate limits, retries и provider health проверяются отдельно; повтор запроса не должен приводить к двойному списанию.

## 4. Предлагаемые таблицы

Окончательные имена/поля уточняются при реализации и проверке миграций:
- ai_provider_credentials: provider_id, encrypted_secret, secret_version, configured_by, created_at, updated_at, last_verified_at, status.
- ai_provider_settings: provider_id, enabled, default_model, fallback_provider_id, health state and timestamps.
- ai_model_catalog: provider_id, model_id, capabilities JSONB, input/output/cache price, currency, price_source, price_updated_at, enabled.
- plan_model_entitlements: plan_id, provider_id, model_id or model_group, limits and feature flags.
- usage_reservations: request_id unique, organization/user/subscription, reserved_amount, state, expiry.
- usage_ledger: request_id unique, provider/model, token counts, provider cost, customer charge, currency, pricing version, status and timestamps.
- payment_events: provider event ID unique, verified payload metadata, processing state.
- subscription entitlement snapshot: applied plan/version and billing period.

Existing usage_records may remain a compatibility/analytics projection while the new ledger is introduced and reconciled.

## 5. Безопасность и финансовые инварианты

- Default deny: отсутствие подписки/entitlement/цены/ключа/проверенного состояния означает отказ от платного запроса.
- Не доверять клиентскому provider, model, token count, cost или subscription status.
- Не хранить секреты в открытом виде; ключ шифрования — отдельный секрет окружения или KMS.
- Не отдавать секреты в API, browser storage, logs, traces, error messages, source maps.
- Секреты доступны только серверному процессу и ограниченным операциям ротации.
- Все изменения тарифов, цен, credentials, лимитов, подписок и ручных корректировок аудируются.
- Обработка платежей и usage должна быть идемпотентной.
- На исчерпании лимита — fail closed, никаких скрытых платных fallback или автоматического overage без явного согласия.
- Автоматический provider top-up выключен по умолчанию и требует отдельного финансового лимита и подтверждённой интеграции.

## 6. Порядок реализации

1. Provider Registry + безопасное постоянное хранение credentials + health status.
2. Model Catalog + серверный выбор модели и provider/model entitlements.
3. Usage ledger, резервирование и settlement на всех путях AI Gateway.
4. Subscription plans, периоды, бюджеты и enforcement.
5. Payment adapter/webhooks и автоматическая активация/продление подписок.
6. Provider account balance monitoring и только затем — поддерживаемый автоматический top-up.
7. Admin UI, user billing UI, нагрузочные/конкурентные/security tests и reconciliation.

## 7. Важные ограничения

- API-провайдеры обычно тарифицируют платформу по факту использования. «Купить токены автоматически» — не универсальная операция; это зависит от billing API каждого поставщика. Часто достаточно настроить автосписание/оплату счёта на provider account, а КВАРД отдельно учитывает расход каждого пользователя.
- В первой версии безопаснее использовать общий platform balance с жёстким бюджетом, а не пытаться создавать отдельный provider account на каждого пользователя.
- Никакие production secrets, миграции, provider top-ups или production deployments не выполняются без отдельного согласования.
