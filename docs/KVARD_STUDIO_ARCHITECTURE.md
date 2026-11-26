# KVARD Studio — архитектура выделения

**Статус:** DECIDED / IMPLEMENTATION NOT STARTED  
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
- [ ] Сопоставить полный импорт-граф App.tsx и выявить Builder-компоненты/модули, которые можно безопасно переиспользовать.
- [ ] Проверить backend cookie/CORS/CSRF настройки и тесты auth.

### Этап 1 — безопасное извлечение
- [ ] Создать `apps/studio` с независимыми `index.html`, `main.tsx`, Vite config и app shell.
- [ ] Извлечь минимальные общие типы/API client в packages только после проверки циклических импортов.
- [ ] Вынести Builder workspace в Studio entry без изменения API-контрактов и поведения ChatJob.
- [ ] Сохранить текущий `apps/web` работоспособным и не удалять существующий Builder до parity-проверок.
- [ ] Добавить unit/component tests для bootstrap, routing и API origin config.

### Этап 2 — пользовательский Studio
- [ ] Реализовать самостоятельную навигацию Studio и polished editor layout.
- [ ] Подключить существующие backend endpoints для проектов, файлов, ChatJob/SSE, approvals и preview.
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
