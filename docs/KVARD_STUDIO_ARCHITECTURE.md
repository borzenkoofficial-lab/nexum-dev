# KVARD Studio — архитектура выделения

**Статус:** IN PROGRESS — Studio v1 (отдельный entry и build, same-origin `/studio/`) реализована 2026-11-27; паритет со старым Builder ещё не подтверждён  
**Дата решения:** 2026-11-26  
**Репозиторий:** `borzenkoofficial-lab/nexum-dev`  
**Рабочая ветка:** `main`

## Решение

Выделить KVARD Studio в самостоятельное пользовательское frontend-приложение и отдельный deployment target, сохранив единый backend и общие доменные сервисы KVARD.

Целевая модель:

- **KVARD Platform** — продуктовая оболочка: аккаунт, организации, проекты, агенты, ресурсы, настройки и управление.
- **KVARD Studio** — рабочее пространство разработки: проекты, редактор, дерево файлов, AI-сессия, live preview, терминал/логи, задачи, diff и публикация.
- **KVARD API** — единый backend: авторизация, проекты, Agent Orchestrator, ChatJob, approvals, billing, organizations, sandbox и runtime.
- **Admin** — отдельная привилегированная зона платформы; не смешивать её с пользовательским Studio.

## Что подтверждено в текущем коде

- Веб-клиент сейчас один: `apps/web`, React 19 + Vite.
- Основная точка входа: `apps/web/src/main.tsx`.
- Весь пользовательский workspace находится в крупном `apps/web/src/App.tsx` (около 93 KB на момент аудита); компонент `WorkspaceApp` содержит состояние проектов, Builder, preview, AI, задачи и навигацию.
- `AuthGate` находится в `apps/web/src/auth/AuthGate.tsx` и проверяет сессию через same-origin `/api/auth/me`; login/register также используют относительные `/api` URL и cookie credentials.
- API session cookie в `apps/api/auth.ts`: HttpOnly, Path=/, SameSite=Lax, Secure в production; Domain явно не задан (host-only). MFA challenge cookie ограничена Path=/api/auth/admin-mfa и SameSite=Strict.
- В `apps/api/server.ts` CORS разрешает origin из `NEXUM_CORS_ORIGINS` в production и включает credentials. Это пригодная основа для отдельного Studio origin при явном allowlist и `fetch(..., { credentials: "include" })`; не нужно автоматически расширять cookie Domain.
- Явная CSRF-защита для всех state-changing routes в рамках этого read-only аудита не подтверждена; её покрытие нужно проверить до публичного cross-origin запуска.
- Backend — отдельное приложение `apps/api`.
- Vite dev proxy направляет `/api` на локальный API.
- Текущий Vercel deployment собирает только `apps/web` через root `vercel.json`.
- Следовательно, сейчас Studio **не является отдельным приложением**. Это часть единого SPA. Отделение нельзя сводить к смене заголовка или добавлению ссылки в навигацию.

## Целевая структура репозитория

Начальная цель — отдельные frontend apps в monorepo, без копирования backend:

```
apps/
  api/          # общий backend и доменные сервисы
  web/          # KVARD Platform
  studio/       # KVARD Studio, отдельная Vite app/build
packages/
  contracts/    # общие API-типы и схемы (выделять после инвентаризации)
  client/       # общий типизированный API client (выделять после инвентаризации)
```

Не создавать фиктивные shared packages заранее: сначала определить реальные общие зависимости, затем извлечь их без дублирования и массового рефакторинга.

## Границы ответственности Studio

Studio владеет только UI/UX и клиентским состоянием редакторского workflow. Источником истины остаётся API.

Обязательные пользовательские области:
1. Project switcher и создание/открытие проекта.
2. Файловое дерево и редактор.
3. AI chat / agent activity с потоковыми событиями и состоянием ChatJob.
4. Preview с явными состояниями loading, ready, stale и failed.
5. Terminal/logs и диагностика выполнения.
6. Diff, история изменений и approvals.
7. Run/build/deploy actions с подтверждением результата от backend.
8. Адаптивная оболочка, клавиатурная навигация и доступность.

Studio не должна содержать отдельную копию AgentLoop, ChatJob store, billing logic, project ownership или sandbox orchestration.

## Критические архитектурные условия

### Авторизация и домены

Сейчас AuthGate использует same-origin `/api` и cookie credentials. Поэтому запуск на отдельном поддомене нельзя включать до проектирования и проверки API origin и cookie policy.

Предпочтительный целевой контракт:
- явная конфигурация `VITE_API_BASE_URL` (или runtime config без пересборки образа);
- единая серверная сессия и одинаковые проверки ownership/RBAC;
- корректные `credentials: include`, CORS allowlist и cookie Domain/SameSite/Secure согласно реальному доменному плану;
- CSRF-защита для state-changing запросов;
- никакого хранения access/refresh credentials в localStorage;
- E2E проверки login, refresh/session restore, logout и MFA на обоих frontend origins.

До прохождения этих проверок Studio должна запускаться под отдельным локальным route/origin для интеграционного тестирования, а production subdomain не подключается.

### Разделение сборки и deployment

- Независимый build target и entry point для `apps/studio`.
- Общие версии React/toolchain и lockfile без дублирования зависимостей.
- Отдельные Vercel Preview deployments для проверки; production aliases/domains не переключать автоматически.
- Для Timeweb — отдельный статический frontend service/container или Caddy route, обслуживающий Studio build; API остаётся общим.
- API URL, auth cookie scope, CSP, allowed origins и SPA fallback документируются явно.

## План реализации

### Этап 0 — аудит и архитектурное решение
- [x] Проверить main, текущую структуру web/API, Vite/Vercel конфигурацию и auth entry point.
- [x] Зафиксировать целевую архитектуру и критические условия.
- [x] Сопоставить импорт-граф и выявить переиспользуемые модули: `AuthGate`, `JobChanges`, `ProjectChecks`, UI-кит, `KvardMark`, сетевой runtime — самодостаточны и не зависят от состояния `App.tsx`.
- [x] Проверить backend cookie/CORS/CSRF: cookie host-only `SameSite=Lax`, JSON-only API, CORS allowlist (AUDIT, разделы 8–9). Studio раздаётся same-origin, поэтому кросс-доменных изменений не требуется.

### Этап 1 — безопасное извлечение
- [x] Создать Studio с независимыми `index.html`, `main.tsx`, Vite config и оболочкой — **в `apps/web/studio/`** (см. «Отклонение от плана»), сборка `apps/web/dist-studio`, раздача API по `/studio/`.
- [ ] Извлечь минимальные общие типы/API client в packages только после проверки циклических импортов.
- [ ] Вынести Builder workspace в Studio entry без изменения API-контрактов и поведения ChatJob.
- [x] Текущий `apps/web` и Builder не изменены и не удалены.
- [x] Тесты логики Studio (`studio/src/model.test.ts`: дерево файлов, разбор снимков ChatJob, ширины панелей, API origin) и E2E `e2e/tests/studio.spec.ts`.

### Этап 2 — пользовательский Studio
- [x] Оболочка Studio: выбор и создание проекта, три панели с изменяемой шириной (мышь и клавиатура, ширины сохраняются), вкладки «Редактор / Предпросмотр / Изменения / Проверки», узкий экран — переключение панелей.
- [~] Подключены проекты, файлы (чтение и сохранение), ChatJob и SSE с ресинхронизацией, отмена, diff, проверки, preview. **Approvals в Studio ещё нет.**
- [ ] Проверить пустой проект, существующий проект, длинную AI-сессию, reconnect, cancellation, approval и ошибки preview.
- [ ] Добавить responsive и accessibility проверки.

### Этап 3 — отдельный deployment
- [ ] Добавить независимые Preview deployments для Platform и Studio.
- [ ] Проверить cross-origin session, CORS, cookies, CSRF, CSP и logout.
- [ ] Настроить DNS/subdomain только после прохождения auth E2E.
- [ ] Подготовить идентичный маршрут для Timeweb и документировать env/config.
- [ ] Production rollout выполнять отдельно, с явным подтверждением и rollback plan.

## Критерии готовности

Studio нельзя объявлять отделённым продуктом, пока одновременно не выполнено:
- независимый build и deployment target;
- Platform и Studio используют одну серверную идентичность и общие данные;
- проекты и права доступа совпадают между интерфейсами;
- AI job/SSE, cancellation, approvals и preview работают без дублирования backend;
- login/logout/MFA проходят E2E на реальных целевых origins;
- текущая Platform не регрессировала;
- CI, typecheck, lint, unit, integration и E2E проходят;
- Timeweb конфигурация и rollback описаны и проверены.

## Ограничения текущего этапа

В этом изменении зафиксировано архитектурное решение и проведён ограниченный read-only аудит через GitHub. Локальная рабочая копия, терминал и запуск тестов в этой сессии недоступны; поэтому код приложения не менялся, Studio build не создан, CI не запускался, деплой и DNS не менялись. Нельзя считать отделение реализованным.

## Отклонение от плана (2026-11-27)

Код Studio размещён в `apps/web/studio/`, а не в отдельном пакете `apps/studio`. Причина — требование «без дублирования зависимостей». Отдельный пакет означал бы вторую копию React, Vite и lockfile, а перевод репозитория на npm workspaces затрагивает Dockerfile, CI и Vercel. Независимость сохранена:
- своя точка входа (`studio/index.html`, `studio/src/main.tsx`);
- свой Vite-конфиг (`vite.studio.config.ts`);
- свой артефакт сборки (`dist-studio`);
- свой URL (`/studio/`).

Studio импортирует общие модули Platform напрямую, без копий. Вынос в `packages/*` и отдельный поддомен остаются на этапе 3 — после E2E авторизации между доменами.

## Что ещё нужно для паритета с Builder

- approvals (подтверждение опасных действий) в панели агента;
- вложения к задаче и выбор AI-провайдера и модели;
- терминал и логи выполнения команд;
- история задач проекта (сейчас видна только текущая и последняя задача);
- E2E сценария «задача → изменения → редактор» проходит только в CI: в локальной среде у sandbox нет сети npm.

