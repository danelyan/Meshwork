# Симулятор ФСП: ФСП ID и API реестра достижений

Отдельный сервис для демонстрации интеграции платформы с Федерацией спортивного программирования:
**ФСП ID** на Keycloak и **API реестра** (спортсмены, соревнования, протоколы, достижения, разряды,
согласия) на синтетических данных. Опубликован на https://111-88-114-206.sslip.io (Selectel, сервер `fsp-id`).

> **Это не сервис ФСП и не интеграция с ним.** По ТЗ ни API, ни схема реестра ФСП не предоставляются
> ([docs/fsp-integration.md](../docs/fsp-integration.md)). Контракт ниже — предложение команды, данные —
> детерминированно сгенерированные (120 вымышленных спортсменов). Каждый ответ несёт `meta.simulator: true`
> и заголовок `X-FSP-Simulator: true`; стартовая страница и OpenAPI говорят то же. В пич и документы
> симулятор попадает только с этой оговоркой (AGENTS.md, «Honesty boundaries»).

## Состав

| Сервис | Что делает |
| --- | --- |
| `keycloak` | Keycloak 26.5, реалм `fsp-id` импортируется из [`keycloak/fsp-id-realm.json`](keycloak/fsp-id-realm.json) при первом старте. Снаружи — `${PUBLIC_URL}/auth` |
| `db` | PostgreSQL 16 для Keycloak (наружу не публикуется) |
| `api` | Node 24, `node:http` + [`jose`](https://github.com/panva/jose) (проверка JWT по JWKS реалма) + Zod. Данные — [`data/dataset.json`](data/dataset.json) в памяти |
| `caddy` | HTTPS (Let's Encrypt для домена из `PUBLIC_URL`), `/auth/*` → Keycloak, остальное → API |

Адреса (подставьте `PUBLIC_URL`):

| | |
| --- | --- |
| Стартовая страница, примеры, демо-логин | `/` |
| Swagger UI, OpenAPI 3.1 | `/docs`, `/openapi.json` |
| Состояние | `/api/v1/health` → `{ok, idp: up/down, …счётчики}` |
| OIDC discovery | `/auth/realms/fsp-id/.well-known/openid-configuration` |
| Кабинет спортсмена (Keycloak account console) | `/auth/realms/fsp-id/account/` |
| Консоль администратора Keycloak | `/auth/admin/` (пользователь `KC_BOOTSTRAP_ADMIN_USERNAME`) |

## Модель доступа

| Кто | Токен | Что доступно |
| --- | --- | --- |
| Все | нет | `/disciplines`, `/regions`, `/partners`, `/events`, `/events/{id}`, `/events/{id}/results`, `/teams/{id}`, `/achievements/{id}/verify` — как публикуемые протоколы: фамилия с инициалами и регион |
| Спортсмен | пользователь реалма, claim `fsp_id`, роль `athlete` (вход через браузер — authorization code + PKCE; для отладки включён password grant) | `/me`, `/me/achievements`, `/me/ranks`, `/me/consents`, `PUT/DELETE /me/consents/{client_id}` |
| Партнёр | сервисный аккаунт клиента, `client_credentials`, роль `partner` | `/athletes` (поиск), `/athletes/{fsp_id}`, `…/achievements`, `…/ranks` — **только спортсмены, давшие согласие этому клиенту** по областям `profile`, `achievements`, `ranks`; иначе `403 consent_required` (несуществующий спортсмен для партнёра неотличим от «нет согласия») |

Токены принимаются, если `iss` = `${PUBLIC_URL}/auth/realms/fsp-id`, `aud` содержит `fsp-api`, подпись
проверена ключами реалма (JWKS читается по внутренней сети compose). Согласия живут в памяти API и
сбрасываются при рестарте; исходно все 120 спортсменов дали согласие `fsp-career`, каждый пятый —
`fsp-partner-demo`.

Реестр не хранит личную роль в команде, ссылку на проект и стек — это сообщает сам кандидат, и платформа
обязана помечать такие сведения как его слова, а не подтверждение ФСП.

## Реалм `fsp-id`

| Объект | Значение |
| --- | --- |
| Роли реалма | `athlete`, `partner`, `registry-admin` (не используется) |
| Клиент `fsp-career` | платформа команды: confidential, standard flow с PKCE S256, `client_credentials` (сервисный аккаунт с ролью `partner`), password grant для отладки. Redirect URI: `https://fsp2.ru/*`, `http://localhost:3000/*`, `http://127.0.0.1:3000/*`, `http://localhost:3100/*` |
| Клиент `fsp-partner-demo` | только `client_credentials`; открытый демо-клиент для показа модели согласий |
| Клиент `fsp-api` | bearer-only: audience токенов, которые принимает API |
| Mappers | `fsp_id` и `region_code` из атрибутов пользователя в id/access/userinfo; audience `fsp-api` в access token |
| Профиль пользователя | декларативный: `fsp_id` (`^FSP-[0-9]{5}$`) и `region_code` видит пользователь, меняет только администратор |
| Пользователи | 120 спортсменов: логин `fsp-10001` … `fsp-10120`, почта `<логин>@example.com`, общий пароль `FSP_DEMO_PASSWORD`; плюс два сервисных аккаунта |
| Сессии | access token 15 минут, SSO idle 30 минут; brute-force защита включена; регистрация и сброс пароля выключены |

Секреты клиентов и пароль спортсменов — плейсхолдеры `${VAR:default}` в JSON реалма; Keycloak подставляет
их из окружения при импорте. Тест `tests/generator.test.ts` следит, чтобы в файле не было других `${…}`.
На стенде `FSP_CAREER_CLIENT_SECRET` задан своим значением в `.env` сервера; `fsp-partner-demo` и пароль
спортсменов оставлены значениями по умолчанию из [`.env.example`](.env.example) — это публичные демо-данные.

## Данные

Генератор [`src/generator/`](src/generator) с фиксированным seed строит набор на 1 октября 2026:
16 регионов, 5 дисциплин ФСП (продуктовое, алгоритмическое, ИБ, робототехника, БАС), 120 спортсменов
1996–2009 г. р., 70 соревнований сезонов 2023–2026 (Чемпионат и Кубок России — отбор и финал,
Первенство России, региональные чемпионаты, хакатоны ФСП), 217 команд, 460 строк протоколов,
1035 записей о достижениях и 253 разряда. У результатов продуктового программирования шесть критериев
(как в опубликованном протоколе Чемпионата России 2025), у алгоритмического — задачи и штраф, у ИБ —
баллы, у робототехники и БАС — четыре критерия.

Правило присвоения разрядов — упрощённая условность (`impliedRank` в `build.ts`), не ЕВСК. Контрольная
сумма достижения — SHA-256 ключевых полей, не электронная подпись.

```bash
npm run generate          # перегенерировать data/dataset.json и keycloak/fsp-id-realm.json
```

Сгенерированные файлы закоммичены; тест сверяет их с генерацией. После изменения генератора —
перегенерировать и закоммитить оба файла.

## Локальный запуск

Нужен Docker. В `platform/` ничего не требуется.

```bash
cp .env.example .env       # PUBLIC_URL=http://localhost:8088 — без HTTPS
docker compose up -d --build
# ~1 минута на старт Keycloak; затем:
PUBLIC_URL=http://localhost:8088 bash scripts/smoke.sh
```

Без Docker — только API (без Keycloak токены проверить нельзя): `npm ci && npm run dev` на :8080.

Проверки: `npm run check` (typecheck + Vitest: генератор и целостность набора, реалм, конфигурация,
HTTP API с подменным проверяющим токенов). Против живого стенда — `scripts/smoke.sh`.

## Стенд

Сервер `fsp-id` (Selectel, проект `fsp-lct-2026`, `ru-7a`, PRC50.2-4096, 30 ГБ) создан скриптом
[`scripts/selectel-server.sh`](scripts/selectel-server.sh) через API Selectel, подготовлен
[`scripts/bootstrap-server.sh`](scripts/bootstrap-server.sh), выкладывается
[`scripts/deploy.sh`](scripts/deploy.sh) вручную с рабочей машины (автодеплоя из GitHub нет; push в
`main` этот каталог не выкладывает):

```bash
DEPLOY_HOST=deploy@111.88.114.206 SSH_OPTS='-i ~/.ssh/fsp-id' bash scripts/deploy.sh
```

`.env` на сервере — `/opt/fsp/fsp-sim/.env` (права 600, в репозиторий не попадает). Реалм импортируется
только в пустую базу: чтобы обновить пользователей или клиентов после перегенерации, на сервере
`docker compose down -v && docker compose up -d --build` (сбросит сессии и согласия; API-согласия и так в памяти).

Подробнее об обслуживании — [docs/deploy.md](../docs/deploy.md#симулятор-фсп-второй-сервер).

## Как платформе подключиться

1. Вход «через ФСП ID»: OIDC authorization code + PKCE к issuer выше, client `fsp-career`; из id token
   брать `sub` и `fsp_id`; связь `AuthAccount(provider='fsp-id', providerAccountId=sub)` и `fsp_id` в профиле.
2. Достижения: адаптер `AchievementProvider` поверх `GET /api/v1/athletes/{fsp_id}/achievements` с
   токеном `client_credentials` клиента `fsp-career` (или с токеном пользователя — `GET /api/v1/me/achievements`).
   Различать состояния «не привязан», «нет достижений» (`200`, пустой список), «нет согласия» (`403`),
   «источник недоступен» (сеть, `5xx`).
3. Проверка записи в карточке кандидата: `GET /api/v1/achievements/{id}/verify` без токена.

Что из этого сделано в `platform/` (`src/server/fsp-id/`, маршруты `/api/fsp-id/login`, `/api/fsp-id/link`,
`/api/fsp-id/callback`):

- **Шаг 1 — сделан.** Вход на платформу и привязка ФСП ID к профилю по OIDC; подпись id token проверяется
  ключами реалма. Аккаунт — `AuthAccount(provider='fsp', providerAccountId=<fsp_id>)`, привязка — источник
  `fsp:<fsp_id>` в профиле кандидата.
- **Шаг 2 — частично.** Достижения читаются один раз, при входе или привязке, токеном пользователя
  (`GET /api/v1/me/achievements`) и сохраняются снимком; различаются «нет достижений» и «реестр недоступен».
  Чтение по `client_credentials` (`/athletes/{fsp_id}/…`) и состояние «нет согласия» платформа не использует.
- **Шаг 3 — не сделан.**

Симулятор включается переменными `FSP_OIDC_ISSUER`, `FSP_OIDC_CLIENT_SECRET` и `FSP_API_URL`
(`platform/.env.example`). Без issuer или секрета платформа работает на встроенном моке ФСП ID и этот сервис
не вызывает.

## Ограничения

- Симулятор: контракт и данные вымышленные; реальные issuer, client, scopes и состав записи ФСП не выданы.
- Один сервер, без резервирования и резервных копий; база Keycloak — в томе Docker.
- Домен `sslip.io` — служебный; сертификат Let's Encrypt выдаётся на него.
- Password grant у `fsp-career` включён для отладки и демо через curl; в целевой интеграции отключить.
- Swagger UI на `/docs` подгружает скрипты с unpkg.com; сам API без внешних зависимостей.
