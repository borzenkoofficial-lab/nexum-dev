# КВАРД — аудит консолидации основной ветки

Дата проверки: 2026-11-25  
Репозиторий: `borzenkoofficial-lab/nexum-dev`  
Рабочая ветка: `main`

## Правило разработки

- Единственная рабочая ветка — `main`.
- Новые feature/fix/design ветки и новые Pull Request для обычной разработки не создавать.
- Изменения вносить небольшими логическими коммитами непосредственно в `main`.
- Перед каждым изменением проверять актуальный HEAD и целевые файлы.
- После каждого изменения запускать относящиеся к нему тесты и фиксировать фактический результат.
- Не удалять старые ветки, пока не выполнена инвентаризация их уникальных коммитов и файловых изменений.
- Не выполнять force-push, массовый reset или автоматическое слияние конфликтующих историй.
- Не выполнять production deployment, миграции production-БД или изменения секретов без отдельного разрешения.

## Подтверждённые изменения в main

| PR | Содержание | Состояние |
|---|---|---|
| [#65](https://github.com/borzenkoofficial-lab/nexum-dev/pull/65) | PostgreSQL foundation для постоянного хранения проектов | Merged |
| [#66](https://github.com/borzenkoofficial-lab/nexum-dev/pull/66) | Object Storage Port и локальный адаптер | Merged |
| [#67](https://github.com/borzenkoofficial-lab/nexum-dev/pull/67) | Почасовой workflow автономной разработки | Merged |

## Результаты сравнения веток с main

GitHub branch search вернул 67 веток, включая `main`. Для выборки архитектурных, UI/design и стабилизационных веток выполнено GitHub compare `main...branch`.

### Универсальные агенты и Durable Runtime

| Ветка | Уникальные коммиты впереди main | Отставание | Изменённые файлы |
|---|---:|---:|---:|
| `feat/nexum-agents-foundation` | 10 | 240 | 38 |
| `feat/nexum-agents-review` | 23 | 240 | 42 |
| `feat/agents-durable-runtime-queue` | 40 | 240 | 46 |

Вывод: эти ветки содержат значимые уникальные изменения — API агентов, organizations/tenancy, knowledge, workforce, approvals, quota, миграции, worker и queue. Они не присутствуют в main целиком. Ветки сильно отстали от main, а изменения перекрываются между собой. Нужен перенос по слоям и согласование миграций, а не слияние всей ветки.

### Daytona

| Ветка | Уникальные коммиты впереди main | Отставание | Изменённые файлы |
|---|---:|---:|---:|
| `feat/daytona-runtime-main-integration` | 22 | 8 | 16 |
| `feat/daytona-sandbox-runtime` | 110 | 240 | 23 |

Ветка `feat/daytona-runtime-main-integration` ближе к текущему main и содержит адаптер, provider, runner, тесты, docs и render config. Она всё ещё diverged. Предпочтительнее аудитировать именно её как источник изменений, сверяя с PR #61 и не дублируя реализацию.

### Дизайн и UI

| Ветка | Уникальные коммиты впереди main | Отставание | Изменённые файлы |
|---|---:|---:|---:|
| `design/clean-foundation` | 0 | 205 | 0 |
| `design/kvard-premium-system` | 0 | 11 | 0 |
| `design/professional-workspace` | 0 | 285 | 0 |
| `ui/full-rebuild` | 0 | 278 | 0 |
| `ui/full-ui-reset` | 0 | 269 | 0 |
| `ui/rebuild-builder-workspace` | 0 | 282 | 0 |
| `ui/global-product-redesign` | 11 | 260 | 6 |

Шесть уникальных файлов в `ui/global-product-redesign`: `App.css`, `builder.css`, `BuilderHome.tsx`, `NewsPage.tsx`, `nexum-os.css`, `nexum-welcome.css`. Это отдельная порция UI изменений, которую нужно визуально и функционально проверить перед переносом. Остальные перечисленные дизайн/UI ветки не содержат уникальных коммитов относительно main по Git compare; они позади main.

### Builder и стабилизация

| Ветка | Уникальные коммиты впереди main | Отставание | Изменённые файлы |
|---|---:|---:|---:|
| `fix/agent-build-validation-evidence` | 8 | 243 | 6 |
| `fix/builder-scaffold-first` | 40 | 240 | 8 |
| `feat/runtime-phase-2-5` | 9 | 630 | 9 |
| `feat/ai-loop-production-overhaul` | 5 | 403 | 3 |
| `feature/project-workspace-v2` | 4 | 1391 | 2 |
| `feat/admin-control-center` | 9 | 826 | 8 |

Эти ветки содержат уникальные исправления и тесты. Требуется сравнить их отдельные diff и текущие реализации main, особенно agent lifecycle, scaffold, validation evidence, task state, completion gate, admin RBAC и workspace UX.

### Ветка P0 hardening

`fix/p0-production-hardening`: 160 уникальных коммитов впереди main, 253 позади, compare показывает лимит в 300 файлов. В diff есть удаления большого количества `apps/api/node_modules` и изменения множества production-файлов. Это нельзя переносить целиком: сначала отфильтровать артефакты зависимостей, затем выделить конкретные исправления с тестами.

## Приоритеты дальнейшего переноса в main

1. **Agents foundation:** API contracts, tenant isolation, repositories/services, migrations, tests, frontend workspace.
2. **Durable runtime:** lease queue, worker lifecycle, cancellation, retry/recovery, fencing, integration tests.
3. **Daytona:** provider/runner, sandbox cleanup, environment contract, local fallback, tests.
4. **Builder/AI loop:** уникальные исправления task state, completion gate, scaffold-first, build validation evidence.
5. **Design/UI:** просмотреть уникальный diff `ui/global-product-redesign`, извлечь полезные компоненты и стили, сверить с текущей дизайн-системой и требованиями premium.
6. **Admin/security:** RBAC, organization scoping, secret boundaries, audit log, usage/quota.
7. **Branch cleanup:** только после проверки всех 67 веток, связанных PR и уникальных изменений.

## Ограничения

- Полный diff всех 67 веток ещё не просмотрен; выполнено сравнение 18 наиболее релевантных веток и инвентаризация полного списка имён.
- Git compare показывает различия в истории/файлах, но сам по себе не доказывает, что конкретная логика отсутствует в main: она могла быть реализована иначе.
- CI по PR #56, #68 и #61 не запускался повторно в рамках этого аудита.
- Production deployment и production database migrations не выполнялись.
- Старые ветки не удалялись.
