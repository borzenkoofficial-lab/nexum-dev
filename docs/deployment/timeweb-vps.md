# Развёртывание КВАРД на Timeweb Cloud VPS

## Выбранная production-схема

Для основной версии КВАРД используется **Timeweb Cloud VPS + Docker Compose**, а не App Platform:

- один контейнер API + собранный web-клиент;
- постоянная директория хоста `/srv/kvard/data`, смонтированная в `/app/runtime`;
- управляемый PostgreSQL Timeweb Cloud вне контейнера;
- Caddy как reverse proxy с автоматическим HTTPS;
- Daytona как изолированная среда выполнения пользовательского кода;
- GitHub `main` как единственный источник production-релизов.

### Почему не App Platform для основной версии

App Platform пересоздаёт контейнер при деплое, а данные внутри него не сохраняются. В Docker Compose App Platform также запрещает директиву `volumes`. KVARD хранит пользовательские проекты, файлы и checkpoints на файловой системе, поэтому такой режим без предварительного переноса workspace-хранилища в постоянное внешнее хранилище небезопасен для production.

Официальные материалы:
- [Docker Compose в App Platform](https://timeweb.cloud/docs/apps/deploying-with-docker-compose)
- [Особенности сохранения данных App Platform](https://timeweb.cloud/docs/apps/how-it-works)
- [Облачные серверы Timeweb Cloud](https://timeweb.cloud/docs/cloud-servers)
- [Подключение к PostgreSQL Timeweb Cloud](https://timeweb.cloud/docs/dbaas/postgresql/connect-to-database)

## Что уже подготовлено в репозитории

- `Dockerfile` собирает API и web в одном production-образе.
- SQL-файлы миграций копируются в runtime-образ отдельно: TypeScript-компиляция сама по себе не переносит SQL assets.
- `scripts/start-production.sh` применяет ожидающие миграции при наличии `NEXUM_DATABASE_URL`, затем запускает API.
- `docker-compose.yml` поднимает API и Caddy, хранит runtime-данные на постоянном диске VPS и проверяет готовность API вместе с PostgreSQL.
- `deploy/timeweb/Caddyfile` настраивает HTTPS reverse proxy.
- `scripts/deploy-timeweb.sh` обновляет только чистую ветку `main`, проверяет Compose-конфигурацию, собирает образ и ждёт успешного HTTPS health check.
- Web-приложение отдаётся тем же API-сервисом; отдельный публичный web-контейнер не нужен.
- Production sandbox явно настроен на Daytona: локальный Docker sandbox не включается внутри production-контейнера.

## 1. Создать ресурсы в Timeweb Cloud

1. Создать Cloud VPS с Ubuntu 24.04 LTS. Для удобства можно выбрать образ Docker из маркетплейса Timeweb, если он доступен в выбранном регионе.
2. Создать отдельный Managed PostgreSQL в том же регионе.
3. Создать базу и отдельного пользователя приложения с правами на схему KVARD.
4. Включить TLS для PostgreSQL и разрешить подключение с публичного IP VPS либо использовать поддерживаемый Timeweb способ сетевого подключения.
5. Сохранить строку подключения PostgreSQL и CA-сертификат, если он требуется настройками кластера.
6. Подготовить домен: A-запись должна указывать на публичный IPv4 VPS. Если публикуется AAAA, IPv6 также должен быть корректно настроен.
7. Разрешить входящий TCP 80/443 для Caddy и SSH только с доверенных адресов.

Не создавать PostgreSQL внутри контейнера приложения и не хранить базу в каталоге runtime.

## 2. Подготовить VPS

На сервере должны быть установлены Git, Docker Engine с Compose v2 и curl.

Создать пользователя для деплоя с доступом к Docker. Затем:

```bash
sudo mkdir -p /srv/kvard/data
sudo chown -R 1000:1000 /srv/kvard/data
git clone https://github.com/borzenkoofficial-lab/nexum-dev.git
cd nexum-dev
git checkout main
```

UID/GID 1000 используется контейнером API (пользователь `node`). Не монтировать Docker socket внутрь API-контейнера.

## 3. Настроить переменные

Создать Compose env-файл:

```bash
cp deploy/timeweb/compose.env.example .env
```

В `.env` указать реальный домен и каталог данных.

Создать production env-файл:

```bash
cp deploy/timeweb/env.production.example .env.production
chmod 600 .env .env.production
```

Заполнить обязательные значения:

- `NEXUM_DATABASE_URL` — строка подключения к Managed PostgreSQL Timeweb;
- `NEXUM_AUTH_SECRET` — уникальный случайный секрет;
- `AI_PROVIDER` и ключ выбранного реального провайдера;
- `AI_PROVIDER_ENCRYPTION_KEY` — случайная строка не короче 32 символов;
- `KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY` — base64 от 32 случайных байт;
- `NEXUM_SANDBOX_PROVIDER=daytona` и `DAYTONA_API_KEY`;
- `NEXUM_CORS_ORIGINS` — production origin KVARD.

Пример генерации секретов:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

Первую команду использовать для `NEXUM_AUTH_SECRET` и отдельного `AI_PROVIDER_ENCRYPTION_KEY`. Вторую — для `KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY`. Для каждого назначения генерировать отдельное значение.

Если Timeweb выдаёт CA-сертификат PostgreSQL, поместить его PEM-содержимое в `NEXUM_DB_CA`; не отключать проверку TLS ради обхода ошибки сертификата.

Никогда не добавлять `.env`, `.env.production`, ключи API или сертификаты с приватными ключами в Git.

## 4. Первый запуск

Перед запуском убедиться, что:

- DNS уже указывает на VPS;
- порты 80 и 443 доступны извне;
- Managed PostgreSQL доступен с VPS;
- все обязательные переменные заполнены;
- каталог `/srv/kvard/data` принадлежит UID/GID 1000.

Проверить Compose:

```bash
docker compose config --quiet
```

Первый запуск:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f api caddy
```

При старте API запускает миграции из `apps/api/db/migrations`. Миграции имеют собственный журнал версий и проверку checksum; изменённые уже применённые миграции должны приводить к ошибке, а не молча переигрываться.

Caddy выпускает сертификат Let's Encrypt после того, как домен направлен на VPS и порты доступны.

Проверка:

```bash
curl --fail https://YOUR_DOMAIN/api/health
```

Ожидается JSON со `"status":"ok"` и `"database":{"ok":true}`. Статус `degraded` не считается успешным production-запуском.

## 5. Последующие обновления — одна команда

После первичной настройки и успешного запуска:

```bash
./scripts/deploy-timeweb.sh
```

Скрипт:
1. останавливается при незакоммиченных изменениях; разрешает деплой только из `main` (после отката сам возвращается на `main`);
2. получает свежий `main` через fast-forward only;
3. собирает образ `kvard-api:<commit>`: каждый релиз — отдельный образ с версией внутри (`/api/build-info`, заголовок `X-Kvard-Release`);
4. запускает его и ждёт, пока домен начнёт отдавать именно этот релиз;
5. прогоняет `scripts/smoke-production.sh`: health и PostgreSQL, совпадение релиза, отдача SPA, `Cache-Control: no-store` для `index.html`, заголовки безопасности, `401` для защищённого API, отсутствие test-эндпоинтов;
6. при успехе записывает релиз в `.deploy/current-release` и оставляет 3 последних образа для отката;
7. **при неуспехе автоматически откатывается** на предыдущий релиз (запуск существующего образа без пересборки, повторный smoke) и завершается с ошибкой.

Smoke-проверку можно запустить отдельно в любой момент:

```bash
./scripts/smoke-production.sh https://YOUR_DOMAIN
```

Для запуска команды у deploy-пользователя должны быть права на Docker, Git и каталог данных.

### Откат

- **Автоматический** — выполняет `deploy-timeweb.sh`, если новый релиз не прошёл smoke.
- **Ручной** — на релиз, образ которого ещё хранится (`docker image ls kvard-api`):

```bash
git checkout --detach <commit>
KVARD_RELEASE=<commit> docker compose up -d --no-build --remove-orphans
./scripts/smoke-production.sh https://YOUR_DOMAIN <commit>
```

Миграции применяются при старте и не откатываются. Откат запускает старый код на более новой схеме. Это безопасно, пока миграции не удаляют и не переименовывают таблицы, колонки и данные. Миграции `001`–`024` это условие соблюдают (проверено 2026-11-27): они добавляют объекты, пересоздают ограничения и триггеры и заполняют новые колонки. Миграция, которая удаляет или переименовывает данные, требует отдельного плана отката до её выпуска.

## 6. Данные и резервное копирование

Критичные данные: PostgreSQL (пользователи, сессии, задачи, биллинг) и `/srv/kvard/data` (проекты, checkpoints). Не удалять этот каталог при обновлении и не выполнять `docker compose down -v` как обычный перезапуск.

### Резервная копия

```bash
./scripts/backup-timeweb.sh
```

- `database.dump` — `pg_dump` в custom-формате. Клиент PostgreSQL запускается в контейнере `postgres:16`, строка подключения передаётся через окружение и не попадает в список процессов. TLS к Managed PostgreSQL обязателен (`PGSSLMODE=require`).
- `data.tar.gz` — каталог данных без `node_modules` и `dist`: они восстанавливаются сборкой.
- `SHA256SUMS` и `backup.info` (время и релиз).
- Копии кладутся в `/srv/kvard/backups/<UTC-время>/` с правами `700/600`. Копии старше 14 дней удаляются (`KVARD_BACKUP_RETENTION_DAYS`).
- Копия вне VPS: настроить на сервере `rclone` с Timeweb S3 и задать `KVARD_BACKUP_RCLONE_REMOTE=<remote>:<bucket>`. Хранить копии только на VPS недостаточно.

Ежедневный запуск через cron deploy-пользователя:

```cron
17 3 * * * cd /home/deploy/nexum-dev && ./scripts/backup-timeweb.sh >> /srv/kvard/backups/backup.log 2>&1
```

Дополнительно включить автоматические бэкапы Managed PostgreSQL и снапшоты диска VPS в панели Timeweb.

### Проверка восстановления (restore drill)

```bash
./scripts/restore-drill.sh /srv/kvard/backups/<UTC-время>
```

Production при этом не затрагивается. Скрипт:
- сверяет контрольные суммы;
- восстанавливает базу в одноразовый PostgreSQL;
- проверяет журнал миграций и ключевые таблицы;
- распаковывает архив проектов во временный каталог.

Проводить после настройки и затем регулярно (например, раз в месяц) и фиксировать результат.

### Восстановление production (только по решению владельца)

1. Остановить API: `docker compose stop api`.
2. Восстановить базу в Managed PostgreSQL: `pg_restore --clean --if-exists --no-owner -d "$NEXUM_DATABASE_URL" database.dump` (из контейнера `postgres:16`). Предварительно сделать свежую копию текущего состояния.
3. Восстановить файлы: распаковать `data.tar.gz` в `/srv/kvard/data` (владелец UID/GID 1000).
4. Запустить API и прогнать `scripts/smoke-production.sh`.

## 6a. Мониторинг

- **Доступность (обязательно):** внешний uptime-мониторинг `https://YOUR_DOMAIN/api/ready` раз в минуту с уведомлением в Telegram или на почту (подойдёт мониторинг Timeweb или любой внешний сервис). `/api/ready` отвечает `503`, если API не видит PostgreSQL. `/api/health` всегда отвечает `200` (liveness для Docker), его статус — в теле.
- **Метрики:** `GET /api/metrics` в формате Prometheus. Включается переменной `KVARD_METRICS_TOKEN` (без неё — `404`), запрос с заголовком `Authorization: Bearer <token>`. Что собирается:
  - HTTP-запросы и задержки по группам маршрутов;
  - исходы и длительность задач Builder;
  - успехи и ошибки AI-провайдеров;
  - сбои создания sandbox и уборка осиротевших sandbox;
  - отказы по лимитам тарифа;
  - доступность БД;
  - память, uptime и релиз.

  Метки ограничены: в метриках нет id пользователей, проектов и задач.
- **Алерты:** `deploy/monitoring/alerts.yml`, правила Prometheus (CI проверяет их `promtool`): API или БД недоступны, доля 5xx, медленный API проектов, ошибки AI-провайдера, массовые провалы задач, сбои sandbox, неудачная уборка sandbox, перезапуск процесса. Пороги стартовые, их нужно подстроить по реальному трафику.
- **Логи:** `docker compose logs api`, ротация 20 МБ × 5. События безопасности — JSON-строки с `"type":"security"`: `docker compose logs api | grep '"type":"security"'`.
- **Нагрузка:** `node scripts/load-test.mjs --url <staging-url> --users 30 --duration 20 --sse 100`. Скрипт создаёт тестовых пользователей, поэтому против production запускать только с согласия владельца. Последние результаты — в `docs/AUDIT_2026-11-26.md`, раздел 12.

## 7. Ограничения текущей архитектуры

- Приложение использует локальную файловую систему для workspace, snapshots/checkpoints и части служебных данных. Поэтому на первом production-этапе используется один API-инстанс с постоянным диском. Горизонтальное масштабирование на несколько независимых VPS без отдельного shared workspace storage и распределённой координации задач не включать.
- Для выполнения пользовательского кода используется Daytona. Не передавать Docker socket приложению и не запускать сгенерированный код внутри основного API-контейнера.
- При отсутствии `NEXUM_DATABASE_URL` entrypoint пропускает миграции, но Compose health check не пропустит сервис в healthy state: база обязательна для production.
- Проверка health подтверждает доступность API и PostgreSQL, но не заменяет отдельные сквозные проверки регистрации, Builder, AI-провайдера, sandbox и восстановления проектов.

## 8. Критерии допуска к публичному запуску

- [ ] CI на актуальном `main` успешно проходит typecheck, tests, builds и Docker smoke test.
- [ ] Production Docker image собирается и запускается на чистом VPS.
- [ ] Все миграции применены; повторный запуск не меняет схему и не дублирует данные.
- [ ] PostgreSQL доступен по TLS.
- [ ] `/api/health` возвращает `status=ok`.
- [ ] HTTPS-сертификат действителен, HTTP перенаправляется/обслуживается через Caddy.
- [ ] Пользовательский проект переживает перезапуск и пересборку контейнера.
- [ ] Daytona создаёт sandbox, выполняет разрешённые команды и возвращает preview.
- [ ] `backup-timeweb.sh` настроен в cron, копия выгружается вне VPS, `restore-drill.sh` пройден на production-копии.
- [ ] `deploy-timeweb.sh` выполнил деплой и smoke-проверку; ручной откат на предыдущий образ проверен.
- [ ] Проверены регистрация, вход, создание проекта, изменение проекта агентом, отмена задачи и восстановление после перезапуска.

**Текущий статус (2026-11-27):** пакет деплоя подготовлен. Проверено вне Timeweb:
- `smoke-production.sh` — против API в production-режиме за Caddy с этим Caddyfile;
- `backup-timeweb.sh` + `restore-drill.sh` — на PostgreSQL 16 и реальном каталоге проектов, три прогона подряд, подменённый архив ловится;
- логика отката `deploy-timeweb.sh` — с заглушками docker/curl: провал нового релиза → откат и exit 1, затем успешный деплой с возвратом на `main`.

Реальный запуск на Timeweb, домен, Managed PostgreSQL, Daytona и restore drill на production-копии требуют доступа к аккаунту и секретам владельца.
