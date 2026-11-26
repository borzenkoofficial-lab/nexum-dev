# КВАРД — единая пользовательская дизайн-система и план внедрения

**Статус:** аудит, брендовый знак и первый UI Kit increment внедрены; browser visual QA и расширение UI Kit остаются открытыми  
**Дата проверки:** 26 ноября 2026  
**Проверенная ветка:** `main`  
**HEAD исходного snapshot:** `66990520c9e23c1c7c9cfe250045518fa2b5b509`  
**Направление:** Balanced  
**Область:** только пользовательский продукт

Этот документ сводит результаты статического аудита, действующие UX-спецификации и утверждённые визуальные решения в один рабочий стандарт для последующей реализации. Он не означает, что все описанные состояния уже реализованы или проверены в браузере.

## Implementation progress — 26 November 2026

**Brand foundation**
- [x] Added the shared `KvardMark` React SVG component using the existing favicon geometry and semantic brand tokens.
- [x] Migrated Sidebar, Welcome, OSSystemChrome, BuilderShell, OSDesktop, BuilderChat, BuilderHome and Business Agents list marks.
- [x] Removed duplicate letter tiles and CSS-generated brand marks.
- [x] Added focused brand geometry, sizing and accessibility tests.

**First UI Kit increment**
- [x] Added `KvardButton`, `KvardField` and `KvardStatusBadge` with native HTML semantics.
- [x] Added semantic token-based styles for button variants/states, field labels/hints/errors and status tones.
- [x] Integrated shared controls into AI Agents and Business Agents without changing handlers or API behavior.
- [x] Removed the local button/status styles superseded by shared primitives.
- [x] Added focused UI Kit tests and CI execution.

**Verification**
- [x] CI build job on commit `f8311dd`: brand tests, UI Kit tests, API typecheck/tests, Web runtime tests, Web typecheck/build/lint, production Docker build and production-container smoke test all passed.
- [ ] E2E job for that commit is still running; no E2E pass is claimed yet.
- [ ] Browser screenshots, clear-space and manual light/dark responsive QA remain open.
- [ ] Next UI Kit increments: Dialog/Modal, Alert, Empty and Loading patterns; shared Tabs and Segmented Control primitives are now implemented.


---

## 1. Зафиксированные решения

### 1.1 Визуальный вектор

**Balanced — профессиональный SaaS-интерфейс с ясной структурой и спокойной визуальной иерархией.**

- Светлая нейтральная тема — основная и стартовая.
- Тёмная тема — полноценная альтернативная тема.
- Фиолетовый — функциональный цвет главного действия, активного состояния и фокуса.
- Сине-фиолетовый градиент допустим только в знаке, app icon и редких брендовых акцентах.
- Основные поверхности — нейтральные, без декоративного градиентного заполнения.
- Плотность — сбалансированная: не пустой лендинг и не перегруженная IDE.
- Иконки, типографика, состояния и геометрия должны быть единообразны.
- Motion помогает понять переход/состояние; не имитирует системную работу, которой фактически не происходит.

### 1.2 Референсная формула

- **Vercel clarity** — структура навигации, проектный контекст, списки и иерархия.
- **Lovable interaction** — чат и реальный результат в одном поле зрения.
- **Cursor agent transparency** — понятный ход выполнения, действия, ошибки и подтверждения.
- **Linear consistency** — типографика, предсказуемые заголовки, sidebar и повторяемые паттерны.
- **Replit Design Canvas** — выборочные идеи для визуальной работы и вариантов, но не обязательный бесконечный canvas.

Это не копирование чужих интерфейсов. Все решения адаптируются под фактическую архитектуру КВАРД.

### 1.3 Технические и организационные ограничения

- Разработка только в `main`, без создания рабочих веток.
- Не удалять существующие ветки.
- Не менять бизнес-логику, API-контракты, хранение данных, авторизацию или runtime в рамках визуального редизайна.
- Не добавлять фиктивные данные, фальшивые статусы, декоративные действия и неработающие кнопки.
- Перед каждым изменением проверять свежий HEAD и SHA файла.
- Малые логические коммиты; после этапа — typecheck, lint, tests, build и анализ diff.
- Изменения пользовательского интерфейса не должны включать административные файлы.

---

## 2. Границы работ

### Включено

- Welcome и пользовательская авторизация — только в пределах существующего пользовательского flow; изменение auth backend не входит в дизайн-задачу.
- Workspace shell и навигация.
- Главная и проекты.
- Project Studio / Builder: chat, agent, preview, files, code.
- AI Agents.
- Business Agents / Workforce.
- Интеграции.
- Диагностика и системные события.
- Журнал продукта.
- Пользовательские настройки.
- Общие компоненты, адаптивность, доступность и motion.

### Исключено до отдельного распоряжения

- Admin Control Center и его UI.
- `AdminControlCenter.tsx`, `AdminControlCenter.css`.
- `/admin`, административные API, MFA, роли и permissions.
- Административные метрики, security rollout и admin checklist.

Если пользовательский сценарий зависит от административного API, зависимость фиксируется отдельно. Административный код не меняется в рамках этого плана.

---

## 3. Карта пользовательских поверхностей

| URL / режим | Назначение | Основные компоненты | Что сохраняем |
|---|---|---|---|
| Первичная сессия | Welcome / регистрация | `NexumWelcome` | Регистрацию, валидацию и текущий переход в Workspace |
| `/`, `/projects` | Главная / обзор | `Sidebar`, `BuilderHome` | Композер задачи, шаблоны-подсказки, реальные последние проекты |
| `/projects/:id` | Project Studio | `BuilderShell`, `BuilderChat`, `BuilderTools`, `BuilderCode` | Выполнение задач, отмену, retry, preview, файлы, код и approvals |
| `/agents` | Персональные AI Agents | `AgentsPage` | Разделение prompt-профилей и постоянных определений агентов |
| `/business-agents` | Организационные агенты | `BusinessAgentsPage` | Организации, версии, запуски, знания, approvals, workforce |
| `/connectors` | Интеграции | `IntegrationPage`, `ConnectorModal` | Честные статусы и явное обозначение неподключённых интеграций |
| `/diagnostics` | Диагностика | `DiagnosticsPage`, Event Center | Реальные события и отдельные источники диагностики |
| `/news` | Журнал продукта | `NewsPage` | Даты, категории и редакционную структуру |
| `/settings` | Пользовательские настройки | Разметка в `App.tsx` | Тему, масштаб, компактность, провайдеры и локальные предпочтения |

Отдельный public marketing website в `apps/web/src` не обнаружен. Это не доказывает, что его нет в отдельном приложении или deployment. Не включать его в реализацию до подтверждения фактического маршрута/репозитория.

### 3.1 Общая композиция приложения

Текущая оболочка включает:

- `Sidebar` — основная навигация и список проектов.
- `BuilderHome` — рабочий обзор и запуск новой задачи.
- `NexumApplicationManager` — переключение между открытыми проектами.
- `NexumOSEventCenter` — системные события.
- `OSAppWindow` — сейчас нейтральный контейнер содержимого, не должен возвращать декоративную оконную метафору.
- `BuilderShell` — специализированная шапка Studio и навигация по инструментам.
- `CommandPalette` — быстрые команды.

Оболочка и Studio должны восприниматься как одна платформа, но иметь разные режимы работы. Не нужно насильно превращать каждый раздел в IDE.

---

## 4. Аудит дизайн-фундамента

### 4.1 Существующие токены

В `apps/web/src/kvard-design-system.css` уже определены семантические light/dark tokens:

| Назначение | Текущее значение light | Текущее значение dark |
|---|---:|---:|
| Canvas | `#F6F7F9` | `#111217` |
| Surface | `#FFFFFF` | `#191B23` |
| Raised surface | `#FFFFFF` | `#222530` |
| Subtle surface | `#F1F2F5` | `#20222B` |
| Border | `#E5E6EB` | `#30333F` |
| Primary text | `#191923` | `#F5F5F8` |
| Secondary text | `#555966` | `#B6BAC7` |
| Action | `#7040D8` | `#A78BFA` |
| Action hover | `#6032C5` | `#B69CFF` |
| Focus | `#8B5CF6` | `#B69CFF` |

Также уже есть семантические success / warning / danger / info, радиусы, тени, spacing и базовые размеры шрифтов.

**Важно:** это описание текущего CSS, а не утверждение, что все пары цветов уже прошли проверку контраста или что значения нельзя уточнить после визуального QA. Сначала измерить, затем менять.

### 4.2 Геометрия и типографика — текущая база

- Базовый шаг spacing: 4 px.
- Частые интервалы: 8 / 12 / 16 / 20 / 24 / 32 px.
- Радиусы: 6 px compact, 8 px controls, 12 px panels, 16 px large surfaces.
- Базовый UI font stack: Inter с системными fallback.
- Моноширинный шрифт — для кода, логов, ID и технических значений.
- Стандартные controls: ориентир 40–44 px высоты; плотные вторичные controls допускаются после проверки доступности.

### 4.3 Брендовый знак

В нескольких компонентах знак пока представлен текстовой буквой «К» или локальными реализациями. Единый повторно используемый SVG-компонент в проверенных точках не подтверждён.

Следующий брендовый шаг:
1. Один компонент `KvardMark` с размерами и доступным именем.
2. Единая геометрия для welcome, sidebar, Studio и системных поверхностей.
3. Отдельный wordmark с точным кириллическим названием «КВАРД».
4. Чёткий clear space и минимальный размер.
5. Никаких разных самодельных «К» в CSS и JSX.

### 4.4 CSS-инвентаризация на текущем HEAD

Подсчёт выполнен по исходникам; селекторы посчитаны простым текстовым анализом, не полноценным CSS AST/cascade audit.

| Файл | Строк | Селекторы (прибл.) | Уникальные hex-цвета | Определения tokens |
|---|---:|---:|---:|---:|
| `App.css` | 395 | 351 | 16 | 8 |
| `builder.css` | 163 | 141 | 0 | 0 |
| `kvard-design-system.css` | 808 | 500 | 43 | 77 определений / 50 имён |
| `nexum-welcome.css` | 72 | 60 | 0 | 0 |
| `BusinessAgentsPage.css` | 102 | 116 | 25 | 0 |
| `index.css` | 2 | 0 | 0 | 0 |

Найдено буквальное пересечение selector strings:
- `App.css` ↔ `kvard-design-system.css`: 23.
- `builder.css` ↔ `kvard-design-system.css`: 28.
- `nexum-welcome.css` ↔ `kvard-design-system.css`: 17.

Это сигналы для проверки каскада, но не доказательство, что каждый повтор является визуальным дефектом. Нельзя удалять или объединять селекторы автоматически.

**Самая явная зона долга:** `BusinessAgentsPage.css` содержит 94 вхождения hex-цветов (25 уникальных) и не определяет собственных semantic tokens. Переводить стили на `--kv-*` постепенно, проверяя каждое состояние и обе темы.

Порядок импорта в `App.tsx`: `App.css` → `builder.css` → `kvard-design-system.css`. Welcome дополнительно импортирует `nexum-welcome.css` и design system. Реальный cascade необходимо проверить в browser runtime до удаления правил.

---

## 5. P0/P1/P2 наблюдения и продуктовые ограничения

### P1 — пользовательский login не подтверждён как реальный

В текущем `NexumWelcome` регистрация вызывает `POST /api/auth/register`, но login path использует локальный demo-flow и записывает onboarding flag в localStorage. Кроме того, доступ к Workspace завязан на локальный onboarding state. Визуально не выдавать этот flow за полноценную подтверждённую пользовательскую сессию.

### P1 — заставка сообщает о шагах, которые не являются health-check

Welcome проходит фиксированные timed scenes. Прогресс и boot statuses не доказывают, что backend, агент или preview действительно проверены. Будущий UX должен либо использовать реальные сигналы, либо обозначать переход как визуальное приветствие без ложных обещаний.

### P1 — каталог интеграций

В `App.tsx` `connectedConnectors` инициализируется пустым массивом. Нажатие открывает модальное окно, которое сообщает, что серверное подключение не реализовано. Не показывать connected state без реального backend connection status.

### P1 — состояние AI-профилей

`AgentsPage` умеет отображать режим хранения профилей. Если API сообщает `memory`, пользователь должен видеть предупреждение о непостоянном хранении. Не обещать сохранность до подтверждения persistent storage.

### P1 — источники диагностики не смешивать

- Agent job history: `GET /api/agent/diagnostics?limit=50`, серверный JSONL history.
- Chat job details: `GET /api/chat/jobs/:id`.
- Browser diagnostics: отдельный pipeline событий и session storage на сервере.

В интерфейсе указывать источник, период и состояние обновления. Не суммировать разнородные события в одну метрику без определённой семантики.

### P2 — журнал продукта

Текущие записи журнала частично статичны и не должны называться live release feed, если нет подключённого источника публикаций.

### P2 — настройки

Часть UI preferences хранится локально. Различать локальные настройки интерфейса и server-side account settings. Не создавать впечатление, что локальная тема или масштаб синхронизируются между устройствами.

---

## 6. Канонические правила интерфейса

### 6.1 Цвет и поверхности

- Использовать semantic tokens: canvas, surface, raised, border, text, action, focus, success, warning, danger, info.
- Не добавлять локальные hex-цвета в компонент, если подходит существующий token.
- Не использовать action color для декоративных больших поверхностей.
- Статусы никогда не кодируются только цветом: добавить текст и/или иконку.
- Не использовать постоянные glow, glass, particle effects или фоновые градиенты в рабочих областях.

### 6.2 Типографика

- Один основной UI font stack.
- Чёткая лестница: page title → section title → body → label → caption.
- Не использовать мелкие uppercase micro-labels как основной способ навигации.
- ID, code, logs, token usage и технические значения — monospace.
- Числа и статусы должны сканироваться без декоративных карточек.

### 6.3 Компоненты

Обязательные варианты и состояния:
- Button: primary, secondary, tertiary, danger, icon; default, hover, focus, active, disabled, loading.
- Input / textarea / select: idle, focus, invalid, disabled, loading, helper/error.
- Tabs/navigation: active, hover, focus, disabled; доступное имя и текущая страница.
- Card/panel: default, selected, interactive, disabled.
- Modal/dialog: focus trap, Escape, backdrop, restore focus.
- Badge/status: semantic severity + label.
- Toast/banner/inline alert: success, info, warning, error.
- Skeleton/progress: только когда действительно загружаются данные/процесс.
- Empty state: краткое объяснение и одно реальное следующее действие.

### 6.4 Layout и адаптивность

Контрольные ширины:
- Desktop: 1440, 1280 px.
- Compact desktop / tablet: 1024, 768 px.
- Mobile: 390, 320 px.

Принципы:
- Desktop: постоянная навигация, рабочая область с разумной максимальной шириной.
- Tablet: вторичные панели сворачиваются или становятся переключаемыми.
- Mobile: приоритет контента и одного главного действия; панели Studio переключаются режимами, а не сжимаются в три колонки.
- Нет горизонтального overflow, перекрывающихся fixed layers и действий, доступных только по hover.
- Состояния должны сохраняться при переходе между режимами, если это поддерживает текущая логика.

### 6.5 Motion

- Короткие переходы интерфейса, без искусственной «загрузки ядра».
- Анимация не скрывает и не задерживает доступ к основному действию.
- Поддерживать `prefers-reduced-motion`.
- Прогресс и live-индикаторы отображать только при реальном событии/процессе.

---

## 7. Экранные направления

### Workspace / Overview

- Один главный task composer.
- Реальные последние проекты.
- Пустое состояние помогает начать первый проект.
- Не добавлять вымышленные KPI, revenue, activity feed или deployment status.
- Sidebar остаётся предсказуемым и не дублирует навигацию в теле страницы.

### Project Studio / Builder

- Сохранить чат рядом с реальным результатом.
- Desktop split: ориентир 38–42% chat / 58–62% result; это начальная гипотеза, проверяется на реальных проектах и размерах окна.
- Верхняя область: имя проекта, контекст, Preview / Agent / Files / Code и реальный статус.
- Agent progress: этап, действие, результат, ошибка, approval и следующее действие.
- Preview availability не равна production deployment.
- Mobile: Chat / Preview / Agent / Files / Code как доступные переключаемые режимы.
- Сохранять draft/composer при ошибках, retry и смене вкладки.

### AI Agents

- Ясно разделять повторно используемые prompt profiles и persistent agent definitions.
- Показывать реальные model, tools allowlist и approval policy.
- Не обещать schedules, triggers или unattended execution, пока они не поддержаны.

### Business Agents

- Организация и её контекст должны быть видны.
- Агент: версия, провайдер, модель, статус и реальные лимиты.
- Разделять каталог агентов, знания, команды, согласования и usage.
- Не показывать JSON quota как финальный UX: после подтверждения API-схемы оформить читаемую сводку с пояснениями.
- Не изображать каналы/триггеры как подключённые адаптеры без работающего backend.

### Integrations

- Разделить AI providers и внешние сервисы.
- Статусы: подключено, не подключено, требуется настройка, повторная авторизация, проверка, ошибка, недоступно в текущей версии.
- Секреты никогда не показывать повторно и не хранить в localStorage.
- OAuth/API connection controls появляются только при наличии реального backend adapter.

### Diagnostics

- Показать источник данных, время обновления и выбранный период.
- Список задач и подробности выбранной задачи.
- Отдельно различать job history, chat events и browser diagnostics.
- Ошибка должна давать следующий шаг: retry, открыть проект, скопировать ID/детали.

### Journal / Settings / Welcome

- Журнал: дата, тип обновления, версия/связанный раздел; статические записи маркировать как редакционный журнал.
- Настройки: отделить UI preferences от аккаунта и серверных credentials.
- Welcome: сократить time-to-task; реальные login/register states, error и loading должны быть понятны.

---

## 8. Реальные внешние референсы

Проверены 26 ноября 2026. Ссылки ниже ведут на официальные публикации/документацию или первичные продуктовые источники.

| Продукт | Что использовать как референс | Источник |
|---|---|---|
| Vercel | Sidebar, единая навигация на уровнях команды/проекта, мобильная нижняя навигация | https://vercel.com/changelog/dashboard-navigation-redesign-rollout |
| Lovable | Visual Edits: точечное редактирование реального UI рядом с AI-процессом | https://lovable.dev/blog/visual-edits |
| Replit Agent 4 | Design Canvas, работа с реальными интерактивными артефактами и вариантами дизайна | https://replit.com/blog/whats-changed-agent3-to-agent4 |
| Cursor 3 | Agents Window и Design Mode для указания конкретного UI-элемента | https://cursor.com/changelog/3-0 |
| Linear | Согласованные headers/navigation, спокойная боковая панель и сканируемость | https://linear.app/changelog/2026-03-12-ui-refresh |
| W3C WCAG 2.2 | Контраст, target size, keyboard focus и доступность | https://www.w3.org/TR/WCAG22/ |

Референсы подтверждают паттерны, но не заменяют осмотр текущего КВАРД. Для финальной визуальной приёмки нужны скриншоты работающего приложения.

---

## 9. Доступность и критерии качества

Целевой уровень — WCAG 2.2 AA для пользовательских маршрутов.

Минимальные проверки:
- Обычный текст: контраст не ниже 4.5:1; крупный текст — 3:1.
- Неграфические элементы управления и значимые визуальные состояния — достаточный контраст.
- Pointer targets: не менее 24×24 CSS px либо применимое исключение/достаточное расстояние.
- Видимый keyboard focus и логичный tab order.
- Правильные landmarks, heading hierarchy, labels, accessible names и live regions.
- Dialog semantics, focus management и возврат фокуса.
- Reduced motion.
- Не полагаться только на цвет для ошибок и статусов.

Успешная сборка не является доказательством WCAG-conformance. Нужны автоматические проверки и ручной keyboard/screen-reader pass.

---

## 10. План внедрения

### Этап 0 — закрыть аудит

- [x] Сверен актуальный HEAD `main`.
- [x] Зафиксирована карта пользовательских маршрутов.
- [x] Зафиксированы фактические ограничения login, welcome, integrations, diagnostics и storage.
- [x] Проведена первичная инвентаризация CSS и selector overlap.
- [x] Проверен последний CI workflow на HEAD аудита.
- [ ] Получить runtime screenshots всех пользовательских экранов.
- [ ] Проверить light/dark и контрольные ширины на текущем runtime.
- [ ] Провести ручной keyboard/accessibility pass.

### Этап 1 — единый brand foundation

- [ ] Зафиксировать финальную редакцию semantic tokens после контраст-проверки.
- [x] Создать единый SVG-компонент `KvardMark`; wordmark consolidation остаётся открытой.
- [x] Перевести Welcome, Sidebar, системную панель, desktop и Builder surfaces на единый знак.
- [ ] Проверить clear space, 16/24/32/48 px, light/dark.
- [ ] Зафиксировать владельца каждого CSS-слоя.

### Этап 2 — CSS ownership и UI Kit

- [ ] Составить список реально используемых селекторов.
- [ ] Проверить 23 / 28 / 17 повторяющихся selector strings по computed styles.
- [ ] Перевести `BusinessAgentsPage.css` с hardcoded colors на semantic tokens.
- [ ] Убрать дубли только после визуальной проверки каждого потребителя.
- [ ] Собрать Button, Input, Select, Tabs, Card, Modal, Status, Alert, Empty и Loading patterns.
- [ ] Добавить/обновить компонентные тесты.

### Этап 3 — Workspace shell

- [ ] Согласовать ширину и поведение Sidebar.
- [ ] Утвердить общий page header и context pattern.
- [ ] Проверить командную палитру, события и уведомления.
- [ ] Проверить мобильную навигацию и управление проектами.

### Этап 4 — Overview и Studio

- [ ] Полировать Overview и project list.
- [ ] Полировать Builder header и chat/composer.
- [ ] Полировать agent progress, approvals и error recovery.
- [ ] Полировать Preview, Files и Code.
- [ ] Проверить desktop split и mobile mode switching.

### Этап 5 — продуктовые разделы

- [ ] AI Agents.
- [ ] Business Agents.
- [ ] Integrations.
- [ ] Diagnostics и Event Center.
- [ ] Journal.
- [ ] Settings.
- [ ] Welcome / user-facing auth presentation.

### Этап 6 — responsive, accessibility и motion

- [ ] 1440 / 1280 / 1024 / 768 / 390 / 320 px.
- [ ] Light / dark для каждого пользовательского маршрута.
- [ ] Keyboard / focus / screen reader.
- [ ] Контраст и touch target.
- [ ] Reduced motion.
- [ ] Проверка отсутствия overflow и перекрытий.

### Этап 7 — финальная приёмка

- [ ] Пройти ключевые сценарии от создания проекта до preview и итерации.
- [ ] Пройти ошибки API, retry, cancel, approvals и empty/loading states.
- [ ] Проверить отсутствие изменений в административных файлах.
- [ ] Запустить API/Web typecheck, tests, lint, build и E2E/CI.
- [ ] Сохранить runtime screenshots и итоговый regression report.

---

## 11. Definition of Done

Экран можно считать завершённым только когда:
1. Основное назначение и действие понятны.
2. Используются канонические tokens и общие компоненты.
3. Реальные данные и статусы соответствуют backend.
4. Нет фиктивных действий, статусов или метрик.
5. Проверены loading, empty, error, success, disabled и approval states, где применимо.
6. Проверены desktop/tablet/mobile и light/dark.
7. Проверены клавиатура, focus, labels, contrast и reduced motion.
8. Основные сценарии не регрессировали.
9. Typecheck, lint, tests и build пройдены.
10. В коммите нет изменений административной зоны.

---

## 12. Проверенное состояние на момент фиксации

- Проверены implementation commits: `c90c38c`, `96e3f08`, `dec6cf2`, `d7e8502`, `ef636e0`; каждый затронул только запланированные user-facing brand files.
- В implementation commits не затронуты административные файлы, маршруты, API, MFA или permissions.
- CI run `45707760275` build job прошёл полностью: brand tests, UI Kit tests, API typecheck/tests, Web runtime tests, Web typecheck/build/lint, production Docker build и production-container smoke test.
- E2E job run `45707760275` на момент обновления документа ещё выполнялся.
- CI build job для этой реализации зелёный; общий pipeline не объявляется полностью зелёным до завершения E2E.
- Browser visual QA, скриншоты, clear-space и ручная проверка light/dark остаются открытыми.
- Разработка выполняется непосредственно в `main`, без отдельных веток и PR, по прямому требованию владельца продукта.

## 13. Источники внутри репозитория

- `docs/KVARD_USER_FACING_DESIGN_CONTRACT.md`
- `docs/KVARD_USER_FACING_AUDIT.md`
- `docs/KVARD_COMPETITOR_RESEARCH.md`
- `docs/KVARD_BUILDER_UX_SPEC.md`
- `docs/KVARD_AI_AGENTS_UX_SPEC.md`
- `docs/KVARD_PLATFORM_SECTIONS_UX_SPEC.md`
- `docs/KVARD_DESIGN_SYSTEM.md`
- `docs/KVARD_GLOBAL_DESIGN_PLAN.md`
- `docs/KVARD_BALANCED_BRAND_ROLLOUT.md`


## 14. Shared navigation primitive — KvardTabs

The first shared navigation primitive is implemented for the user-facing Business Agents workspace.

- Component: apps/web/src/components/ui/KvardTabs.ts.
- Public export: apps/web/src/components/ui/index.ts.
- Styling: apps/web/src/kvard-ui-kit.css, using existing KVARD semantic tokens only.
- Integration: the five existing Business Agents sections — Agents, Knowledge, Teams, Approvals and Usage.
- Accessibility contract: tablist/tab/tabpanel roles, stable tab-to-panel IDs, selected state, roving tabindex, accessible badge labels, disabled-item handling, and ArrowLeft/ArrowRight/Home/End keyboard navigation.
- The selected tab remains controlled by the owning page; the component does not own route or business state.
- Existing API calls, data loading, actions and domain logic are unchanged.
- Superseded local tab styles were removed from BusinessAgentsPage.css after integration.

Verification boundary: implementation and tests are committed, but the final CI run is pending and browser visual QA has not been completed. Do not describe the component as fully verified until typecheck, focused tests, lint, build and browser keyboard/visual checks complete. No administrative files were included in the implementation commits.


## 15. Shared selection primitive — KvardSegmentedControl

The second shared selection primitive standardizes compact mutually exclusive choices. It is intentionally distinct from `KvardTabs`: it does not represent navigation between tab panels and does not claim tab semantics.

- Component: `apps/web/src/components/ui/KvardSegmentedControl.ts`.
- Public export: `apps/web/src/components/ui/index.ts`.
- Styling: `apps/web/src/kvard-ui-kit.css`, semantic light/dark tokens only.
- Semantics: labelled `role="group"` containing native buttons with controlled `aria-pressed` state.
- Disabled options use native `disabled`; selection remains controlled by the owning screen.
- Integrations: Diagnostics event filter (All / Errors / Jobs) and Builder preview device size (Desktop / Tablet / Mobile).
- Existing filter predicates, diagnostic data sources, preview state and iframe behavior are unchanged.
- Superseded local selected-state styles were removed; Builder's broad tool-button selector explicitly excludes the shared option buttons.

Verification boundary: implementation and focused component tests are committed, but the final CI run and browser visual QA are not yet complete. Do not claim a typecheck/test/build pass until CI reports it. No administrative files are part of this increment.


## 16. Shared dialog primitive — KvardDialog

The shared dialog primitive centralizes modal semantics and keyboard focus behavior while leaving visual composition to each user-facing surface.

- Component: `apps/web/src/components/ui/KvardDialog.ts`.
- Public export: `apps/web/src/components/ui/index.ts`.
- Accessible naming: supports `aria-label` or `aria-labelledby`, optional `aria-describedby`, `role="dialog"`, and `aria-modal="true"`.
- Keyboard behavior: Escape closes by default and stops propagation to page-level shortcuts; Tab and Shift+Tab are trapped within enabled, visible focusable descendants.
- Focus lifecycle: initial focus prefers an explicit `autofocus` element, otherwise the first focusable descendant; focus returns to the previously active element on close.
- Backdrop behavior: closes only when the pointer event originates on the backdrop itself; can be disabled per instance.
- Integrations: New Project modal and Command Palette. Their existing form state, project creation callback, command filtering, keyboard selection, and action callbacks remain owned by their original components.
- The component does not create a portal, lock document scrolling, or impose consumer-specific dimensions/z-index. Existing modal and palette CSS continues to own their visual layout.
- No API, authentication, permission, or domain logic was changed.

Verification boundary: focused tests are authored for accessible markup, Escape propagation, and focus wrapping. The final GitHub Actions run for commit `4a3a65c` is pending; no test, typecheck, lint, or build pass is claimed. Browser visual and manual keyboard QA remain open. No administrative files were included.


Additional user-facing integrations:

- Business Agents — Create AI Employee modal uses the shared dialog frame with its existing form state, validation, API submit path, and close control preserved. The agent-name field receives initial focus.
- Workspace — Application Manager switcher uses the shared dialog frame. Its existing project/window selection and close-project callbacks remain unchanged. Backdrop dismissal now occurs only when clicking the backdrop itself, not when clicking inside the switcher.
- Both integrations retain their existing consumer-specific CSS classes; no admin surfaces were changed.


## 17. Feedback and empty-state primitives

Three reusable user-facing primitives now extend the shared UI kit:

- `KvardAlert`: inline feedback with `danger`, `warning`, `success`, and `info` tones. Errors use `role="alert"` and assertive live announcements; non-error feedback uses `role="status"` and polite announcements. Optional dismissal is an explicit callback.
- `KvardToast`: a presentational, polite, atomic status live region. It deliberately does not own timers, queueing, persistence, or global notification state; the existing screen remains the source of truth for visibility and content.
- `KvardEmptyState`: a labelled region with a concise title, optional description, and optional action slot. It does not invent actions or data.

Initial user-facing integrations:
- Workspace global notice uses `KvardToast`, retaining the existing `notice` state and visual `toast` class.
- Business Agents uses `KvardAlert` for dismissible error/success feedback and `KvardEmptyState` for the no-agents and no-pending-approvals states.
- Agents uses `KvardAlert` for retryable loading errors and success feedback, plus `KvardEmptyState` for the no-saved-agents state.
- Existing retry handlers, close callbacks, data conditions and API paths remain in their owning pages.
- Shared styling uses semantic KVARD tokens; consumer classes remain in place for gradual migration.

No notification scheduler, toast timeout, server event, fake state, API, authentication, or administrative UI was introduced or changed.


## 18. Shared surface system — KvardSurface

The UI kit now defines a common container primitive for Workspace and Builder:

- Component: `apps/web/src/components/ui/KvardSurface.ts`.
- Public export: `KvardSurface` plus its element, variant, padding and prop types.
- Semantic element choices: `div`, `section`, or `article`; no implicit interactive role or keyboard behavior.
- Surface variants: `default`, `subtle`, `raised`, and `outline`.
- Spacing variants: `none`, `sm`, `md`, and `lg`.
- Visual styling uses shared surface, border, radius and shadow tokens. Consumer classes remain available for local layout and responsive adjustments.

Initial migrations:
- Workspace home: create-project section, recent-project list and empty-project panel.
- Builder: development chat, preview panel, files panel, agent panel and code editor.
- Existing component-owned layout, content, actions, API calls and state remain unchanged.
- Builder panel base border/background/radius/shadow declarations now come from the shared primitive rather than duplicated surface CSS.
- Superseded Workspace surface declarations were removed while retaining layout and responsive rules.

No route, API, authentication, permission, agent execution or administrative UI behavior was changed.


## 19. Builder navigation and responsive project header

The Builder project tool switcher now uses the shared `KvardTabs` primitive instead of a separate set of local buttons.

- `KvardTabs` accepts an optional consumer class while preserving its base `kv-tabs` class and shared keyboard/ARIA behavior.
- Builder tools (Preview, AI Agent, Files, Code) expose tablist/tab semantics, selected state, arrow-key navigation, Home/End navigation and linked tab-panel naming.
- The active Builder content is exposed as the corresponding labelled tab panel.
- The project header keeps its desktop hierarchy and moves the tool tabs into a full-width, horizontally scrollable row on narrow viewports; tabs retain visible keyboard focus and touch-friendly minimum height.
- Existing project actions, active-tool state, tool callbacks, agent status, preview behavior and domain logic remain owned by BuilderShell and its existing consumers.
- No route, API, authentication, permission, agent execution or administrative UI behavior was changed.

Verification boundary: focused tests were extended for the consumer-class contract and existing KvardTabs keyboard behavior. CI, typecheck, lint, build, browser visual QA and manual keyboard QA must be checked against the final commit; none are claimed as passing at this point. No administrative files were included.


## 20. Shared page and section headers

The user-facing sections now share `KvardPageHeader` for consistent semantic structure while retaining page-owned presentation.

- Component: `apps/web/src/components/ui/KvardPageHeader.ts`.
- Public export: `KvardPageHeader` and `KvardPageHeaderProps`.
- Standard slots: optional eyebrow, required title, optional description and optional actions.
- Explicit heading level supports page-level `h1` and section-level `h2` / `h3`.
- Optional title and description IDs connect the header to its accessible name and description.
- Consumer classes are preserved on the root, content and action slots. Existing page-specific typography, colors, spacing and action styling remain in their page stylesheets.
- Migrated sections: AI Agents, Business Agents, Integrations, Diagnostics and News.
- Responsive shared behavior stacks heading content and action groups on narrow screens; page-specific breakpoints remain intact.
- No API calls, data flow, permissions, routing, admin components or admin styles were changed.

Verification boundary: component tests cover heading semantics, accessible name/description associations, action slot classes and section-level heading selection. CI, typecheck, lint, build and browser visual QA remain to be checked against the final commit.

## 21. Workspace and internal section heading consistency

The shared header contract now extends beyond page tops into the main user-facing workspace and operational sections.

- Workspace home: the create-project and recent-project section titles use `KvardPageHeader` with explicit `h2` semantics.
- AI Agents: task profiles, saved agents and runtime sections use the same heading slots, preserving their existing eyebrow labels, descriptions and real action/count content.
- Business Agents: agent library, knowledge, teams, approvals and usage sections use section-level headings; the agent count remains a real data value in the action slot.
- Integrations: provider/service group headings use the shared structure and stable accessible title IDs.
- Diagnostics: job history and event-log panel headings use the shared structure; the existing event filter remains a real action control.
- Consumer layout classes remain in place. CSS selectors that depended on a direct action child were updated to target the shared action slot instead.
- No panel data, API behavior, actions, event filters, route behavior or business logic changed. Admin UI and admin files remain excluded.

Verification boundary: source and diff review only. CI, typecheck, lint, build, browser screenshots and manual keyboard/responsive QA must be checked against the final HEAD; none are claimed as passing.

## 22. Builder project and panel heading hierarchy

The Builder now uses the shared heading structure at project and tool-panel level.

- Project bar: project name is the page-level `h1`; the KVARD mark and workspace eyebrow identify its context. The return-to-workspace action remains explicit and keyboard-operable.
- Chat panel: the task composer is an `h2` section; the empty-state prompt is demoted to `h3` so it no longer competes with the project title.
- Preview, Files and AI Agent panels: each has a stable `h2` title, with dynamic availability text and operational actions retained in description/action slots.
- Code panel: project code has a consistent `h2` title, project context and the existing preview/save controls.
- The shared page-header responsive stack is overridden only for the compact project bar, which remains a single-row identity/control unit on mobile. Tool panel actions continue to stack under the shared responsive rule.
- The Builder top bar wrapper is a neutral layout container; the nested project header provides the actual semantic header landmark, avoiding nested header landmarks.
- Existing API calls, file loading/saving, preview navigation, agent state, tool tabs and project callbacks remain unchanged.
- The UI Kit suite now explicitly covers `h3` content-level heading semantics in addition to the existing `h1` and `h2` cases.
- Code-panel action controls wrap within their shared action slot on narrow screens; the project return action has a visible keyboard-focus outline.

Verification boundary: source and diff review only. CI, typecheck, lint, tests, build, visual browser QA and keyboard QA remain to be confirmed on the final commit; none are claimed as passing.


## 23. Builder responsive layout and overflow hardening

The Builder's existing desktop split and narrow-screen stacked layout now receive a focused responsive hardening pass.

- Constrain the Builder grid, panels, file panes, editor surfaces and nested content with min-width: 0 / max-width: 100% to prevent long content from widening the workspace.
- Long conversation messages, agent events, plans, problem details and file paths can wrap within their own panels instead of forcing page-level horizontal overflow.
- Keep source-code textareas intentionally scrollable; the editor remains the horizontal-scroll boundary for long code lines.
- Make the model picker, Composer controls, panel actions and project header fit narrow viewports without changing their actions or state ownership.
- Correct the filename emphasis selector to target the actual <b> element rendered by Files and Code panels.
- Preserve semantic design tokens for focus visibility, borders, surfaces and text; no new hard-coded theme palette was introduced.
- Keep existing preview, file loading/saving, agent execution, tabs and API contracts unchanged.
- No admin UI, admin styles, routes, APIs, permissions or business logic were changed.

Verification boundary: source and diff review only. CI is pending for this commit; typecheck, lint, tests, build, browser visual QA and manual device/keyboard QA are not yet confirmed.


## 24. Builder loading, empty and error states

The Builder now uses the shared feedback and empty-state primitives for key user-facing operational states.

- Chat task failures use `KvardAlert` with assertive error semantics and retain the existing retry callback.
- Files distinguishes list loading, list-load failure, file loading, file-load failure, an empty project and the neutral file-selection prompt.
- File-load failure exposes a retry for that file. Save failure preserves the edited buffer and explicitly tells the user their changes remain in the editor; it does not trigger a destructive reload.
- Preview's pre-build state and the agent's empty activity history use `KvardEmptyState`.
- Existing file list, read, save, preview, agent and retry APIs/callbacks remain the source of truth. No synthetic completion or connectivity states were introduced.
- Existing design tokens are used for the feedback and empty-state presentation. No admin UI, admin styles, routes, APIs, permissions or business logic were changed.

Verification boundary: source and diff review only. CI, typecheck, lint, tests, build and browser/keyboard visual QA must be checked against final HEAD; none are claimed as passing.


## 25. Business Agents interaction polish

The Business Agents user-facing screen receives a focused interaction-consistency pass.

- Alert-dismiss and modal-close controls use a consistent 36px hit area, shared control radius and semantic focus token.
- Hover feedback uses the semantic surface-hover token, preserving the independent light/dark palette.
- Header actions and modal footer children are constrained with min-width: 0 to prevent intrinsic content from forcing overflow.
- Existing modal dismissal, alert actions, business-agent APIs, forms, approvals, execution and organization state remain unchanged.
- No admin UI, styles, routes, APIs, permissions or business logic were changed.

Verification boundary: source and diff review only. CI, typecheck, lint, tests, build and browser visual/keyboard QA remain unconfirmed for this change.


## 26. Integration catalog truthfulness

- Connector cards use the shared `KvardStatusBadge` primitive for consistent status semantics.
- A connector absent from the current configured list is labelled `Не настроено`, not presented as a live connection check.
- The page explicitly identifies itself as a reference catalog while server-side OAuth/API setup is unavailable.
- The existing details modal remains informational and its disabled action stays disabled; no credentials, OAuth flow, API request, or synthetic connection state is introduced.
- Existing connector data, modal callback, routing and future connected-state contract remain unchanged.
- No administrative UI, styles, routes, APIs, permissions or business logic were changed.

Verification boundary: source and diff review only. CI, typecheck, tests, lint, build and browser visual/keyboard QA must be checked against the final HEAD; none are claimed as passing.


## 27. Diagnostics toast semantics

- Diagnostics feedback now uses the shared `KvardToast` live-region primitive.
- The previous toast container had an `onClick` dismissal handler but was not a keyboard-operable control; its shared toast styling also disables pointer events. The ineffective click handler was removed rather than inventing an interactive affordance.
- The message remains a polite, atomic status announcement and keeps the existing notice state, API error text and export-success message.
- A focused UI test covers the toast live-region contract and absence of an implicit click action.
- No diagnostics data sources, retry handlers, export behavior, API paths or admin surfaces were changed.

Verification boundary: source and test additions reviewed; test execution, typecheck, lint, build and browser QA remain unconfirmed on the final HEAD.


## 28. AI Agent profile persistence feedback

- Profile-save confirmation now distinguishes the three supported storage states: database, server memory and unknown.
- The UI no longer claims server-memory persistence when the API omits the storage field and no previous storage state is known.
- The resolved storage value is used consistently for both state and user feedback.
- Focused test coverage verifies each storage message.
- Agent profile API payload, persistence implementation, save flow and other agent workflows are unchanged.


## 29. Project-scoped conversation integrity

- Conversation persistence is gated by the project ID whose history has finished loading. During a project switch, the previous project in-memory messages cannot be written under the newly active project storage key.
- A task submitted for a different project resolves context from that target project stored conversation rather than reusing the currently rendered project state. A newly created project therefore starts with an empty conversation context.
- The existing local-storage key format, 100-message retention limit, chat API payload shape, server job lifecycle and project APIs remain unchanged.
- Focused tests cover the persistence gate, project-switch isolation and first-task context for a new project.
- No admin UI, admin styles, routes, APIs, permissions or business logic were changed.

Verification boundary: implementation and focused tests added; test execution, typecheck, lint, build, browser QA and deployment status must be checked against final HEAD before being described as passing.


## 30. Workspace home visual refinement

- The Workspace heading now has a restrained product-context eyebrow and a clearer project-count treatment; the count remains the live project total supplied by the existing page state.
- The creation surface has stronger hierarchy between title, supporting description, composer and starter scenarios.
- Starter scenarios are presented as three consistent, descriptive selection cards with compact indices and directional affordances. They continue to populate the existing brief field and do not create projects until the user submits.
- Recent-project rows receive more deliberate spacing and surface treatment while retaining their existing project-open callbacks.
- Desktop and mobile layouts use the existing semantic light/dark design tokens. No new palette, API, project state, business logic or admin surface was introduced.
- Scope is presentation-only: BuilderHome markup and kvard-design-system styles.


## 31. AI Agents library card layout

- The user-facing profile and agent inventories now use responsive configuration cards instead of one continuous dense row list.
- Each card has a stable identity area, readable role/status metadata, clearer description spacing and a separated action rail.
- Primary launch/configuration actions remain visually distinct from pause/delete actions; destructive affordances remain neutral until hover and use semantic danger tokens.
- The Runtime table and event stream receive slightly more generous row spacing and consistent surface elevation.
- Existing profile/agent content, state, callbacks, APIs, confirmation behavior and runtime data are unchanged. No admin UI or admin styles are included.
- The card layout uses existing semantic tokens and collapses to a single column on narrower screens.
- Scope is presentation-only: kvard-design-system styles.


## 32. Global workspace navigation refinement

- The main user-facing sidebar now has a clearer hierarchy between brand, primary project creation, workspace navigation and the project list.
- Active navigation uses a restrained location marker in addition to the existing semantic active surface.
- Project count and project selection receive more consistent compact treatments; the selected project remains identifiable without changing the current route or callback.
- Mobile navigation retains its existing responsive grid and receives a compact active indicator.
- All navigation labels, project data, loading states, actions, route callbacks and disabled states are unchanged.
- Scope is presentation-only and excludes administrative navigation and all admin surfaces.
