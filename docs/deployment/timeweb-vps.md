# Развёртывание КВАРД на Timeweb Cloud VPS

## Выбранная production-схема

Для основной версии КВАРД используется **Timeweb Cloud VPS + Docker Compose**, а не App Platform:

- один контейнер API + собранный web-клиент;
- постоянная директория хоста \`/srv/kvard/data\`, смонтированная в \`/app/runtime\`;
- управляемый PostgreSQL Timeweb Cloud вне контейнера;
- Caddy как reverse proxy с автоматическим HTTPS;
- Daytona как изолированная среда выполнения пользовательского кода;
- GitHub \`main\` как единственный источник production-релизов.

### Почему не App Platform для основной версии

App Platform пересоздаёт контейнер при деплое, а данные внутри него не сохраняются. В Docker Compose App Platform также запрещает директиву \`volumes\`. KVARD хранит пользовательские проекты, файлы и checkpoints на файловой системе, поэтому такой режим без предварительного переноса workspace-хранилища в постоянное внешнее хранилище небезопасен для production.

Официальные материалы:
- [Docker Compose в App Platform](https://timeweb.cloud/docs/apps/deploying-with-docker-compose)
- [Особенности сохранения данных App Platform](https://timeweb.cloud/docs/apps/how-it-works)
- [Облачные серверы Timeweb Cloud](https://timeweb.cloud/docs/cloud-servers)
- [Подключение к PostgreSQL Timeweb Cloud](https://timeweb.cloud/docs/dbaas/postgresql/connect-to-database)

## Что уже подготовлено в репозитории

- \`Dockerfile\` собирает API и web в одном production-образе.
- SQL-файлы миграций копируются в runtime-образ отдельно: TypeScript-компиляция сама по себе не переносит SQL assets.
- \`scripts/start-production.sh\` применяет ожидающие миграции при наличии \`NEXUM_DATABASE_URL\`, затем запускает API.
- \`docker-compose.yml\` поднимает API и Caddy, хранит runtime-данные на постоянном диске VPS и проверяет готовность API вместе с PostgreSQL.
- \`deploy/timeweb/Caddyfile\` настраивает HTTPS reverse proxy.
- \`scripts/deploy-timeweb.sh\` обновляет только чистую ветку \`main\`, проверяет Compose-конфигурацию, собирает образ и ждёт успешного HTTPS health check.
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

\`\`\`bash
sudo mkdir -p /srv/kvard/data
sudo chown -R 1000:1000 /srv/kvard/data
git clone https://github.com/borzenkoofficial-lab/nexum-dev.git
cd nexum-dev
git checkout main
\`\`\`

UID/GID 1000 используется контейнером API (пользователь \`node\`). Не монтировать Docker socket внутрь API-контейнера.

## 3. Настроить переменные

Создать Compose env-файл:

\`\`\`bash
cp deploy/timeweb/compose.env.example .env
\`\`\`

В \`.env\` указать реальный домен и каталог данных.

Создать production env-файл:

\`\`\`bash
cp deploy/timeweb/env.production.example .env.production
chmod 600 .env .env.production
\`\`\`

Заполнить обязательные значения:

- \`NEXUM_DATABASE_URL\` — строка подключения к Managed PostgreSQL Timeweb;
- \`NEXUM_AUTH_SECRET\` — уникальный случайный секрет;
- \`AI_PROVIDER\` и ключ выбранного реального провайдера;
- \`AI_PROVIDER_ENCRYPTION_KEY\` — случайная строка не короче 32 символов;
- \`KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY\` — base64 от 32 случайных байт;
- \`NEXUM_SANDBOX_PROVIDER=daytona\` и \`DAYTONA_API_KEY\`;
- \`NEXUM_CORS_ORIGINS\` — production origin KVARD.

Пример генерации секретов:

\`\`\`bash
openssl rand -hex 32
openssl rand -base64 32
\`\`\`

Первую команду использовать для \`NEXUM_AUTH_SECRET\` и отдельного \`AI_PROVIDER_ENCRYPTION_KEY\`. Вторую — для \`KVARD_AGENT_CHECKPOINT_ENCRYPTION_KEY\`. Для каждого назначения генерировать отдельное значение.

Если Timeweb выдаёт CA-сертификат PostgreSQL, поместить его PEM-содержимое в \`NEXUM_DB_CA\`; не отключать проверку TLS ради обхода ошибки сертификата.

Никогда не добавлять \`.env\`, \`.env.production\`, ключи API или сертификаты с приватными ключами в Git.

## 4. Первый запуск

Перед запуском убедиться, что:

- DNS уже указывает на VPS;
- порты 80 и 443 доступны извне;
- Managed PostgreSQL доступен с VPS;
- все обязательные переменные заполнены;
- каталог \`/srv/kvard/data\` принадлежит UID/GID 1000.

Проверить Compose:

\`\`\`bash
docker compose config --quiet
\`\`\`

Первый запуск:

\`\`\`bash
docker compose up -d --build
docker compose ps
docker compose logs -f api caddy
\`\`\`

При старте API запускает миграции из \`apps/api/db/migrations\`. Миграции имеют собственный журнал версий и проверку checksum; изменённые уже применённые миграции должны приводить к ошибке, а не молча переигрываться.

Caddy выпускает сертификат Let's Encrypt после того, как домен направлен на VPS и порты доступны.

Проверка:

\`\`\`bash
curl --fail https://YOUR_DOMAIN/api/health
\`\`\`

Ожидается JSON со \`"status":"ok"\` и \`"database":{"ok":true}\`. Статус \`degraded\` не считается успешным production-запуском.

## 5. Последующие обновления — одна команда

После первичной настройки и успешного запуска:

\`\`\`bash
./scripts/deploy-timeweb.sh
\`\`\`

Скрипт:
1. запрещает деплой не из \`main\`;
2. останавливается при незакоммиченных локальных изменениях;
3. получает свежий \`main\` через fast-forward only;
4. валидирует Docker Compose;
5. собирает и обновляет контейнеры;
6. ожидает доступность production health endpoint;
7. при ошибке выводит последние логи API и Caddy.

Для запуска команды у deploy-пользователя должны быть права на Docker, Git и каталог данных.

## 6. Данные и резервное копирование

Критичные пользовательские данные находятся в \`/srv/kvard/data\`. Не удалять этот каталог при обновлении. Не выполнять \`docker compose down -v\` как обычный способ перезапуска.

Обязательная схема защиты данных перед публичным запуском:

- включить автоматические резервные копии VPS-диска в панели Timeweb;
- включить резервное копирование Managed PostgreSQL;
- дополнительно выгружать копию каталога \`/srv/kvard/data\` во внешнее объектное хранилище;
- хранить копии отдельно от основного VPS;
- периодически проверять восстановление и целостность копий.

Снапшот VPS не заменяет отдельный backup PostgreSQL и проверку восстановления файлов.

## 7. Ограничения текущей архитектуры

- Приложение использует локальную файловую систему для workspace, snapshots/checkpoints и части служебных данных. Поэтому на первом production-этапе используется один API-инстанс с постоянным диском. Горизонтальное масштабирование на несколько независимых VPS без отдельного shared workspace storage и распределённой координации задач не включать.
- Для выполнения пользовательского кода используется Daytona. Не передавать Docker socket приложению и не запускать сгенерированный код внутри основного API-контейнера.
- При отсутствии \`NEXUM_DATABASE_URL\` entrypoint пропускает миграции, но Compose health check не пропустит сервис в healthy state: база обязательна для production.
- Проверка health подтверждает доступность API и PostgreSQL, но не заменяет отдельные сквозные проверки регистрации, Builder, AI-провайдера, sandbox и восстановления проектов.

## 8. Критерии допуска к публичному запуску

- [ ] CI на актуальном \`main\` успешно проходит typecheck, tests, builds и Docker smoke test.
- [ ] Production Docker image собирается и запускается на чистом VPS.
- [ ] Все миграции применены; повторный запуск не меняет схему и не дублирует данные.
- [ ] PostgreSQL доступен по TLS.
- [ ] \`/api/health\` возвращает \`status=ok\`.
- [ ] HTTPS-сертификат действителен, HTTP перенаправляется/обслуживается через Caddy.
- [ ] Пользовательский проект переживает перезапуск и пересборку контейнера.
- [ ] Daytona создаёт sandbox, выполняет разрешённые команды и возвращает preview.
- [ ] Backup файлов и БД создан и тестовое восстановление проверено.
- [ ] Проверены регистрация, вход, создание проекта, изменение проекта агентом, отмена задачи и восстановление после перезапуска.

**Текущий статус:** deployment scaffolding подготовлен в репозитории; реальный запуск на Timeweb, подключение домена/БД/Daytona и restore drill требуют доступа к аккаунту и секретам владельца.
