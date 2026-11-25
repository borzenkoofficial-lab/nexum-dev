# КВАРД — Admin Control Center: master checklist

**Назначение:** единый неизменяемый реестр реализации административной панели. Этот документ — источник истины для статусов. После каждого завершённого этапа обновлять именно его. Не повторять выполненные пункты без конкретного регресса или новой причины.

**Принцип готовности:** пункт получает `DONE` только после реализации в коде, проверки серверной авторизации, тестов и фиксации доказательства (commit/PR/CI). Наличие макета или UI без работающего backend не считается выполнением.

**Текущий статус:** `IN_PROGRESS` — RBAC/MFA, защищённый `/admin`, реестры пользователей и организаций, карточка пользователя, блокировка аккаунтов, фильтры аудита и live dashboard metrics реализованы в коде. Последний CI: API tests, Web typecheck/build/lint, Docker build и smoke test прошли; Runtime E2E был отменён до завершения. Отдельные security-интеграционные тесты административных маршрутов ещё нужны. Production admin API остаётся закрытым.

## Правила ведения чек-листа

- `TODO` — не начинали.
- `IN_PROGRESS` — ведётся реализация.
- `PARTIAL` — часть готова, критерий приёмки не выполнен полностью.
- `BLOCKED` — есть конкретный внешний блокер, указанный рядом.
- `DONE` — критерии приёмки подтверждены тестами и кодом.
- `NEEDS_RECHECK` — ранее было DONE, но появился регресс/существенное изменение, требующее повторной проверки.
- После завершения задачи записать commit/PR, тесты и дату в журнале прогресса.
- Не менять статус на DONE только по результату визуального осмотра.
- Не закрывать повторно уже DONE пункты без воспроизводимого дефекта.
- При изменении архитектуры сначала обновить этот документ, затем код.

## 0. Решение по доступу — обязательный security gate

**Модель доступа: закрытая административная консоль, default-deny.**

- [ ] SEC-01. Админ-раздел доступен только после обычной аутентификации пользователя. — PARTIAL: frontend `/admin` обёрнут в существующий AuthGate; API использует authMiddleware. Полный QA всех маршрутов ожидается.
- [ ] SEC-02. Доступ к `/admin` и каждому административному API проверяется сервером; скрытие пункта меню не является защитой. — PARTIAL: `/admin` подключён через AuthGate, `/api/admin/*` закрыт серверным auth/RBAC; production gate намеренно возвращает 503 до security sign-off.
- [ ] SEC-03. Использовать отдельные административные роли и permission-based RBAC. — IN_PROGRESS: роли и permission map добавлены в `apps/api/adminAccess.ts`.
- [ ] SEC-04. Новые аккаунты по умолчанию не имеют административных прав. — PARTIAL: автоматическое назначение отсутствует; bootstrap требует явный UUID allowlist.
- [ ] SEC-05. Самостоятельная регистрация/самоназначение администратором невозможны. — PARTIAL: публичного API назначения роли нет; требуется тестирование прямых запросов.
- [ ] SEC-06. Первый Super Admin назначается только через контролируемый bootstrap allowlist `KVARD_SUPER_ADMIN_USER_IDS`; используются UUID существующих аккаунтов, так как текущая регистрация не подтверждает владение email. Значение хранится только в backend env.
- [ ] SEC-07. После bootstrap выдача и отзыв административных ролей выполняются только действующим Super Admin с обязательной записью в audit log. — PARTIAL: API role changes require `roles.manage` (Super Admin only); self-change blocked; audit event written. Last Super Admin downgrade/revoke guarded by advisory transaction lock and count check (commit `5c7a5cd`), CI pending.
- [ ] SEC-08. Если allowlist/роль/БД недоступны, доступ закрывается (fail closed), а не открывается. — PARTIAL: admin auth fail-closed; миграция `018_user_account_status.sql` вводит active/suspended, login фильтрует suspended accounts, authMiddleware не обновляет сессию для suspended account.
- [ ] SEC-09. Проверить, что обычный пользователь, даже зная URL и API endpoints, получает 403.
- [ ] SEC-10. Проверить, что пользователь не может повысить собственную роль через изменение запроса, профиля, организации или JWT payload.
- [ ] SEC-11. Административные сессии имеют отдельную политику: короткий idle timeout, повторное подтверждение для критических действий, отзыв сессий. — IN_PROGRESS: добавлена серверная таблица `auth_sessions` (migration `016`), 30-минутный idle timeout на каждом авторизованном запросе, проверка отзыва/срока в БД, отзыв текущей сессии при logout, Super Admin-only API просмотра активных сессий и отзыва конкретной сессии с audit event. При изменении/снятии административной роли все сессии пользователя отзываются в той же транзакции; событие аудита содержит число отозванных сессий. Повторное подтверждение MFA для критических операций и отдельные тесты сессий ещё нужны.
- [ ] SEC-12. Добавить MFA для административных аккаунтов до production-доступа. — IN_PROGRESS: TOTP/recovery primitives, AES-256-GCM encrypted-secret helper, migration `013_admin_mfa.sql`, enrollment setup/confirm/status API mounted at `/api/auth/admin-mfa/*` (admin role required), rate limiting, 10-minute pending enrollment expiry, rejection of setup over existing MFA, and five-attempt enrollment confirmation guard added. Migration `014_admin_mfa_enrollment_guard.sql` added. Admin login now uses a 5-minute HttpOnly/SameSite=Strict challenge cookie and one-time DB nonce. Verification consumes TOTP counters with replay rejection or recovery codes atomically, applies a 5-failure/15-minute lockout, rechecks the current admin role, and issues an 8-hour signed MFA session. Admin API requires the signed MFA claim; AuthGate includes the challenge UI. Session cookie expiry now matches token expiry. CI run `45689990353` passed completely on commit `44db138d` (API tests, web build/lint, Docker build, E2E). That run included the AES-GCM canonical-encoding fix. Server-side session revocation/idle timeout is now being added separately; its CI is pending. Full dedicated MFA abuse-case tests and production configuration remain. Production admin API remains closed.
- [ ] SEC-13. Все критические действия требуют подтверждения и пишутся в неизменяемый аудит. — PARTIAL: append-only audit schema создана; подтверждения и запись всех действий ещё не реализованы.
- [ ] SEC-14. Секреты провайдеров никогда не возвращаются UI; показывать только маскированное значение/статус наличия.
- [ ] SEC-15. Защита от CSRF, rate limiting, secure/HttpOnly/SameSite cookies, строгая CORS policy и проверка origin для административных операций.
- [ ] SEC-16. Проверить отсутствие обхода через альтернативные маршруты, websocket, фоновые jobs и прямые API вызовы.

### Роли и базовые полномочия

| Роль | Назначение | Базовый доступ |
|---|---|---|
| Super Admin | Полный контроль платформы | Все модули, назначение администраторов, системные критические операции |
| Admin | Операционное управление | Пользователи, организации, проекты, настройки в пределах разрешений; без управления Super Admin |
| Support | Поддержка пользователей | Просмотр разрешённого контекста, обращения; без секретов, финансовых и разрушительных действий |
| Finance | Финансы и подписки | Платежи, тарифы, отчёты; без доступа к секретам и runtime-командам |
| Developer | Техническая диагностика | Сервисы, логи, деплои, диагностика; без управления платежами и выдачи ролей |
| Auditor | Контроль и расследование | Read-only доступ к аудит-логам и согласованным отчётам |

Права должны назначаться по отдельным permissions, а не только по названию роли. Super Admin — отдельный защищённый уровень. Support/Finance/Developer/Auditor не получают полный доступ автоматически.

### Что выяснить до выдачи первого доступа

- [ ] SEC-17. Определить UUID аккаунтов владельца и первых администраторов; email не считается подтверждённым, пока в продукте нет email verification.
- [ ] SEC-18. Настроить серверный bootstrap allowlist `KVARD_SUPER_ADMIN_USER_IDS` только после реализации MFA и подтверждения UUID; до этого production API закрыт.
- [ ] SEC-19. Проверить восстановление доступа и процедуру экстренного отзыва административных сессий.

**Важно:** до подтверждения конкретных email и настройки bootstrap allowlist не выдавать административный доступ никому. Не зашивать адреса в исходный код.

## 1. Архитектура и базовая инфраструктура

- [ ] ARCH-01. Зафиксировать отдельный модуль Admin Control Center в архитектуре приложения.
- [ ] ARCH-02. Добавить отдельную группу маршрутов `/admin` во frontend.
- [ ] ARCH-03. Добавить backend router `/api/admin/*` с централизованным middleware. — IN_PROGRESS: router смонтирован с auth, rate limit и RBAC middleware.
- [ ] ARCH-04. Добавить схему ролей, permissions и назначений в PostgreSQL через новую миграцию. — IN_PROGRESS: миграция `012_admin_rbac.sql` добавлена; применение БД ещё не подтверждено.
- [ ] ARCH-05. Добавить единый сервис проверки разрешений (RBAC). — IN_PROGRESS: `adminAccess.ts` реализует role/permission checks.
- [ ] ARCH-06. Добавить типизированные административные DTO и единый формат ошибок.
- [ ] ARCH-07. Добавить audit log с actor, action, target, timestamp, request ID и безопасными metadata. — PARTIAL: append-only таблица и trigger; writer уже реализован для назначения/отзыва ролей и bootstrap, audit reader API добавлен. Не все критические действия ещё журналируются.
- [ ] ARCH-08. Разделить read-only операции и операции изменения состояния.
- [ ] ARCH-09. Реализовать пагинацию, фильтры, сортировку и серверные лимиты.
- [ ] ARCH-10. Добавить тестовые проверки parsing bootstrap UUID и границ permissions; CI ещё не завершён.

## 2. Главная панель — Dashboard

- [ ] DASH-01. Сводное состояние платформы из реальных источников. — PARTIAL: `/api/admin/overview` подключён к PostgreSQL users, organizations, projects, agents, agent_runs и usage_records.
- [ ] DASH-02. Пользователи: всего, активные, новые. — PARTIAL: total/active/suspended/new 7d из таблицы users.
- [ ] DASH-03. Организации и проекты. — PARTIAL: реальные counts из organizations/project_workspaces.
- [ ] DASH-04. Запущенные, завершённые и ошибочные задачи агентов. — PARTIAL: running/completed/failed counters из agent_runs.
- [ ] DASH-05. Использование AI-моделей, токенов и стоимость. — PARTIAL: tokens и estimated_cost за 30 дней из usage_records; валюта отображается в единицах источника.
- [ ] DASH-06. Состояние Runtime, Sandbox, API и БД.
- [ ] DASH-07. Ошибки и системные предупреждения с периодом.
- [ ] DASH-08. Доходы и расходы, если финансовые данные подключены.
- [ ] DASH-09. Последние административные и системные события.
- [ ] DASH-10. Переход из каждого показателя к соответствующему разделу.
- [ ] DASH-11. Пустые/недоступные данные показываются честно, без фиктивных нулей и demo-цифр.

## 3. Пользователи

- [ ] USER-01. Список пользователей с поиском и фильтрами. — PARTIAL: реестр с поиском по имени/email/UUID, серверным limit/offset и счётчиками организаций/проектов.
- [ ] USER-02. Профиль, дата регистрации и статус. — PARTIAL: реестр показывает имя, email, UUID, дату, active/suspended и причину блокировки; отдельная детальная карточка и активность не реализованы.
- [ ] USER-03. Организации, проекты и история активности.
- [ ] USER-04. Просмотр подписки и квот.
- [ ] USER-05. Блокировка/разблокировка с причиной и аудитом. — PARTIAL: migration `018`, suspend/reactivate endpoints требуют `users.manage` + fresh MFA; suspend отзывает все сессии, authMiddleware и login запрещают suspended аккаунт, события пишутся в audit log. Endpoint-level abuse tests pending.
- [ ] USER-06. Отзыв активных сессий.
- [ ] USER-07. Управление административными назначениями — только Super Admin.
- [ ] USER-08. Обращения поддержки и безопасный контекст диагностики.
- [ ] USER-09. Экспорт с ограничением персональных данных и аудитом.

## 4. Организации и рабочие пространства

- [ ] ORG-01. Реестр организаций. — PARTIAL: реестр с поиском, владельцем и агрегатами участников/агентов/workforces.
- [ ] ORG-02. Состав участников и роли. — PARTIAL: отдельный endpoint и UI для списка участников и ролей.
- [ ] ORG-03. Владелец и администраторы организации.
- [ ] ORG-04. Проекты, квоты и использование ресурсов.
- [ ] ORG-05. Тарифы и биллинг.
- [ ] ORG-06. Ограничение/восстановление организации с аудитом.
- [ ] ORG-07. История изменений и административных вмешательств.

## 5. AI-провайдеры и модели

- [ ] AI-01. Реестр провайдеров и подключённых моделей.
- [ ] AI-02. Статус доступности и последняя проверка.
- [ ] AI-03. Настройка модели по сценариям/задачам.
- [ ] AI-04. Безопасное подключение/ротация секретов через backend.
- [ ] AI-05. Маскированное отображение секретов без возможности прочитать исходное значение.
- [ ] AI-06. Расход токенов и стоимости по провайдерам/моделям/организациям.
- [ ] AI-07. Лимиты и бюджеты.
- [ ] AI-08. Таймауты, ошибки, задержки и rate limits.
- [ ] AI-09. Fallback-модели и правила автоматического переключения.
- [ ] AI-10. Безопасная проверка подключения без утечки ключа в логи.

## 6. AI-агенты и Workforce

- [ ] AGENT-01. Общий реестр агентских профилей и постоянных агентов.
- [ ] AGENT-02. Статус, владелец, конфигурация и назначенные инструменты.
- [ ] AGENT-03. Очередь задач и текущие запуски.
- [ ] AGENT-04. История выполнения, логи и причины ошибок.
- [ ] AGENT-05. Пауза/отмена/перезапуск с проверкой полномочий.
- [ ] AGENT-06. Управление доступными инструментами и permission scopes.
- [ ] AGENT-07. Лимиты времени, ресурсов и расходов.
- [ ] AGENT-08. Подтверждение опасных действий и история approvals.
- [ ] AGENT-09. Запрет на незаметное изменение системных инструкций и политик безопасности.

## 7. Runtime и инфраструктура

- [ ] INFRA-01. Состояние API и фоновых workers.
- [ ] INFRA-02. Состояние Runtime и Sandbox providers.
- [ ] INFRA-03. Контроль Daytona/Docker и окружений проектов.
- [ ] INFRA-04. CPU/RAM/disk — только если метрики реально доступны.
- [ ] INFRA-05. Состояние PostgreSQL, миграций и connection pool.
- [ ] INFRA-06. Очереди фоновых задач и зависшие jobs.
- [ ] INFRA-07. Логи с фильтрами и корреляцией по request/job ID.
- [ ] INFRA-08. Резервные копии: статус последней копии и проверка восстановления.
- [ ] INFRA-09. Доступность внешних сервисов и интеграций.
- [ ] INFRA-10. Опасные runtime-команды — только отдельное разрешение, подтверждение и аудит.

## 8. Проекты и Builder

- [ ] PROJ-01. Реестр проектов с поиском по пользователю/организации.
- [ ] PROJ-02. Состояние проекта, последняя активность и storage usage.
- [ ] PROJ-03. Состояние сборок, previews и production deployments.
- [ ] PROJ-04. История деплоев и ошибок.
- [ ] PROJ-05. Лимиты и квоты.
- [ ] PROJ-06. Управление хранилищем и резервными копиями.
- [ ] PROJ-07. Доступ к проекту поддержки — временный, ограниченный и аудируемый.

## 9. Финансы, тарифы и биллинг

- [ ] BILL-01. Реестр тарифов и подписок.
- [ ] BILL-02. История платежей и статусы транзакций.
- [ ] BILL-03. Выручка, возвраты и задолженности — из реального billing source.
- [ ] BILL-04. Себестоимость AI и инфраструктуры.
- [ ] BILL-05. Квоты, балансы и лимиты.
- [ ] BILL-06. Промокоды и скидки.
- [ ] BILL-07. Изменение тарифов с историей и датой вступления.
- [ ] BILL-08. Финансовые отчёты и безопасный экспорт.
- [ ] BILL-09. Разделение доступа Finance/Admin/Super Admin.

## 10. Интеграции и Tool Registry

- [ ] INT-01. Реестр интеграций и подключённых провайдеров.
- [ ] INT-02. Реестр инструментов (Tool Registry).
- [ ] INT-03. Статус подключения и дата последней проверки.
- [ ] INT-04. Управление scopes/permissions.
- [ ] INT-05. Управление webhooks и повторными попытками.
- [ ] INT-06. Ошибки интеграций и диагностика.
- [ ] INT-07. Отключение/ротация credentials с аудитом.

## 11. Безопасность и аудит

- [ ] AUDIT-01. Поиск по журналу административных действий.
- [ ] AUDIT-02. Фильтры по актору, действию, объекту и периоду.
- [ ] AUDIT-03. Защита журнала от изменения обычным администратором.
- [ ] AUDIT-04. История выдачи/отзыва ролей.
- [ ] AUDIT-05. История входов, MFA и отзыва сессий.
- [ ] AUDIT-06. События подозрительной активности.
- [ ] AUDIT-07. Маскирование персональных данных и секретов.
- [ ] AUDIT-08. Экспорт аудита с отдельным permission.
- [ ] AUDIT-09. Уведомления о критических изменениях.

## 12. Глобальные настройки

- [ ] SET-01. Настройки платформы и публичных параметров.
- [ ] SET-02. Глобальные лимиты и квоты.
- [ ] SET-03. Регистрация и доступность новых аккаунтов.
- [ ] SET-04. Тарифы и планы.
- [ ] SET-05. Feature flags и доступность модулей.
- [ ] SET-06. Системные уведомления.
- [ ] SET-07. Режим обслуживания.
- [ ] SET-08. Изменения настроек версионируются и аудируются.
- [ ] SET-09. Опасные настройки требуют повторного подтверждения.

## 13. Поддержка и диагностика

- [ ] SUPPORT-01. Центр обращений.
- [ ] SUPPORT-02. Контекст аккаунта и техническая диагностика с минимизацией персональных данных.
- [ ] SUPPORT-03. Внутренние заметки.
- [ ] SUPPORT-04. История обработки обращения.
- [ ] SUPPORT-05. Поиск по логам по безопасному идентификатору.
- [ ] SUPPORT-06. Проверка состояния пользователя/организации без обхода их прав доступа.

## 14. UX, адаптивность и доступность

- [ ] UX-01. Единая навигация Admin Control Center.
- [ ] UX-02. Простые таблицы, фильтры и понятные заголовки.
- [ ] UX-03. Нейтральная светлая тема Balanced Premium и поддержка тёмной.
- [ ] UX-04. Нет AI-декора, псевдотерминалов и декоративных панелей.
- [ ] UX-05. Единые состояния loading/empty/error/permission denied.
- [ ] UX-06. Адаптация desktop/tablet/mobile.
- [ ] UX-07. Доступность с клавиатуры, фокус и контраст.
- [ ] UX-08. Подтверждение необратимых действий и ясное описание последствий.

## 15. Приёмка и запуск

- [ ] QA-01. Тесты RBAC для каждой роли и каждого критического permission.
- [ ] QA-02. Проверка прямого доступа к frontend routes и backend endpoints.
- [ ] QA-03. Проверка горизонтального/вертикального повышения привилегий.
- [ ] QA-04. Проверка CSRF, rate limits, session revocation и MFA.
- [ ] QA-05. Проверка audit log для всех изменяющих операций.
- [ ] QA-06. Проверка утечек секретов в API responses, logs и frontend bundle.
- [ ] QA-07. Интеграционные тесты всех модулей с реальными сервисными контрактами.
- [ ] QA-08. E2E сценарии Super Admin/Admin/Support/Finance/Developer/Auditor.
- [ ] QA-09. Проверка резервного копирования и восстановления.
- [ ] QA-10. Production smoke test и проверка мониторинга.
- [ ] QA-11. Документация администратора и runbook экстренного отзыва доступа.
- [ ] QA-12. Финальный security review перед выдачей доступа.

## Порядок реализации

1. SEC + ARCH: закрыть модель доступа и backend основу.
2. Dashboard: только после готовности реальных источников данных.
3. Users + Organizations.
4. AI + Agents + Runtime + Projects.
5. Billing + Integrations.
6. Audit + Settings + Support.
7. UX polish, полный QA и ограниченный production rollout.

## Журнал прогресса

| Дата | Пункт/этап | Commit / PR | Проверки и результат | Статус |
|---|---|---|---|---|
| 2026-11-25 | Создан master checklist; аудит текущего auth | pending | Найдено: JWT session auth и authMiddleware; отдельный RBAC/admin allowlist пока не подтверждены | IN_PROGRESS |
| 2026-11-25 | MFA login challenge + verified session | `2a251e3`–`6b71dab` (TOTP/recovery, AES-GCM, migrations 013–015, enrollment and challenge APIs, AuthGate) | Admin login now uses a short-lived HttpOnly challenge cookie, one-time DB nonce, replay-safe TOTP counter, atomic recovery-code consumption, five-failure lockout, live role revalidation, and 8-hour verified session. Enrollment and challenge routes are rate-limited. Admin API rejects sessions without the signed MFA claim; production admin API remains closed. CI `45689990353` passed on `44db138d` (API, Web, Docker, E2E). Dedicated MFA abuse-case tests and production configuration remain pending; session revocation/idle timeout is tracked separately in SEC-11. | IN_PROGRESS |

| 2026-11-25 | SEC-11 session controls | `f85d409`–`4f1e156` (migration 016, auth session registry, middleware, logout revocation, admin session endpoints) | Added DB-backed sessions, 30-minute idle timeout, server-side revocation validation, logout revocation, and Super Admin-only list/revoke endpoints with audit logging. CI after these commits pending; no production migration applied. | IN_PROGRESS |

| 2026-11-25 | SEC-11 privilege-change invalidation | `0d2e807` | Administrative role promotion/demotion/revocation now revokes all target user sessions inside the same transaction; audit metadata records the revoked-session count. CI pending. | IN_PROGRESS |
| 2026-11-25 | Users, organizations, dashboard | `b78c5c2`–`4c0126a` (migration 018, suspended account enforcement, audited suspend/reactivate endpoints, live PostgreSQL dashboard metrics, directory UI) | API tests, Web typecheck/build/lint pass in workflow `45697446895`; Docker smoke and Runtime E2E still running. No production migration/deploy. | IN_PROGRESS |

## Историческая первичная проверка репозитория (до реализации Admin Control Center)

Подтверждено чтением текущего `main`:
- `apps/api/auth.ts` реализует JWT-сессию и `authMiddleware`.
- Production требует `NEXUM_AUTH_ENABLED=true` и `NEXUM_AUTH_SECRET` длиной не менее 32 символов.
- Пользовательский токен сейчас содержит id/email/name/createdAt; административные claims/роли в нём не обнаружены.
- `apps/api/routes/organizations.ts` содержит пользовательские маршруты организаций и проверку ролей организации, но это не глобальная административная RBAC-система.
- Отдельный Admin Control Center и административные API в рамках этого аудита не подтверждены.

**Вывод:** не строить защиту админки на frontend, email-проверке в React или существующей роли организации. Требуется отдельная серверная RBAC-модель и закрытый bootstrap первого Super Admin.


## Журнал прогресса — backend security foundation

| Дата | Пункты | Изменение | Доказательство / статус |
|---|---|---|---|
| 2026-11-25 | SEC-01–06, SEC-08, SEC-12–13, SEC-17–18; ARCH-03–05, ARCH-07, ARCH-10 | Добавлены PostgreSQL-таблицы RBAC и append-only audit log; серверный default-deny middleware; роли Super Admin/Admin/Support/Finance/Developer/Auditor; permission map; bootstrap по UUID существующих аккаунтов; защищённые `/api/admin/me` и `/api/admin/overview`; production admin API закрыт до MFA. | Commits: `5d4ac94`, `0c6f431`, `76990ac`, `db6cae0`, `ad22fc1`, `cfe3a3d`, `1111176`, `ba2aa2e`. CI на commit `735d4cd` полностью прошёл (API typecheck/tests, Web typecheck/build/lint, Docker smoke, E2E); migration проверена в CI E2E DB, но production не затрагивалась. |


| 2026-11-25 | SEC-03–05, SEC-08, SEC-13; ARCH-03–07 | Добавлены API просмотра/назначения/отзыва административных ролей и чтения аудита. Изменения ролей и события аудита записываются атомарно в одной транзакции; запрещено самоназначение/самоотзыв; нельзя отозвать последнего Super Admin; конкурентный отзыв Super Admin сериализован advisory lock. Bootstrap теперь не перезаписывает существующую роль, поэтому явный отзыв не будет автоматически отменён следующим запросом. | Код в apps/api/routes/admin.ts и apps/api/adminAccess.ts. Первый CI выявил типовую ошибку Express 5 req.params.userId; исправлено в d75b565. CI `45675626580` успешно завершился на commit `735d4cd` (build + E2E). После этого найден SQL синтаксический дефект bootstrap upsert; исправлен commit `ebf2005`, новый CI ожидается. |

## Последнее обновление — пользовательские карточки и аудит

- [ ] USER-02. Детальная карточка пользователя — PARTIAL: добавлен защищённый GET /api/admin/users/:userId; карточка показывает статус, организации и роли, проекты, подписки организаций, агрегаты AI usage и счётчики запусков агентов. Содержимое prompt/input/output не раскрывается.
- [ ] AUDIT-01. Поиск по журналу административных действий — PARTIAL: API поддерживает фильтры по UUID актора, действию, типу объекта, ID объекта и временному диапазону.
- [ ] AUDIT-02. Фильтры по актору, действию, объекту и периоду — PARTIAL: добавлена форма фильтров в UI; запрос выполняется по кнопке, а не на каждый введённый символ.
- [ ] SEC-13. Критические действия журналируются — PARTIAL: блокировка/разблокировка аккаунта записывается атомарно вместе с изменением статуса; блокировка отзывает сессии. Изменение административных аккаунтов ограничено Super Admin; последний активный Super Admin не может быть заблокирован.

| Дата | Пункты | Изменение | Проверки / статус |
|---|---|---|---|
| 2026-11-25 | USER-02, AUDIT-01–02 | Карточка пользователя: организации/роли, проекты, подписки, AI usage, агрегаты запусков. Аудит API: фильтры actor/action/target/date, пагинация; UI применяет фильтры явно. | Commits `19f4527`, `e1844cc`, `adb8734`. Workflow `45698449442`: API tests, Web typecheck/build/lint, Docker build и smoke test прошли; Runtime E2E отменён до результата. IN_PROGRESS. |
| 2026-11-25 | SEC-13, USER-05 | Защита административных аккаунтов от блокировки обычным Admin; только Super Admin может блокировать/активировать администраторов. Последний активный Super Admin защищён advisory lock + транзакционной проверкой. | Commit `f5763a0`; вошёл в build workflow `45698449442` (build success), отдельные abuse-case tests pending. IN_PROGRESS. |


## 2026-11-25 — AI Providers, Models, Subscriptions и usage billing

- Архитектурная спецификация создана: `docs/KVARD_AI_BILLING_ARCHITECTURE.md` (commit `eb4d276`).
- Подтверждено по текущему коду: поддерживаются OpenAI, Anthropic, OpenRouter, OrcaRouter, AnyModel и Ollama; уже существует общий AI Gateway и получение каталога моделей.
- Обнаружен важный технический долг: пользовательские provider credentials хранятся в process-local `Map` и теряются при перезапуске API. Это не подходит для постоянной платформенной конфигурации и нескольких экземпляров.
- Существующая `usage_records` содержит provider/model/tokens/estimated_cost, но не обеспечивает полноценный idempotent usage ledger, предварительное резервирование бюджета и settlement.
- Уже есть `subscription_plans` и `organization_subscriptions`, однако платежный webhook lifecycle и entitlement-модель для конкретных AI-моделей пока не подтверждены.
- Автоматическое пополнение баланса provider API не является универсальной функцией. Оно будет подключаться только через официально поддерживаемые механизмы конкретного провайдера; в остальных случаях нужны мониторинг баланса, жёсткий spend cap и fail-closed.
- Следующие этапы реализации: (1) encrypted persistent provider credentials + admin registry, (2) model catalog + entitlements, (3) usage reservations/ledger, (4) subscription enforcement, (5) payment webhooks, (6) provider balance monitoring/top-up adapters.
- Ничего не развёртывалось в production, миграции production не запускались, секреты и платежи не менялись.
- Workflow `45698861118`: Build завершился успешно; Runtime E2E был отменён, поэтому полный CI для текущего набора изменений не подтверждён.

| Дата | Пункты | Изменение | Проверки / статус |
|---|---|---|---|
| 2026-11-25 | AI-01–AI-10, BILL-01, BILL-04–05 | Проведён аудит существующих AI gateway/provider adapters, subscription tables и usage records; зафиксирована целевая архитектура ключей, модели, entitlement, ledger, платежей и provider top-up. | Commit `eb4d276`; документ спецификации добавлен. Реализация backend/UI ещё не начата. IN_PROGRESS |


### Provider registry — первый backend этап

- Добавлена миграция `019_ai_provider_credentials.sql` для серверных зашифрованных ключей провайдеров.
- Добавлен `apps/api/ai/providerRegistry.ts`: загрузка сохранённых ключей из PostgreSQL, AES-256-GCM, сохранение/ротация и запись аудита, маскированный список статусов, проверка доступности провайдера.
- AI Gateway получил универсальную установку и проверку runtime credentials.
- Административные endpoints: `GET /api/admin/ai/providers`, `PUT /api/admin/ai/providers/:providerId/credential`, `POST /api/admin/ai/providers/:providerId/verify`.
- RBAC: `ai.read` доступен Super Admin/Admin/Developer/Auditor; `ai.manage` — только Super Admin. Изменение ключей и проверка требуют свежий MFA step-up.
- В Admin Control Center добавлен раздел «AI и модели» с конфигурационным статусом, сохранением нового ключа и проверкой. Сам ключ не возвращается API.
- Добавлена переменная окружения `AI_PROVIDER_ENCRYPTION_KEY` (отдельный секрет минимум 32 символа). Её реальное значение не создавалось и не публиковалось.
- Поддерживаются постоянные платформенные ключи для OpenAI, Anthropic, OpenRouter, OrcaRouter и AnyModel. Ollama не требует API key и пока остаётся отдельной локальной конфигурацией.
- Важно: migration 019 не применялась к production; Admin API в production остаётся закрытым. Перед запуском необходимо задать encryption key в серверном secret store и выполнить контролируемое применение миграции.
- CI для commit `6983425` запущен (workflow `45700399162`), результат ещё не получен. Не считать реализацию проверенной до завершения API tests/typecheck/Web build/E2E.


### AI-совместимость — контракт провайдеров

- Добавлен документ `docs/KVARD_AI_PROVIDER_ADAPTER_CONTRACT.md`: единый canonical request/response, протокольные adapters, model-level capabilities, usage normalization, error taxonomy, retry/fallback rules, credential redaction и conformance test suite.
- Аудит выявил ограничение текущей архитектуры: существующий `AIProvider.generate(message)` — текстовый legacy-интерфейс; capabilities нескольких адаптеров статически выставлены в false для vision/tools/streaming/structured output/reasoning. Нельзя считать эти функции поддержанными без отдельной реализации.
- Целевой принцип: новый провайдер добавляется отдельным адаптером и не требует изменений продуктовых модулей КВАРД. Протоколы провайдеров остаются разными; единым является внутренний контракт КВАРД.
- Следующий engineering этап: canonical request/response types + legacy bridge, затем conformance tests и перевод одного адаптера за раз. Только после этого строить model entitlements и usage billing на каноническом формате.
- Production rollout, реальные запросы с платными ключами и provider billing не выполнялись.

| 2026-11-25 | AI-ADAPTER-01–08 | Специфицирован стандарт совместимости провайдеров и правила допуска нового адаптера. Зафиксирован gap между текущим string-only generate и необходимым контрактом для мультимодальности, tools, streaming и достоверного usage. | Документ `docs/KVARD_AI_PROVIDER_ADAPTER_CONTRACT.md`, commit `da5e510`. Статус: спецификация готова, кодовая миграция и conformance suite ещё не начаты. IN_PROGRESS |


## 2026-11-26 — Canonical AI Provider Contract: implementation foundation

- Статус AI-ADAPTER-01–08: **PARTIAL / foundation implemented**. Создана рабочая внутренняя граница совместимости, но не заявляется полная нативная поддержка функций каждым внешним провайдером.
- `apps/api/ai/types.ts`: versioned canonical request/response types, content parts, image URL/base64, tool definitions/tool choice, assistant tool-call history, usage categories and usage source.
- `apps/api/ai/canonical.ts`: runtime validation, size/type limits, HTTP(S)-only image URLs, MIME/base64 checks, tool-call validation, capability requirements and response/usage normalization.
- `apps/api/ai/legacyProviderAdapter.ts`: strict bridge for existing `generate(string)` providers. It preserves message order/roles and explicitly rejects image content, developer/tool roles, assistant tool-call history, tools, streaming, JSON/structured output and unsupported options before provider invocation.
- `apps/api/ai/gateway.ts`: added `AIGateway.generateRequest()`. Native adapters are preferred; otherwise the strict legacy bridge is used. Model-level capabilities are checked before dispatch. Existing string methods and fallback semantics remain unchanged.
- Usage is never fabricated: missing usage = `unavailable`; partial provider usage remains partial. Provider identity is normalized, actual returned model ID is preserved, and bearer/API-key-like strings are redacted from normalized provider error details.
- Added tests: `canonical.test.ts`, `legacyProviderAdapter.test.ts`, `gateway.canonical.test.ts`, `providerConformance.test.ts`. Conformance tests cover identity/content mapping, partial/missing usage, unsupported capabilities, aborted requests and credential redaction.
- Added isolated workflow `.github/workflows/ai-provider-contract.yml` so provider-contract API tests/typecheck can run independently from browser E2E.
- Dedicated workflow `45705059762` passed on commit `9f4e9992c017a94409834c8f238926cbe09fceab`: API typecheck + full API test suite. This run predates only documentation/checklist updates.
- Full CI run `45704112563`: build job passed (API typecheck/tests, Web brand/runtime tests, Web typecheck/build/lint, Docker build and container smoke test). Runtime E2E had 40 passed, 1 failed, 3 skipped; failure was an existing Runtime ownership release assertion after user cancellation (`runtimeData.resources` expected 0, received 1). Do not mark full CI green; investigate this Runtime E2E failure in its own task.
- Pending work: native provider-specific adapters and their real protocol mappings; per-model capability/pricing catalogs; migrate chat/Builder/agent/Runtime/Workforce call paths; sandbox smoke tests; usage ledger/reservations; plans and payments.
- No production deploy, production migrations, provider purchases/top-ups, real provider credentials or real paid requests were performed.

| Date | Checklist area | Result | Evidence |
|---|---|---|---|
| 2026-11-26 | AI-ADAPTER-01–08 | Canonical contract, validation, strict legacy bridge, gateway routing, usage normalization and conformance fixture tests implemented. Native adapters for real providers and product-call migration remain pending. | Dedicated workflow `45705059762` passed on `9f4e999`; commits include `1994066`, `46326d4`, `1be20a3`, `c75c394`, `b198745`, `bed827d`, `eedb792`, `9f4e999`. PARTIAL. |
| 2026-11-26 | CI-BASELINE | Build job passed; Runtime E2E remains red on a cancellation/resource-release assertion unrelated to provider-contract tests. | Workflow `45704112563`; 40 passed, 1 failed, 3 skipped in E2E. Full CI not green. |


### AI Provider Contract — follow-up hardening

- Canonical assistant messages теперь поддерживают tool-call history, включая assistant tool-call-only messages без текстового content. Для них требуется `toolCalling`; legacy bridge отклоняет их до обращения к provider.
- Usage валидируется как неотрицательное целое число. Отсутствующий, malformed или противоречивый usage не маркируется как provider-reported и не превращается в нули; источник становится `unavailable`. Estimated usage остаётся явно estimated.
- Credential redaction применяется также к `userSafeMessage` и `technicalDetails` уже типизированных `NexumError`, а не только к обычным Error от provider.
- Dedicated workflow `45705690934` завершился успешно на commit `53e0be5392fce43a3b623623ab63aa32022d9891`: API typecheck прошёл, 241/241 API tests прошли, 0 failures.
- Это подтверждает contract foundation и test suite. Нативные реализации протоколов для реальных поставщиков, продуктовая миграция и sandbox checks остаются pending.
