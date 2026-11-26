# NEXUM.DEV — статус проекта и план работ

**Назначение документа:** единая точка передачи контекста между разными ИИ-агентами. Обновляйте его после каждого блока разработки. Этот файл не заменяет проверку кода.

**Последнее документальное обновление:** 2026-10-11  
**Состояние проверки при создании документа:** README был минимальным; статус подготовлен по известной истории Git и разработки. Полный свежий аудит кода, тестов и CI в рамках этого изменения не выполнялся. Поэтому пункты, не подтверждённые актуальным запуском, имеют статус NEEDS_RECHECK или PARTIAL, а не DONE.


## Последняя проверка кода и CI

**Проверенный main HEAD:** `88da393937caa970f49a510351d05c3e6d4304ee` — merge PR #35 от 2026-10-11.  
**CI:** [run #2267](https://github.com/borzenkoofficial-lab/nexum-dev/actions/runs/38151338255) — итог `success`; jobs `build` и `e2e` прошли.

Подтверждено в актуальном `main`:
- агентское выполнение команд направлено через Docker Sandbox;
- внутренние diagnostics/runtime endpoints защищены middleware;
- исправления жизненного цикла ChatJob, отмены и согласованной публикации завершения включены;
- API/Web зависимости устанавливаются через `npm ci`, E2E workflow заранее загружает образ `node:22-bookworm-slim`;
- в текущем Git tree не осталось отслеживаемых путей `node_modules/`;
- AnyModel provider присутствует в коде, но live-запрос к провайдеру не проверялся.

**Снятый блокер тестирования:** старый E2E прогон [#2266](https://github.com/borzenkoofficial-lab/nexum-dev/actions/runs/38147453731), выполненный до слияния PR #35, не дождался события `TOOL_CHECKPOINT/consumed` в сценарии повторной отмены. После merge на актуальном main полный CI прошёл, включая E2E. Проверка документационной PR-ветки также прошла: [run #2269](https://github.com/borzenkoofficial-lab/nexum-dev/actions/runs/38152031395).

**Текущий статус CI: GREEN на указанном commit. Публичный релиз: NOT READY** до отдельной проверки production-конфигурации базы и секретов, Docker runtime smoke test, проверки route-by-route rate-limit coverage, runtime diagnostics retention, Docker image smoke test и реального подключения AnyModel. Локальный запуск в чистой среде и production deployment в этой проверке не выполнялись.

Основной документ с полной историей находок, их актуальными статусами и оставшимися рисками: [docs/AUDIT_REPORT_2026-10-11.md](./AUDIT_REPORT_2026-10-11.md). Дополнительная фиксация CI и P0 до исправления: [docs/AUDIT_2026-10-11.md](./AUDIT_2026-10-11.md).

## 1. Правила оценки готовности

- **DONE** — реализация подтверждена в текущем коде, критерии приёмки проверены, необходимые тесты прошли.
- **PARTIAL** — часть поведения существует, но есть недоделки или не все сценарии проверены.
- **IN_PROGRESS** — работа ведётся, готового результата пока нет.
- **TODO** — задача ещё не реализована или не проверена.
- **BLOCKED** — указан конкретный внешний блокер.
- **NEEDS_RECHECK** — реализация упоминалась в истории, но требует проверки на текущем HEAD или после последующих изменений.

Не ставить DONE без доказательств. Для каждого перехода в DONE записывать команды, результат и, если доступно, ссылку на CI/PR/commit.

## 2. Краткая картина продукта

NEXUM.DEV — браузерная платформа для создания и развития цифровых продуктов через ИИ-агента. Основной продуктовый риск — не генерация кода как таковая, а способность агента корректно менять реальный проект, проверять результат и не заявлять об успехе без доказательств.

Целевой цикл: задача → сбор контекста → план → выполнение инструментами → наблюдение → валидация → ограниченное исправление → подтверждённое завершение либо честный статус ошибки.

## 3. Компоненты, известные из истории разработки

Все пункты этого раздела требуют актуальной проверки перед тем, как считать их готовыми.

| Компонент | Что известно | Статус |
|---|---|---|
| Веб-приложение | Основная область кода находится в apps/web | NEEDS_RECHECK |
| API | Основная серверная область находится в apps/api | NEEDS_RECHECK |
| Цикл ИИ-агента | Упоминался apps/api/agent/loop.ts | NEEDS_RECHECK |
| Хранение состояния задач/чата | Упоминался chatJobStore | NEEDS_RECHECK |
| Интеграция с моделями | Архитектура включает AIGateway → Provider → model | NEEDS_RECHECK |
| Жизненный цикл задач | Прорабатывались состояния очереди, планирования, выполнения, проверки, завершения, ошибки и отмены | NEEDS_RECHECK |
| Создание пустого проекта | Изменения для scaffold и повторного исследования структуры были добавлены в PR/commit #31 | NEEDS_RECHECK |
| Builder Acceptance Gate | Добавлялись тесты приёмки Builder в PR/commit #31 | NEEDS_RECHECK |
| Повторная валидация после изменения | Изменения отражены в коммите cceea0a от 2026-10-05 | NEEDS_RECHECK |
| Проверка preview | Исторически исправлялась зависимость состояния preview от успешной сборки; был указан успешный CI для соответствующего изменения | NEEDS_RECHECK |
| Автоматические тесты и CI | GitHub Actions использовался для проверок; актуальный статус не снимался при создании документа | NEEDS_RECHECK |
| Пользовательский путь от запроса до работающего приложения | Не подтверждён свежим сквозным прогоном | PARTIAL |

Исторические ссылки:
- Commit cceea0a — revalidate Builder after every change: https://github.com/borzenkoofficial-lab/nexum-dev/commit/cceea0a12737db7e903a96f91d6cbe857a9a3081
- Commit a439428 — full Builder acceptance gate / recovery for empty builders: https://github.com/borzenkoofficial-lab/nexum-dev/commit/a439428c1f7d287608cb387d687de205996a92d3
- Commit 44349e3 — preview state follows successful builds: https://github.com/borzenkoofficial-lab/nexum-dev/commit/44349e39b20dbf2a1e39d2edd73b16c968f24b

Исторические коммиты не доказывают текущее состояние ветки или то, что все проверки сейчас проходят.

## 4. Приоритетный план работ

### P0 — получить актуальную картину репозитория

**Статус: TODO**

- [ ] Проверить актуальный HEAD, активную ветку и рабочее дерево.
- [ ] Просмотреть структуру репозитория и ключевые файлы.
- [ ] Найти package.json и lock-файлы; определить реальные команды установки, тестов, lint, typecheck и build.
- [ ] Просмотреть все CI workflow и последние запуски.
- [ ] Запустить базовые проверки и зафиксировать исходные ошибки до исправлений.
- [ ] Сопоставить существующие документы с реальным кодом.
- [ ] Обновить таблицу компонентов и статусы в этом файле.

**Критерий приёмки:** есть проверяемый отчёт о текущем состоянии, реальные команды и результаты, список воспроизводимых дефектов. Не путать «проверено» с «всё прошло».

### P0 — надёжный цикл ИИ-агента

**Статус: NEEDS_RECHECK**

- [ ] Проверить передачу задачи от API к агентскому циклу.
- [ ] Проверить сбор контекста и чтение файлов до изменения существующего проекта.
- [ ] Проверить корректное создание scaffold для пустого проекта.
- [ ] Проверить, что после scaffold агент повторно исследует структуру проекта.
- [ ] Проверить валидацию плана и соответствие действий исходной задаче.
- [ ] Проверить корректную обработку ошибок инструментов и модели.
- [ ] Проверить защиту от циклов, повторяющихся действий и бесконечных попыток.
- [ ] Проверить отмену, тайм-ауты, восстановление и повторное выполнение задач.
- [ ] Убедиться, что состояние задачи не зависает между RUNNING, VALIDATING, COMPLETED и FAILED.

**Критерий приёмки:** автоматические тесты покрывают нормальный сценарий, ошибки, отмену и повторяющиеся действия; нет ложного завершения или бесконечного цикла.

### P0 — Completion Gate и доказательства результата

**Статус: NEEDS_RECHECK**

- [ ] Найти текущую реализацию Completion Gate и описать условия успешного завершения.
- [ ] Проверить, что ответ модели сам по себе не считается доказательством.
- [ ] Проверить, что после изменения Builder запускается подходящая повторная проверка.
- [ ] Проверить отслеживание фактических изменений файлов.
- [ ] Проверить, что неудачная проверка не превращается в статус успеха.
- [ ] Проверить, что исправления ограничены и после них проверки повторяются.
- [ ] Добавить регрессионные тесты для ложного успеха.

**Критерий приёмки:** задача может получить статус COMPLETED только при наличии предусмотренных доказательств; при отсутствии доказательств результат остаётся непроверенным или неуспешным. Не ослаблять gate ради прохождения тестов.

### P0 — сборка приложения и preview

**Статус: NEEDS_RECHECK**

- [ ] Проверить, как создаётся и запускается пользовательский проект.
- [ ] Проверить сборку на реальном сценарии.
- [ ] Проверить, что preview отражает результат актуальной успешной сборки.
- [ ] Проверить обработку отсутствующего build-артефакта, ошибки запуска и неудачной сборки.
- [ ] Проверить повторный запуск preview после изменения файлов.
- [ ] Проверить, что UI не показывает старый или несуществующий результат как актуальный.

**Критерий приёмки:** успешное состояние preview основано на фактическом результате; сбой явно отображается и может быть диагностирован.

### P1 — хранение и жизненный цикл задач

**Статус: TODO / NEEDS_RECHECK после аудита**

- [ ] Найти фактическое хранилище задач и сообщений.
- [ ] Проверить сохранение статуса при перезапуске API.
- [ ] Проверить отсутствие конфликтов при параллельных запросах.
- [ ] Проверить повторную доставку/повторный запуск и защиту от дублирования действий.
- [ ] Проверить корректное завершение отменённых и упавших задач.
- [ ] Проверить, что UI получает актуальное состояние задачи.

**Критерий приёмки:** статус задачи согласован между API, хранилищем и интерфейсом и корректно восстанавливается в предусмотренных сценариях.

### P1 — подключение ИИ-провайдеров

**Статус: NEEDS_RECHECK**

- [ ] Найти реальный механизм конфигурации провайдеров и моделей.
- [ ] Проверить валидацию URL, модели и формата совместимого API.
- [ ] Проверить ошибки авторизации, rate limit, тайм-ауты и недоступность провайдера.
- [ ] Проверить безопасную передачу ключей и отсутствие утечек в логи.
- [ ] Проверить понятный статус подключения и сообщения об ошибках.
- [ ] Проверить, что сбой одного провайдера не приводит к ложному успеху задачи.

**Критерий приёмки:** успешное подключение подтверждается реальным тестовым запросом; секреты не показываются пользователю повторно и не попадают в логи.

### P1 — интерфейс и основной пользовательский путь

**Статус: NEEDS_RECHECK**

- [ ] Проверить создание проекта.
- [ ] Проверить отправку задачи агенту и отображение прогресса.
- [ ] Проверить просмотр результата и ошибок.
- [ ] Проверить продолжение работы с существующим проектом.
- [ ] Проверить адаптивность и отсутствие критических ошибок интерфейса.
- [ ] Проверить, что пользователь может понять, выполнена задача или нет.

**Критерий приёмки:** новый пользователь может пройти основной сценарий без ручного редактирования внутренних файлов конфигурации; все ошибки имеют понятное объяснение.

### P1 — база данных, конфигурация и безопасность

**Статус: TODO / NEEDS_RECHECK после аудита**

- [ ] Проверить реальные требования к переменным окружения.
- [ ] Проверить работу приложения при отсутствующей обязательной конфигурации.
- [ ] Проверить миграции и доступность базы данных, если она используется.
- [ ] Проверить авторизацию и разграничение доступа к проектам.
- [ ] Проверить защиту пользовательских данных, API-ключей и логов.
- [ ] Проверить лимиты ресурсов и защиту от чрезмерных расходов на вызовы ИИ.
- [ ] Проверить инструкции развёртывания на чистом окружении.

**Критерий приёмки:** обязательная конфигурация задокументирована, отсутствие критической настройки выявляется явно, пользовательские данные и секреты защищены.

### P2 — подготовка к публичному запуску

**Статус: TODO**

- [ ] Сформировать воспроизводимый процесс развёртывания.
- [ ] Проверить health checks, логи и диагностику.
- [ ] Проверить восстановление после перезапуска и сбоя.
- [ ] Провести сквозные тесты ключевых пользовательских сценариев.
- [ ] Определить ограничения по времени, размеру проекта и расходам.
- [ ] Подготовить пользовательскую документацию и описание известных ограничений.
- [ ] Выполнить финальный аудит безопасности и CI.

**Критерий приёмки:** развёртывание и основные сценарии подтверждены на целевом окружении; известные дефекты и ограничения перечислены открыто.

## 5. Обязательные сквозные сценарии

Добавьте или найдите автоматические тесты для следующих случаев:

1. **Пустой проект:** пользователь ставит задачу, агент создаёт основу проекта, повторно исследует файлы, вносит изменения, запускает проверки и подтверждает результат.
2. **Существующий проект:** агент сначала изучает структуру и нужные файлы, затем меняет только необходимое и проверяет результат.
3. **Ошибка сборки:** приложение не помечается готовым; ошибка доступна для диагностики.
4. **Нет подтверждения результата:** Completion Gate не разрешает ложное завершение.
5. **Повторяющееся действие:** цикл обнаруживается и безопасно останавливается.
6. **Ошибка провайдера:** пользователь получает корректное сообщение, задача не зависает.
7. **Отмена задачи:** задача прекращает работу и получает корректный финальный статус.
8. **Перезапуск API:** состояние незавершённой задачи обрабатывается предсказуемо.
9. **Preview после изменения:** отображается актуальный результат, а не старый успешный экран.
10. **Секреты:** API-ключи не попадают в клиентский код, репозиторий и логи.

Для каждого сценария фиксировать тестовый файл, команду запуска и фактический результат.

## 6. Последний прогон проверок

При создании документа свежие команды тестирования, сборки и CI не запускались. Не заполняйте этот раздел предположениями.

После каждого прогона записывайте:

- Дата и время:
- Ветка и commit:
- Изменённые области:
- Команда:
- Результат: PASS / FAIL / NOT RUN
- Краткий вывод:
- Ссылка на CI или лог:
- Известные ограничения:

## 7. Журнал обновлений

| Дата | Изменение документации | Подтверждение |
|---|---|---|
| 2026-10-11 | Создан первичный статус проекта и порядок передачи задач между ИИ-агентами | README, AGENTS.md и этот документ добавлены в ветку документации; полный технический аудит ещё требуется |

## 8. Следующий конкретный шаг

Начать с P0-аудита актуального репозитория: проверить дерево файлов, ключевые модули агента, команды package scripts, тесты и последние CI. После аудита заменить предварительные NEEDS_RECHECK на точные статусы и добавить подтверждения.

Не начинайте массовую реализацию новых функций, пока не установлено, какие дефекты существуют на текущем HEAD и какие из них блокируют основной цикл создания и проверки проекта.


## Main-only development update (2026-11-25)

- Working policy: `main` is the only development branch. See [DEVELOPMENT_POLICY.md](./DEVELOPMENT_POLICY.md).
- Direct main commit `07e6ef4`: block premature AI planner completion unless prior successful tool evidence exists; when blocked, route to deterministic next action or the normal `listFiles(.)` tool path.
- Direct main commit `d61b7e7`: add regression tests for premature completion, successful execution evidence, and end-to-end runtime recovery.
- Direct main commit `08db9ba`: document the main-only workflow and migration/verification rules.
- Verification status: GitHub reports no workflow runs yet for these commits. The only observed combined status is a Vercel check failure caused by the configured daily preview build-rate limit. Typecheck, API tests, full CI and live Builder E2E are therefore **NOT YET VERIFIED** for these commits.
- Existing PRs #56, #61, #68 and other legacy PRs remain historical sources pending careful transplant. PR #56/#68 share conflicting migration numbering and files with the current main schema; do not merge wholesale or overwrite current main files.
- Branch deletion is not yet performed. First compare each legacy branch's unique commits and content against main; delete only after all useful work is safely present in main.


## КВАРД — глобальный редизайн (2026-11-25)

- Добавлен единый рабочий план: [docs/KVARD_GLOBAL_DESIGN_PLAN.md](./KVARD_GLOBAL_DESIGN_PLAN.md).
- Зафиксировано направление Balanced Premium Technology: светлая нейтральная тема по умолчанию, полноценная тёмная тема, функциональный фиолетовый акцент, градиент только в брендинге.
- План включает инвентаризацию всех основных поверхностей: onboarding/auth, рабочий стол, проекты, Studio/Builder, AI Agents, Business Agents, интеграции, диагностика, журнал, настройки, общие компоненты, адаптивность и доступность.
- Порядок: аудит текущих маршрутов и состояний → дизайн-фундамент → основные сценарии → остальные разделы → визуальная и функциональная регрессия.
- Документальный commit: `02fc73c` — `docs(kvard): add global design redesign plan and checklist`.
- Статус на момент создания плана: **PLAN RECORDED / IMPLEMENTATION NOT STARTED**; актуальный прогресс см. ниже.
- Проверки приложения для этого документационного изменения не запускались; визуальная проверка маршрутов и скриншоты ещё не выполнены.
- Следующий шаг: route-by-route аудит `apps/web/src`, проверка прямых URL и состояний, сбор исходных скриншотов и уточнение макетов перед массовыми UI-изменениями.


## КВАРД — реализация простой общей оболочки (2026-11-25)

- Пользовательское направление уточнено: сохранить привычный интерфейс приложения, сделать его простым и логичным; не использовать декоративную AI-эстетику.
- Добавлена единая навигация на уровне `App`: Обзор, AI-агенты, Бизнес-агенты, Интеграции, Диагностика, Журнал, Настройки.
- Главная страница больше не содержит второй боковой навигации; удалены повторяющиеся настройки и декоративные подписи.
- Обычные разделы больше не обёрнуты в фальшивые окна ОС. `OSAppWindow` — нейтральная семантическая оболочка.
- Studio встроена в общий layout, перестала перекрывать sidebar; адаптивная навигация видима на мобильных и планшетных ширинах.
- Маршруты и бизнес-логику не меняли; глобальная командная палитра остаётся доступна через Ctrl/Cmd+K.
- Визуально проверены скриншоты на 320, 390, 768 и 1440 px, включая Studio 390 px.
- CI workflow [45661043216](https://github.com/borzenkoofficial-lab/nexum-dev/actions/runs/45661043216) — **SUCCESS**: API/Web typecheck, API/Web tests, web lint, API/Web build, production Docker image и smoke test.
- Playwright E2E: **40 passed, 3 skipped**. В том числе навигация по всем семи разделам и наличие общей навигации внутри Studio.
- Статус редизайна: **SHELL FOUNDATION VERIFIED / PAGE-BY-PAGE POLISH IN PROGRESS**.
- Следующий шаг: продолжить упрощение главной страницы и провести отдельный визуальный аудит AI Agents, Business Agents, Integrations, Diagnostics, Journal и Settings. Детальная проверка light/dark и accessibility ещё не завершена.


## КВАРД — Admin Control Center security foundation (2026-11-25)

- В `apps/api/db/migrations/012_admin_rbac.sql` добавлены таблицы назначений административных ролей и append-only audit log.
- В `apps/api/adminAccess.ts` добавлены default-deny RBAC middleware, роли Super Admin/Admin/Support/Finance/Developer/Auditor и permission map.
- Первый Super Admin задаётся только через серверный `KVARD_SUPER_ADMIN_USER_IDS` (UUID существующего аккаунта). Email allowlist не используется: текущая регистрация не подтверждает владение email.
- API `/api/admin/*` смонтирован с обычной аутентификацией, rate limit и RBAC. Добавлены `/me` и временный `/overview` без фиктивных метрик.
- Production-доступ намеренно закрыт кодом до появления MFA. Не добавлять bootstrap UUID в production до реализации MFA и её проверки.
- Добавлены unit tests для UUID bootstrap и permission boundaries; они включены в API test script. CI ещё должен подтвердить typecheck/tests/build.
- Миграция добавлена в репозиторий, но к production БД не применялась. UI `/admin`, MFA, полный audit writer, управление ролями, CSRF/session hardening и API integration tests остаются незавершёнными.
- Главный чек-лист: `docs/KVARD_ADMIN_PANEL_CHECKLIST.md`.




## КВАРД — AI streaming transport, parser и Builder final answer (2026-11-26)

**Статус: VERIFIED — provider transport, browser parser и user-visible final-answer streaming реализованы. Более широкий token streaming для внутренних planner/coder ходов намеренно не включён.**

- Защищённый `POST /api/ai/stream` смонтирован за существующими `authMiddleware` и `aiWriteLimiter`; handler изолирован в `apps/api/ai/streamRoute.ts` и делегирует только per-user `AIGateway`.
- Handler валидирует canonical AIRequest, собирает поля по allowlist, назначает серверные identity metadata и request ID; SSE передаётся без proxy buffering с backpressure и AbortSignal при disconnect.
- HTTP integration tests проверяют отсутствие пользователя, canonical validation, server-owned metadata, SSE headers/event order, безопасную ошибку после headers и upstream abort на disconnect.
- Browser consumer `apps/web/src/runtime/AIStream.ts` реализует инкрементальный SSE parser: UTF-8 chunk splitting, CRLF, comments, multi-line data, final frame flush, 2 MiB frame limit, schema validation и обязательный terminal event. 10 parser tests включены в NEXUM CI.
- `GatewayGenerateOptions.onTextDelta` теперь запускает native provider streaming только если capability модели явно подтверждена; Gateway агрегирует дельты в прежний response string. Для неподдерживаемых моделей сохраняется non-stream fallback с одним полным delta.
- После первой видимой дельты Gateway не переключается молча на fallback provider: частичный ответ не смешивается с ответом другой модели.
- `AgentLoop` передаёт callback только финализатору. Planner JSON и внутренние tool-call payloads не показываются в чате; явный finalResponse от planner публикуется только после Completion Gate.
- `runChatJob` дописывает deltas в `ChatJob.reply`, сохраняет изменения с throttling 350 ms и делает финальный flush до завершения/ошибки/отмены.
- Web Builder upsert-ит стабильное assistant message по ChatJob ID. Теперь обновления ChatJob приходят через отдельный авторизованный SSE stream; polling браузера каждые 900 ms убран.
- Для задач разработки внутренние операции остаются в AI Activity/progress events. Финальное детерминированное резюме после Completion Gate появляется после завершения работы; внутренний planner/coder token stream намеренно не раскрывается.
- Полный [NEXUM CI #45720403975](https://github.com/borzenkoofficial-lab/nexum-dev/actions/runs/45720403975) на commit `c1d861ba3b7e9613b6a2badbca78f526e34c6606` — **SUCCESS**: API tests 317/317, Web brand/UI kit tests 8/8, Web runtime tests 5/5, AI stream parser 10/10, API/Web typecheck, API/Web builds, Web lint, production Docker image build, container smoke test и Runtime Phase 2.5 E2E.
- Отдельный [КВАРД AI Provider Contract #45719682728](https://github.com/borzenkoofficial-lab/nexum-dev/actions/runs/45719682728) — **SUCCESS**; gateway streaming callback tests included.
- Vercel commit status сообщает `build-rate-limit`; это отдельное ограничение сборок Vercel. GitHub CI production container smoke test прошёл, но Vercel deployment не выполнялся.
- Live provider requests, production secrets, production migrations и deployment не использовались.

**Оставшиеся улучшения (не блокируют текущую реализацию):**
1. Добавить отдельную SSE подписку на ChatJob, если polling 900 ms станет недостаточно быстрым; сохранить текущий polling как fallback.
2. Добавить observability для первого token latency, stream duration, aborts и terminal event integrity без записи содержимого пользовательских промптов.
3. Продумать безопасное потоковое отображение структурированных coder/reviewer результатов только если появится отдельный пользовательский UX; не раскрывать planner JSON и tool arguments.

**Следующий этап:** проверить потоковое поведение на реальных провайдерах только после отдельного согласования тестовых credentials/лимитов; затем можно улучшить latency ChatJob updates и добавить метрики. До такого согласования live/paid provider calls не выполнять.
## КВАРД — ChatJob SSE updates (2026-11-26)

**Статус: IMPLEMENTED — подтверждение CI ожидается на последнем коммите.** Browser polling заменён на server-sent events для ChatJob состояния.

- Новый модуль `apps/api/chatJobEvents.ts`: авторизованный SSE handler, owner-check, initial snapshot, snapshots при изменении persisted job, heartbeat, retry directive, безопасный terminal/unavailable, abort при disconnect и backpressure.
- Endpoint `GET /api/chat/jobs/:id/events` смонтирован за существующим auth middleware и chat rate limiter; GET snapshot остаётся recovery fallback и используется при восстановлении EventSource.
- Browser Builder теперь слушает native EventSource. Автоматический reconnect, one-shot snapshot при reconnect errors, закрытие на terminal statuses; completion продолжает ждать Preview readiness.
- Server-side poll к ChatJob store/cache 500 ms (только сервер), browser polling 900 ms удалён. Stream coalesces snapshots, не обещает durable event-log replay; при reconnect отправляется актуальный snapshot.
- Tests: unauthorized/missing ownership (404), malformed ID (400), initial terminal snapshot, changed queued/running/completed snapshots, disconnect cleanup, and response backpressure. Included in API test script.
- Полный [NEXUM CI #45740728242](https://github.com/borzenkoofficial-lab/nexum-dev/actions/runs/45740728242) на commit `cae93f6abd64f0ab433f8f6ddb0209ca188af6851` — **SUCCESS**: API tests 323/323 (включая 5 ChatJob SSE tests), Web tests 4/4 + 4/4, runtime 5/5, AI SSE parser 10/10, API/Web typecheck, API/Web builds, Web lint, production Docker image, container smoke test и Runtime Phase 2.5 E2E. Earlier attempts exposed and fixed compile issues (SSE error payload escaping and Express route param narrowing); failures are not counted as success.
- Live/paid provider requests, production secrets, database migrations, deployment and Vercel actions were not used.

**Следующий технический этап:** дождаться полного NEXUM CI/E2E, устранить обнаруженные дефекты, затем измерить event latency и проверить reconnect/refresh сценарии. Не выполнять live provider calls без согласования credentials/limits.



## ChatJob SSE observability — 2026-11-26

- Added structured, payload-free stream delivery metrics: stream duration, snapshot count, changed snapshot count, initial snapshot latency, first changed snapshot latency, average interval between snapshots, and close reason (`terminal`, `client_disconnect`, `job_unavailable`, `poll_error`). No job IDs, user IDs, message text, prompts, or provider data are included in these metric logs.
- Added regression test confirming a new/reconnected SSE session begins from the latest stored snapshot (no durable replay of intermediate states is claimed).
- Changes are on `main`; validation is pending CI. No production deployment, migration, paid AI request, or secret change.


## Builder active-job reload recovery test — 2026-11-26

- Added Playwright E2E scenario to hold a ChatJob at a deterministic planner checkpoint, reload Builder while the job remains active, verify restored active job/cancel affordance and API status, then cancel and verify terminal state.
- E2E validation is pending CI. This specifically tests browser reload + active task restoration, not offline reconnect timing or recovery of already-terminal jobs. No production deploy or paid provider call.

## Active ChatJob recovery race fix — 2026-11-26

- Recovery now waits for project-list loading to finish before selecting a queued/running job for the current project. This prevents a transient initial project ID from causing the wrong active task to be restored after reload.
- Effect dependencies include project-loading state so recovery retries after projects resolve. No deployment or paid provider requests.


## ChatJob recovery metadata contract — 2026-11-26

- Fixed `GET /api/chat/jobs` to return the project ID and current stage/message metadata required by Builder reload recovery. Previously the route returned raw jobs, but this was subsequently changed to a reduced list that omitted `projectId`; the frontend therefore treated every active job as eligible for the current project and could restore a job belonging to another project.
- The list response is now an explicit minimal projection (`id`, `projectId`, `status`, `stage`, `currentMessage`, `updatedAt`); no provider credentials or full job payload are exposed.
- Extended the active-job reload E2E to assert the list endpoint preserves the correct project association and stage before reload. CI validation pending.


## Builder terminal ChatJob restoration — 2026-11-26

- Added authenticated `GET /api/chat/jobs/recent` returning up to 20 recent terminal jobs for the current user, scoped to a specific project by the client. The response is a minimal projection containing the completed reply, execution steps/events, problems, error and product plan; no credentials or internal provider secrets are exposed.
- Builder reload recovery now restores the latest terminal job for the active project when no active queued/running job exists, including the assistant reply and execution summary. Active jobs continue to use the SSE endpoint and existing active-job list route.
- Validation pending CI and E2E. No production deployment, migration, secrets or paid AI calls.


## ChatJob SSE reconnect hardening — 2026-11-26

- Builder now exposes a visible recovery state when the EventSource connection errors and a restored state when the stream reopens.
- REST snapshot fallback is single-flight: repeated EventSource errors cannot create overlapping recovery requests. Native EventSource reconnect remains responsible for resuming the stream; the REST request is only a one-shot state reconciliation.
- Extended the active-job reload E2E scenario to take the browser context offline, assert the reconnecting state, restore network access, and assert the stream recovery state before cancelling the job.
- Code and E2E changes are on `main`; CI/E2E execution is not yet confirmed. The only visible commit status is the Vercel build-rate-limit failure. No production deployment, migrations, secrets or paid AI calls.


## Builder multi-tab ChatJob synchronization — 2026-11-26

- Added best-effort BroadcastChannel notification for terminal ChatJob transitions. A tab with the same active job receives the notification, then fetches the authenticated REST snapshot; it never trusts cross-tab message contents as authoritative state.
- User cancellation publishes the terminal transition before the initiating tab clears its active-job reference, but only when the server confirms the canonical status is `cancelled`; a race with completion/failure no longer makes the UI report a false cancellation. SSE-observed completion/failure/cancellation also publishes once, with duplicate terminal notifications guarded.
- Builder ignores out-of-order snapshots with an older `updatedAt` value, preventing delayed responses from rolling the visible task state backwards.
- Extended Playwright coverage: open the same project in a second tab, cancel the job in the first tab, and assert the second tab displays the canonical cancellation result. This test remains pending execution in CI.
- Cross-tab messaging is an optimization only. Server-side ChatJob persistence and authenticated REST/SSE remain the source of truth; browsers without BroadcastChannel retain normal SSE/reload recovery.
- Changes are on `main`. No production deployment, migration, secret change, or paid provider request.


## ChatJob concurrency and browser-session recovery — 2026-11-26

- Confirmed that the existing PostgreSQL `agent_project_locks` table is the canonical per-project write lock; no parallel lock mechanism was introduced.
- Added store tests for concurrent lock acquisition, owner-only heartbeat/release, and recovery of orphaned queued/running jobs.
- Extended the Builder E2E scenario to submit a second job against the same project while the first is held at a deterministic checkpoint. The competing job must fail with the existing project-lock conflict, while the first remains active.
- Extended the same E2E scenario to reopen a fresh browser context with the saved authenticated session state and verify that the active job is restored without relying on in-memory Builder state. This simulates a browser session restart with a still-valid login; it does not automate the identity provider's interactive login flow.
- Fixed a cancellation/acquisition race: project lock ownership is recorded immediately after successful acquisition, before checking the abort signal, so the lifecycle cleanup releases the lock even if cancellation arrives at that exact point.
- Lock heartbeat now stops the Agent if the database confirms that the job no longer owns the project lock. The lock-loss abort reason is preserved through nested Agent lifecycle checks and persisted as a failed job with an explicit reason, not misreported as a user cancellation.
- Startup recovery now marks both queued and running jobs as failed when their execution process has restarted, and releases their project locks. This prevents orphaned queued jobs from appearing active indefinitely.
- Browser/session recovery across API process restarts requires PostgreSQL-backed ChatJob persistence. The in-memory fallback is process-local and cannot survive an API restart. Terminal history remains subject to the existing 30-minute cleanup window.
- Current startup stale-job recovery assumes one API execution owner for the ChatJob domain. Before horizontal multi-instance execution, replace global startup recovery with per-worker ownership/lease fencing so one instance cannot mark another live instance's jobs stale.
- Changes are on `main`; tests have been added but their CI execution is not yet confirmed. No production deployment, migration, secret change, or paid provider call.

## Agent Run recovery — conservative restart assessment (2026-11-26)

- Added `apps/api/agent/recovery.ts` with a deterministic recovery classifier based on persisted tool events, completed step records, original job status, and pending approvals.
- Restart recovery now persists `recoveryAssessment` into the ChatJob payload for both the in-memory fallback and PostgreSQL storage.
- Classifications:
  - `safe_to_restart`: only a queued job with no recorded execution activity is eligible for a fresh start. Running jobs are never classified as safe to restart yet, even if their visible events show only READ tools, because AgentLoop persistence callbacks are currently asynchronous and do not prove a durable checkpoint.
  - `inspect_before_retry`: a WRITE/EXECUTE operation may have run, a tool start has no recorded terminal result, or a running job lacks a commit-confirmed checkpoint. Inspect the project/sandbox before retrying.
  - `manual_review_required`: a pending approval was interrupted or tool activity is unrecognized.
- `automaticResumeAllowed` is explicitly `false` for every classification. No automatic replay or provider call is started after recovery.
- Added deterministic tests for read-only activity, write/execute activity, unmatched tool starts, interrupted approvals, unknown tools, legacy step-only evidence, and the fail-closed handling of running jobs without durable checkpoints. Added the recovery test file to the API test script.
- Important implementation finding: the current `AgentLoop.runInternal` keeps critical continuation state in process memory, including `previousResults`, planner-context fingerprints, action-attempt tracking, token budget, and phase-local control flags. Persisted ChatJob snapshots and the execution plan do not contain enough information to continue the exact loop safely. Reconstructing only from the visible steps would risk repeating writes or commands.
- Therefore this change is a safety boundary, not yet durable execution. The next implementation phase must introduce a versioned execution journal/checkpoint written around each tool invocation, stable action IDs, durable tool results, and explicit idempotency/reconciliation policy for side-effecting tools. A checkpoint may only be marked resumable after its required state is durably committed.
- A GitHub Actions run exposed an existing TypeScript listener mismatch in the cancellation bridge; the parent AbortSignal handler now uses a zero-argument wrapper and removes that exact listener. Earlier rapid-push CI runs were cancelled; the consolidated run for the latest commit must still be checked. No production migration, deployment, secret change, or live/paid provider request was performed.

## Durable Agent Execution — tool action journal (2026-11-26)

- Added `agent_chat_job_tool_actions`, an application-managed PostgreSQL table created by the existing ChatJob store bootstrap. This does not require or apply a production migration in this development step.
- Every `AgentLoop` tool invocation in the server ChatJob path now passes through an awaited journal wrapper:
  1. resolve the tool's registered risk policy;
  2. commit a `started` action record before calling the tool;
  3. execute the tool;
  4. commit `succeeded` or `failed` plus a SHA-256 digest of the result before returning control to the AgentLoop.
- If the intent record cannot be committed, the tool is not executed. If the result cannot be finalized, the AgentLoop stops and the journal remains `started`, so recovery treats the outcome as unknown.
- The journal action UUID is also propagated as the AgentStep `toolCallId`, linking the visible execution step to its durable record.
- The journal stores action UUID, job/user scope, tool name, risk class, input digest, lifecycle status, timestamps, result success flag, and result digest. It deliberately does not store raw tool input/output, file contents, prompts, or credentials.
- Restart recovery now consults this journal in addition to best-effort ChatJob events and steps. Unfinished actions are classified as unknown outcomes; completed WRITE/EXECUTE/DESTRUCTIVE actions still require project inspection. All running jobs remain non-resumable until a full durable execution checkpoint exists.
- Added tests for journal ordering, exactly-once finalization, owner scoping, fail-closed behavior, and recovery from missing UI events.
- This is a durable action ledger, **not yet a resumable execution engine**: it does not persist the full planner context or tool result payloads needed to reconstruct `previousResults`, token budgets, action-attempt maps, and phase state. No tool is replayed automatically.
- PostgreSQL is required for cross-process durability. The in-memory fallback is process-local and is only suitable for development.
- No production migration, deployment, secret change, or live/paid provider request was performed. CI and local typecheck/test results must be verified before treating this work as complete.

## Durable Agent Execution — encrypted checkpoint foundation (2026-11-26)

- Added `agent/executionCheckpoint.ts` with a versioned `AgentExecutionCheckpoint` payload. It models the state required for a later restore: phase/iteration, Intent, execution plan, Product Plan, full observed tool results, pending plan, planner/repair counters, adaptive token-budget snapshot, action-attempt and loop-detection state, durable tool action IDs, and a sandbox revision fingerprint.
- Checkpoint payloads use AES-256-GCM with authenticated metadata (`version`, job, user, project, sequence). The key is a dedicated `KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY`, base64-encoded 32-byte value. Missing/malformed keys fail closed; there is no plaintext fallback. Payload size is capped at 2 MiB.
- Added `agent_chat_job_execution_checkpoints` with `(job_id, sequence)` uniqueness, user/project scope, and JSONB envelope storage. Store writes require the ChatJob to belong to the same user/project and remain `running`; reads are owner-scoped and return the latest sequence.
- Added crypto and store tests for encryption round-trip, tampering/metadata substitution, missing keys, ownership, and duplicate sequence rejection. The API test script includes the new crypto tests.
- **This is currently an encrypted checkpoint contract and persistence layer, not yet a live AgentLoop checkpoint writer or restore path.** No code currently emits these snapshots at safe execution boundaries, computes a trusted sandbox revision fingerprint, or resumes from them. Therefore the recovery classifier must continue to deny automatic resume. No action replay is enabled.
- PostgreSQL is required for cross-process checkpoint durability; the memory fallback remains process-local. Production bootstrap/migration has not been run and the new environment key has not been configured.
- CI/local verification is pending. No production deployment, production migration, secret change, or live/paid provider request was performed.
## Durable Agent Execution — safe-boundary checkpoint writer (2026-11-26)

- `AgentLoop` now accepts an optional checkpoint writer and emits a complete state snapshot at the start of each iteration. This boundary is reached only after the previous tool call has returned, its durable action journal has been finalized (or is explicitly marked unknown), the result has been appended to `previousResults`, and the observation/plan state has been updated.
- Snapshots include the execution-state machine and plan, intent, product plan, full tool result history, phase/iteration, model/planner/review/repair counters, adaptive token budget, action deduplication/attempt history, planner-context fingerprints, action sequence, journal action IDs, and verification state (`AgentTaskState`, including changed file paths).
- ChatJob server wiring computes a bounded SHA-256 content fingerprint of the project tree before each checkpoint and persists the encrypted snapshot through `agent_chat_job_execution_checkpoints`. The fingerprint excludes `.git`, `.nexum`, `node_modules`, `dist`, coverage/cache directories, `.env*`, and private-key files; symlinks are skipped. The walk is capped at 5,000 files / 100 MB and aborts if a file changes while being hashed.
- Checkpoint writes are enabled only when PostgreSQL (`NEXUM_DATABASE_URL`) is configured and `KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY` is a valid base64-encoded 32-byte key. Without a key, ordinary Agent execution continues but durable checkpoint writes are disabled. If a configured writer fails during a run, the error propagates and stops that Agent Run rather than silently continuing with an incomplete checkpoint.
- Added tests for project fingerprint content sensitivity/exclusions and for AgentLoop emitting snapshots only at safe iteration boundaries.
- **Automatic restore/resume is still disabled.** The stored state is now sufficient to begin implementing a restore path, but it is not yet rehydrated into a new AgentLoop. A matching fingerprint alone is not sufficient to resume: recovery must also reconcile every durable tool action, approval state, provider/token budget, project ownership and sandbox availability. No WRITE/EXECUTE/DESTRUCTIVE action is replayed.
- No production secret was configured, no production migration/deploy was performed, and no live or paid provider request was made. CI/typecheck/test verification remains pending.