# Развёртывание стенда

Как поднять `platform/` на сервере с HTTPS и как устроен автодеплой. Локальный запуск — [platform/README.md](../platform/README.md).

## Текущий стенд

| | |
| --- | --- |
| Адрес | https://fsp2.ru, проверка — `/api/health` |
| Сервер | Selectel, проект `fsp-lct-2026`, Москва (`ru-7a`): сервер `fsp-stand`, конфигурация `PRC50.2-4096` (2 vCPU с долей 50 %, 4 ГБ), сетевой диск 40 ГБ `basicssd`, Ubuntu 24.04 |
| Сеть | Плавающий адрес 90.156.158.121; группа безопасности `fsp-stand` пропускает внутрь только 22, 80, 443 и ICMP |
| Режим | Демо без ключей: `LLM_PROVIDER=stub`, `LLM_STUB_DEMO=true`, `COLLECTOR_FIXTURES=true`, `DEMO_LOGIN=true`. Языковая модель и вход через Яндекс ID не подключены |
| Поднят | 9 октября 2026 года |

Домен `fsp2.ru` (DNS у reg.ru) указывает A-записью на адрес сервера. `www.fsp2.ru` и прежние адреса — `fsp-stars.ru`, `www.fsp-stars.ru`, `90-156-158-121.sslip.io` — перенаправляются на основной (`SITE_REDIRECT_FROM`). При смене адреса сервера меняются A-записи домена и переменные `DEPLOY_HOST` и `DEPLOY_KNOWN_HOSTS` в GitHub; при смене домена — `SITE_ADDRESS` и `APP_URL` в `.env` и переменная `APP_URL` в GitHub.

Сервер оплачивается почасово с баланса аккаунта Selectel; при нехватке средств облачные ресурсы блокируются.

## Схема

```text
push в main (platform/**) → GitHub Actions → rsync platform/ на сервер → docker compose up -d --build
                                                                              │
Интернет ──443──► caddy (сертификат Let's Encrypt) ──► app :3000 ──► db (PostgreSQL 16)
                                                        │
                                                        └──► runner :8090 (сеть internal, без интернета)
                                                        migrate: миграции и сид перед стартом app
```

На сервере один каталог с исходниками `platform/` и файлом `.env`. Запуск — два файла Compose: `docker-compose.yml` (общий) и `docker-compose.prod.yml` (Caddy, без открытых портов приложения и почтового ящика). Образы собираются на сервере; реестр образов не нужен.

## Сервер

Ubuntu 24.04, от 2 vCPU и 4 ГБ памяти (сборка Next.js), 30 ГБ диска, белый IPv4, открыты порты 22, 80, 443. Домен должен указывать на адрес сервера до первого запуска: Caddy получает сертификат при старте. Своего домена нет — подойдёт `<IP через дефисы>.sslip.io`.

Подготовка чистого сервера, от root:

```bash
DEPLOY_PUBKEY='ssh-ed25519 AAAA… deploy' STAND_DOMAIN=<домен> bash stand-bootstrap.sh
```

[`platform/scripts/stand-bootstrap.sh`](../platform/scripts/stand-bootstrap.sh) ставит Docker Engine, создаёт пользователя `deploy` (группа `docker`, без sudo) с переданным ключом, каталог `/opt/fsp/platform`, swap 2 ГБ, включает ufw, ставит очистку кеша сборки по расписанию и пишет стартовый `.env` демо-режима без ключей. Повторный запуск ничего не ломает и существующий `.env` не трогает.

## Файл `.env` на сервере

Лежит в `/opt/fsp/platform/.env`, права 600, в репозиторий и в GitHub не попадает; автодеплой его не перезаписывает. Полный список переменных — [`.env.example`](../platform/.env.example). Для стенда обязательны:

| Переменная | Значение |
| --- | --- |
| `SITE_ADDRESS` | Домен стенда без схемы — адрес сайта для Caddy |
| `APP_URL` | `https://<домен>` — от него зависят флаг `Secure` у куки и redirect URI Яндекс ID |
| `SITE_REDIRECT_FROM` | Необязательно: имена через запятую (`www.<домен>`, прежний адрес), с которых Caddy перенаправляет на `SITE_ADDRESS`. Каждое должно указывать на сервер — для него тоже выпускается сертификат |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `DEMO_LOGIN` | `true`, пока стенд показывается жюри |
| `RUNNER_TOKEN` | Для автопроверки проектов (сервис `runner`): `openssl rand -hex 32`. Не задан — `runner` отвечает 503, остальной стенд работает |
| `SITE_PASSWORD` | Необязательно: пароль на сайт (без логина, страница `/site-access`). На стенде сейчас задан SHA-256 пароля в `docker-compose.prod.yml` (`SITE_PASSWORD_SHA256`, важнее `.env`): включается и снимается коммитом, без входа на сервер. Пароль оставлен (решение владельца 11.10 15:30), жюри получает его в [документе сдачи](submission/fsp-career.md) |
| `FSP_OIDC_ISSUER`, `FSP_OIDC_CLIENT_SECRET`, `FSP_API_URL`, `FSP_OIDC_DEMO_HINT` | Необязательно: вход и привязка ФСП ID через симулятор команды на Keycloak (`https://fsp-russia2.ru/auth/realms/fsp-id`, API — `https://fsp-russia2.ru/api/v1`) вместо встроенного мока. Секрет клиента `fsp-career` — в `.env` сервера симулятора (`FSP_CAREER_CLIENT_SECRET`). `FSP_OIDC_DEMO_HINT` — подсказка у кнопок, чем войти (демо-логин и пароль со стартовой страницы симулятора). Не заданы issuer или секрет — работает встроенный мок. Это симулятор, не сервис ФСП |

`DATABASE_URL` задаёт Compose. Почта: без `SMTP_HOST`/`SMTP_PORT` в `.env` письма идут в Mailpit стенда; для реальных ящиков задать `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` (`MAIL_PROVIDER=smtp`). Лимит созвонов с ИИ-интервьюером `CALL_DAILY_LIMIT` (за 24 часа на кандидата, дефолт в коде 5) на стенде ставим `0` — без лимита: жюри проходит созвон на демо-аккаунтах повторно. Языковая модель и вход через Яндекс ID включаются своими переменными; после правки `.env` — `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.

## Автодеплой

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) запускается при push в `main`, если изменился `platform/`, и вручную (Actions → Deploy stand → Run workflow). Два этапа:

- `build` — выгрузка `platform/` по rsync и `docker compose build` на сервере. Работающий стенд это не затрагивает, поэтому новый push отменяет сборку предыдущего запуска (в Actions он помечен как отменённый); прерванная сборка образы не подменяет.
- `release` — `docker compose up -d` (миграции, сид, пересоздание контейнеров) и проверка `GET /api/health`. Начатый перезапуск не отменяется, следующий запуск ждёт его конца.

Если сборка упала, прежние контейнеры продолжают работать, а запуск в Actions красный.

Настройки репозитория (Settings → Secrets and variables → Actions):

| Имя | Вид | Значение |
| --- | --- | --- |
| `DEPLOY_SSH_KEY` | секрет | Закрытый ключ пользователя `deploy` |
| `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` | секреты | Ключи приложения MESHWORK в Яндекс OAuth; используются только в ручном режиме настройки Яндекс ID |
| `DEPLOY_HOST` | переменная | Адрес сервера |
| `DEPLOY_USER` | переменная | `deploy` |
| `DEPLOY_PATH` | переменная | `/opt/fsp/platform` |
| `DEPLOY_KNOWN_HOSTS` | переменная | Строка `ssh-keyscan -t ed25519 <адрес>`, сверенная с ключом сервера |
| `APP_URL` | переменная | `https://<домен>` — для проверки после деплоя |

Сид выполняется при каждом деплое. Он идемпотентен: демо-аккаунты обновляются по фиксированным id, у синтетического пула кандидатов работодателя утверждения пересоздаются; данные остальных пользователей не затрагиваются.

Для подключения или замены ключей Яндекс ID сохранить обе переменные в GitHub
Actions Secrets и запустить `Deploy stand` с `configure_yandex_only=true`:

```bash
gh workflow run deploy.yml -f configure_yandex_only=true
```

Этот режим передаёт ключи через stdin SSH, атомарно обновляет только две строки
в серверном `.env` с правами 600 и пересоздаёт только `app` без сборки. Исходники,
миграции и сид не запускаются; остальные настройки `.env` сохраняются. Значения
ключей не выводятся в журнал. Скрипт обновления —
[`configure-yandex.sh`](../platform/scripts/configure-yandex.sh); ручная настройка
приложения Яндекса — [README платформы](../platform/README.md#вход-через-яндекс-id).

## Обслуживание

Команды — на сервере в `/opt/fsp/platform`; `dc` ниже — `docker compose -f docker-compose.yml -f docker-compose.prod.yml`.

| Задача | Команда |
| --- | --- |
| Состояние | `dc ps` |
| Журнал приложения | `dc logs -f app` |
| Журнал миграций и сида | `dc logs migrate` |
| Журнал автопроверки проектов | `dc logs -f runner`; состояние — `dc exec runner node -e "fetch('http://127.0.0.1:8090/health').then(r=>r.text()).then(console.log)"` |
| Перезапуск после правки `.env` | `dc up -d` |
| Откат | Вернуть коммит в `main` (`git revert`) — деплой выложит прежнюю версию. Миграции назад не откатываются |
| Почтовый ящик Mailpit | `ssh -L 8025:127.0.0.1:8025 <сервер>`, затем http://localhost:8025 |
| Резервная копия базы | `dc exec db pg_dump -U fsp fsp > backup.sql` |
| Место на диске | `df -h /` и `docker system df`. Кеш сборки урезается до 3 ГБ после каждого деплоя и раз в полчаса (`/etc/cron.d/fsp-docker-prune`) |

## Симулятор ФСП: второй сервер

[`fsp-sim/`](../fsp-sim/README.md) (ФСП ID на Keycloak и API реестра) живёт на отдельном сервере того же проекта Selectel, чтобы Keycloak не делил 4 ГБ со стендом жюри.

| | |
| --- | --- |
| Адрес | https://fsp-russia2.ru, проверка — `/api/v1/health`; A-записи домена (DNS у reg.ru) указывают на адрес сервера. `www.fsp-russia2.ru` и прежний адрес `111-88-114-206.sslip.io` перенаправляются на основной (`REDIRECT_FROM`) |
| Сервер | `fsp-id`, `PRC50.2-4096`, сетевой диск 30 ГБ `basicssd`, Ubuntu 24.04, зона `ru-7a`, сеть `fsp-net`, группа безопасности `fsp-stand` (22, 80, 443), плавающий адрес 111.88.114.206 |
| Создан | 10 октября 2026 года скриптом [`fsp-sim/scripts/selectel-server.sh`](../fsp-sim/scripts/selectel-server.sh) через API Selectel (диск из образа → сервер → группа безопасности на порту → плавающий адрес) |
| Подготовка | [`fsp-sim/scripts/bootstrap-server.sh`](../fsp-sim/scripts/bootstrap-server.sh) от root: Docker Engine, пользователь `deploy`, `/opt/fsp/fsp-sim`, swap 2 ГБ, ufw |
| Деплой | Вручную: `DEPLOY_HOST=deploy@111.88.114.206 SSH_OPTS='-i ~/.ssh/fsp-id' bash scripts/deploy.sh` из `fsp-sim/` — rsync каталога и `docker compose up -d --build`, затем проверка health. GitHub Actions этот каталог не выкладывает |
| `.env` | `/opt/fsp/fsp-sim/.env` (600): `PUBLIC_URL`, `REDIRECT_FROM`, пароли администратора Keycloak и базы, `FSP_CAREER_CLIENT_SECRET`, `FSP_REGISTRY_ADMIN_SECRET` (сгенерированы на сервере, в репозитории нет); `FSP_PARTNER_DEMO_SECRET` и `FSP_DEMO_PASSWORD` — значения по умолчанию из `.env.example` (публичные демо-данные) |
| Обновить реалм | Импорт идёт только в пустую базу. Пересоздать только базу Keycloak, не трогая том с сертификатами: `docker compose rm -sf keycloak db && docker volume rm fsp-sim_db-data && docker compose up -d --build` (сбросит сессии ФСП ID). Пользователей-спортсменов API сверяет с реестром сам при старте. Тему страниц входа и языки реалма применяет без пересоздания базы `bash scripts/apply-realm-settings.sh` |
| Данные | Тома Docker: `db-data` — база Keycloak, `api-state` — ручные правки песочницы стартовой страницы, `caddy-data` — сертификаты. Резервных копий нет |
| Журналы | `docker compose logs -f keycloak`, `docker compose logs -f api` в `/opt/fsp/fsp-sim` |

Issuer токенов привязан к `PUBLIC_URL`: при смене домена симулятора вместе с `PUBLIC_URL` меняются `FSP_OIDC_ISSUER` и `FSP_API_URL` в `.env` стенда, иначе вход и привязка ФСП ID на стенде перестают работать.

Сервер оплачивается почасово с того же баланса, что и стенд.

## Ограничения

- Сеть `runner-net` задана с `com.docker.network.bridge.gateway_mode_ipv4: isolated` — нужен Docker Engine ≥ 28 (проверено на 29.8; что сделает движок старше 28 — отклонит опцию или молча проигнорирует, оставив мост с адресом на хосте, — не проверено). Проверить: `docker version --format '{{.Server.Version}}'`.
- `runner` берёт до 1,5 ГБ памяти и 0,8 CPU на время проверки проекта (одна за раз); на сервере 2 vCPU × 50 % и 4 ГБ стенд в это время заметно медленнее. Первая сборка образа `runner` ставит пакеты npm и pip — несколько минут.
- Один сервер без резервирования; при пересоздании контейнера `app` стенд несколько секунд отвечает 502.
- База — в томе Docker `db-data` на том же сервере, резервные копии по расписанию не настроены.
- Оригиналы файлов кандидатов — `UPLOAD_DIR=/app/data/uploads` в томе `app-data` (там же аудио созвонов); переживают пересборку, удаляются вместе с томом. Резервных копий нет.
- Пароль базы `fsp` задан в `docker-compose.yml`; порт базы наружу не опубликован.
- `next build` в образе идёт с заглушками `DATABASE_URL` и `SESSION_SECRET` (`Dockerfile`): корневой макет читает окружение при пререндере. Все страницы рендерятся по запросу, поэтому настройки из `.env` действуют без пересборки; статическая страница, если появится, запомнит значения сборки.
