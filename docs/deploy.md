# Развёртывание стенда

Как поднять `platform/` на сервере с HTTPS и как устроен автодеплой. Локальный запуск — [platform/README.md](../platform/README.md).

## Текущий стенд

| | |
| --- | --- |
| Адрес | https://fsp-stars.ru, проверка — `/api/health` |
| Сервер | Selectel, проект `fsp-lct-2026`, Москва (`ru-7a`): сервер `fsp-stand`, конфигурация `PRC50.2-4096` (2 vCPU с долей 50 %, 4 ГБ), сетевой диск 40 ГБ `basicssd`, Ubuntu 24.04 |
| Сеть | Плавающий адрес 90.156.158.121; группа безопасности `fsp-stand` пропускает внутрь только 22, 80, 443 и ICMP |
| Режим | Демо без ключей: `LLM_PROVIDER=stub`, `LLM_STUB_DEMO=true`, `COLLECTOR_FIXTURES=true`, `DEMO_LOGIN=true`. Языковая модель и вход через Яндекс ID не подключены |
| Поднят | 9 октября 2026 года |

Домен `fsp-stars.ru` (DNS у reg.ru) указывает A-записью на адрес сервера. `www.fsp-stars.ru` и прежний адрес `90-156-158-121.sslip.io` перенаправляются на основной (`SITE_REDIRECT_FROM`). При смене адреса сервера меняются A-записи домена и переменные `DEPLOY_HOST` и `DEPLOY_KNOWN_HOSTS` в GitHub; при смене домена — `SITE_ADDRESS` и `APP_URL` в `.env` и переменная `APP_URL` в GitHub.

Сервер оплачивается почасово с баланса аккаунта Selectel; при нехватке средств облачные ресурсы блокируются.

## Схема

```text
push в main (platform/**) → GitHub Actions → rsync platform/ на сервер → docker compose up -d --build
                                                                              │
Интернет ──443──► caddy (сертификат Let's Encrypt) ──► app :3000 ──► db (PostgreSQL 16)
                                                        migrate: миграции и сид перед стартом app
```

На сервере один каталог с исходниками `platform/` и файлом `.env`. Запуск — два файла Compose: `docker-compose.yml` (общий) и `docker-compose.prod.yml` (Caddy, без открытых портов приложения и почтового ящика). Образы собираются на сервере; реестр образов не нужен.

## Сервер

Ubuntu 24.04, от 2 vCPU и 4 ГБ памяти (сборка Next.js), 30 ГБ диска, белый IPv4, открыты порты 22, 80, 443. Домен должен указывать на адрес сервера до первого запуска: Caddy получает сертификат при старте. Своего домена нет — подойдёт `<IP через дефисы>.sslip.io`.

Подготовка чистого сервера, от root:

```bash
DEPLOY_PUBKEY='ssh-ed25519 AAAA… deploy' STAND_DOMAIN=<домен> bash stand-bootstrap.sh
```

[`platform/scripts/stand-bootstrap.sh`](../platform/scripts/stand-bootstrap.sh) ставит Docker Engine, создаёт пользователя `deploy` (группа `docker`, без sudo) с переданным ключом, каталог `/opt/fsp/platform`, swap 2 ГБ, включает ufw и пишет стартовый `.env` демо-режима без ключей. Повторный запуск ничего не ломает и существующий `.env` не трогает.

## Файл `.env` на сервере

Лежит в `/opt/fsp/platform/.env`, права 600, в репозиторий и в GitHub не попадает; автодеплой его не перезаписывает. Полный список переменных — [`.env.example`](../platform/.env.example). Для стенда обязательны:

| Переменная | Значение |
| --- | --- |
| `SITE_ADDRESS` | Домен стенда без схемы — адрес сайта для Caddy |
| `APP_URL` | `https://<домен>` — от него зависят флаг `Secure` у куки и redirect URI Яндекс ID |
| `SITE_REDIRECT_FROM` | Необязательно: имена через запятую (`www.<домен>`, прежний адрес), с которых Caddy перенаправляет на `SITE_ADDRESS`. Каждое должно указывать на сервер — для него тоже выпускается сертификат |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `DEMO_LOGIN` | `true`, пока стенд показывается жюри |

`DATABASE_URL` задаёт Compose. Языковая модель и вход через Яндекс ID включаются своими переменными; после правки `.env` — `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.

## Автодеплой

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) запускается при push в `main`, если изменился `platform/`, и вручную (Actions → Deploy stand → Run workflow). Шаги: выгрузка `platform/` по rsync, `docker compose up -d --build`, проверка `GET /api/health`. Если сборка упала, прежние контейнеры продолжают работать, а запуск в Actions красный.

Настройки репозитория (Settings → Secrets and variables → Actions):

| Имя | Вид | Значение |
| --- | --- | --- |
| `DEPLOY_SSH_KEY` | секрет | Закрытый ключ пользователя `deploy` |
| `DEPLOY_HOST` | переменная | Адрес сервера |
| `DEPLOY_USER` | переменная | `deploy` |
| `DEPLOY_PATH` | переменная | `/opt/fsp/platform` |
| `DEPLOY_KNOWN_HOSTS` | переменная | Строка `ssh-keyscan -t ed25519 <адрес>`, сверенная с ключом сервера |
| `APP_URL` | переменная | `https://<домен>` — для проверки после деплоя |

Сид выполняется при каждом деплое. Он идемпотентен: демо-аккаунты обновляются по фиксированным id, у синтетического пула кандидатов работодателя утверждения пересоздаются; данные остальных пользователей не затрагиваются.

## Обслуживание

Команды — на сервере в `/opt/fsp/platform`; `dc` ниже — `docker compose -f docker-compose.yml -f docker-compose.prod.yml`.

| Задача | Команда |
| --- | --- |
| Состояние | `dc ps` |
| Журнал приложения | `dc logs -f app` |
| Журнал миграций и сида | `dc logs migrate` |
| Перезапуск после правки `.env` | `dc up -d` |
| Откат | Вернуть коммит в `main` (`git revert`) — деплой выложит прежнюю версию. Миграции назад не откатываются |
| Почтовый ящик Mailpit | `ssh -L 8025:127.0.0.1:8025 <сервер>`, затем http://localhost:8025 |
| Резервная копия базы | `dc exec db pg_dump -U fsp fsp > backup.sql` |

## Ограничения

- Один сервер без резервирования; при пересоздании контейнера `app` стенд несколько секунд отвечает 502.
- База — в томе Docker `db-data` на том же сервере, резервные копии по расписанию не настроены.
- Пароль базы `fsp` задан в `docker-compose.yml`; порт базы наружу не опубликован.
- `next build` в образе идёт с заглушками `DATABASE_URL` и `SESSION_SECRET` (`Dockerfile`): корневой макет читает окружение при пререндере. Все страницы рендерятся по запросу, поэтому настройки из `.env` действуют без пересборки; статическая страница, если появится, запомнит значения сборки.
