# КВАРД — упрощение общей оболочки интерфейса: план реализации

> **For agentic workers:** использовать существующий workflow разработки в `main`; выполнять задачи последовательно, проверять каждую, не менять бизнес-логику.

**Goal:** привести главную страницу, продуктовые разделы и Studio к одной простой оболочке приложения без имитации операционной системы и декоративного AI-оформления.

**Architecture:** существующие маршруты и компоненты страниц сохраняются. Общая навигация выносится на уровень App и использует существующий Sidebar; BuilderHome перестаёт дублировать навигацию. OSAppWindow становится нейтральным контейнером, а не фальшивым окном ОС. Визуальные решения остаются в текущей дизайн-системе, без нового CSS-слоя.

**Tech Stack:** React 19, TypeScript, Vite, существующий CSS.

**Spec:** `docs/KVARD_GLOBAL_DESIGN_PLAN.md`, `docs/KVARD_DESIGN_SYSTEM.md`.

## Global Constraints

- Сохранять существующие URL, auth, API, модели данных, создание проектов, запуск агента, preview, файлы и настройки.
- Не добавлять зависимости.
- Светлая тема — по умолчанию; тёмная тема — полноценная альтернатива.
- Цвет действия остаётся функциональным; никаких декоративных градиентов, свечений, стекла, частиц и фальшивой OS-анимации.
- Все маршруты доступны из одной постоянной навигации.
- Не показывать фиктивные статусы и данные.
- Изменения вносить прямо в `main` согласно `docs/DEVELOPMENT_POLICY.md`.

## Review Focus

- Прямое открытие `/projects/:id` сохраняет выбранный проект и Studio.
- Browser back/forward продолжает корректно переключать маршруты.
- Проект без имени/с длинным названием не ломает боковую навигацию.
- На ширине 320px навигация и Studio не создают горизонтальный overflow всей страницы.
- Смена light/dark темы не ломает общий sidebar, page header и формы.

---

### Task 1: Единая навигация приложения

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/components/BuilderHome.tsx`
- Modify: `apps/web/src/kvard-design-system.css`

**Interfaces:**
- Sidebar получает текущий view, projects, loading/action state, callbacks для нового проекта, открытия проекта и перехода по разделам.
- SidebarView включает `home | project | connectors | settings | news | diagnostics | agents | business-agents`.
- App остаётся владельцем маршрутизации и состояния проектов.

- [x] Подключить Sidebar в корне App и передать реальные callbacks.
- [x] Добавить в Sidebar отсутствующие разделы AI Agents и Business Agents.
- [x] Удалить из BuilderHome дублирующую боковую навигацию; оставить только содержимое страницы.
- [x] Обеспечить один sidebar на всех основных маршрутах.
- [x] Проверить навигацию по каждому маршруту, открытие проекта и возврат на главную (E2E).

### Task 2: Убрать фальшивую OS-рамку у обычных страниц

**Files:**
- Modify: `apps/web/src/components/OSAppWindow.tsx`
- Modify: `apps/web/src/components/OSSystemChrome.tsx`
- Modify: `apps/web/src/kvard-design-system.css`
- Modify: `apps/web/src/App.css`

- [x] Удалить кнопки управления окнами и декоративный titlebar из обычных страниц.
- [x] Использовать заголовки самих страниц; убрать дублирующий системный topbar. Командная палитра остаётся доступна по Ctrl/Cmd+K.
- [x] Убрать вложенные рамки, лишние внутренние отступы и дублирующие брендовые элементы.
- [x] Сохранить доступность контента и основные действующие действия; проверено E2E.

### Task 3: Упорядочить Studio

**Files:**
- Modify: `apps/web/src/components/BuilderShell.tsx`
- Modify: `apps/web/src/builder.css`
- Modify: `apps/web/src/kvard-design-system.css`

- [x] Сохранить название проекта и навигацию Preview / Agent / Files / Code; убрать Studio из fullscreen fixed overlay, чтобы общая навигация оставалась видимой.
- [ ] Устранить вложенные панели и конкурирующие границы.
- [ ] Сохранить split layout для чата и инструмента на desktop.
- [x] На узких экранах Studio использует вертикальную компоновку и остаётся внутри общей оболочки.

### Task 4: Проверка и фиксация результата

- [x] Запустить API/Web typecheck, API/Web tests, lint, production builds и Docker smoke test через CI.
- [x] Проверить CI: workflow `45661043216` — SUCCESS. Vercel/Cloudflare production deployment в рамках этой задачи отдельно не запускался.
- [x] Проверить diff, навигацию по семи разделам и прямой `/projects/:id` через E2E.
- [ ] Зафиксировать точные результаты и ограничения в `docs/PROJECT_STATUS.md` и глобальном чек-листе.
- [x] Получены и проверены Playwright-скриншоты 320/390/768/1440 px и Studio 390 px. Детальная полировка всех страниц остаётся отдельной задачей.


## Выполнено на 2026-11-25

- Commit с общей оболочкой и навигацией: `e97ce16` и последующие style-fix commits.
- Последний CI: [workflow 45661043216](https://github.com/borzenkoofficial-lab/nexum-dev/actions/runs/45661043216) — SUCCESS.
- Playwright: 40 passed, 3 skipped.
- Визуальные артефакты проверены на ширинах 320, 390, 768 и 1440 px; отдельно проверена Studio на 390 px.
- Следующий этап: убрать остаточные декоративные подписи главной страницы и перейти к отдельной полировке страниц AI Agents, Business Agents, Integrations, Diagnostics, Journal и Settings.
