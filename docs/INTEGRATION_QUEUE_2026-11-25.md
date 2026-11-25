# КВАРД — журнал консолидации основной ветки

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

Merge commit PR #67: `eca1aac1fcb4ef1c3f71363ef79a1c75bfc8c3da`.

## Крупные незавершённые интеграции

### NEXUM AGENTS — PR #56

Ссылка: https://github.com/borzenkoofficial-lab/nexum-dev/pull/56

- Содержит основу универсальных бизнес-агентов, организации/тенancy, версии агентов, инструменты, knowledge и workforce.
- PR открыт и помечен Draft.
- GitHub API на момент проверки возвращает `mergeable=false`.
- В обсуждении есть ошибка Vercel с лимитом бесплатных deployment в сутки. Это не следует путать с результатом GitHub Actions CI.
- В описании PR указано, что последние изменения требуют повторного CI.
- Следующий шаг: сверить схему миграций и runtime-контракты с текущим `main`, отдельно подтвердить CI. Не включать внешние side effects до реализации scope-level authorization.

### Durable Agent Runtime — PR #68

Ссылка: https://github.com/borzenkoofficial-lab/nexum-dev/pull/68

- Содержит PostgreSQL-backed lease queue, отдельный worker entrypoint, cancellation и fencing по lease owner.
- PR открыт; GitHub API возвращает `mergeable=false`.
- PR описывает зависимость от NEXUM AGENTS foundation (#56).
- Описание PR сообщает о прохождении API/Web checks, Docker smoke, PostgreSQL migrations и queue integration tests; browser E2E в описании ещё выполнялся.
- Следующий шаг: сначала привести foundation и queue к одной миграционной последовательности на актуальном `main`, затем повторить полный CI. Не переносить миграции поверх текущей схемы вслепую.

### Daytona Sandbox — PR #61

Ссылка: https://github.com/borzenkoofficial-lab/nexum-dev/pull/61

- Содержит интеграцию Daytona с текущим Coding Agent и очистку sandbox lifecycle.
- PR открыт; GitHub API возвращает `mergeable=false`.
- Описание PR сообщает о прохождении CI run #2678.
- Live smoke test заблокирован отсутствием серверного `DAYTONA_API_KEY`.
- Следующий шаг: сверить sandbox interfaces и Docker/local development compatibility на текущем `main`; провести live smoke test только после настройки секрета владельцем.

## Состояние веток

GitHub branch search вернул 67 веток, включая `main`. Это инвентаризация имён, а не доказательство, что каждая ветка содержит уникальную или нужную работу.

До удаления веток требуется:
1. Составить список всех открытых PR и связанных веток.
2. Для каждой ветки сравнить её с `main`: ahead/behind, уникальные commits и изменённые файлы.
3. Выделить уникальные изменения, не присутствующие в `main`.
4. Перенести необходимые изменения непосредственно в `main` с тестами.
5. Только после проверки отсутствия уникальных данных удалить устаревшие ветки.

## Ограничения текущей проверки

- Эта запись фиксирует состояние GitHub API и описания PR на указанную дату.
- CI по PR #56, #68 и #61 в этой проверке не запускался повторно.
- Наличие кода в PR не означает его наличие в `main`.
- Production deployment и production database migrations не выполнялись.
