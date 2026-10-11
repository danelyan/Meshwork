# platform — ФСП Карьера: карьерный консультант (E-01)

Next.js 15 (App Router) + TypeScript strict + Prisma 6 / PostgreSQL 16 + Zod 4.
Стек — `../docs/stack.md`. Карта модулей, маршрутов и общих файлов — [`../docs/modules.md`](../docs/modules.md).

## Быстрый старт (локально, без Docker)

```bash
npm install                              # один раз (лейны — симлинк, см. ниже)
bash scripts/db-local.sh start           # кластер fsp/.pgdata, порт 54329, user postgres, trust
bash scripts/db-local.sh create fsp_foundation
bash scripts/db-local.sh create fsp_test_foundation
cp .env.example .env                     # SESSION_SECRET: openssl rand -hex 32
npx prisma migrate deploy                # или npm run db:migrate (dev, создаёт миграции)
npm run db:seed                          # 3 демо-кандидата
npm run dev                              # http://localhost:3000, GET /api/health → 200
```

`scripts/db-local.sh start | stop | status | create <db> | drop <db> | url <db>` —
свой postgres из `/opt/homebrew/opt/postgresql@16`, без brew services и Docker.
На macOS скрипт выставляет `LC_ALL` (без него postmaster падает при старте).

## Запуск демо без ключей

Для показа жюри без доступа к языковой модели и к сети:

```bash
# .env
LLM_PROVIDER=stub
LLM_STUB_DEMO=true        # извлекатель размечает резюме словарём каталога; ответы консультанта — шаблонами
COLLECTOR_FIXTURES=true   # GitHub/Codeforces из фикстур eval/demo/*/links.json, без сети
DEMO_LOGIN=true           # страница /demo: демо-аккаунты, «Новый пользователь» (онбординг с нуля), «пройти онбординг заново»; блок на /auth; на проде выключить

bash scripts/db-local.sh start
npx prisma migrate deploy
npm run db:seed           # сам читает .env платформы, если DATABASE_URL не задан в окружении
npm run dev               # либо Docker-сборка
```

Сид даёт демо-кандидатам и демо-компаниям вымышленные контакты (`…@example.com`): кандидат видит способ связи компании в приглашении до ответа, работодатель контакт кандидата — после принятия. Миграция `202610101030_invite_contact` переносит прежнюю сумму приглашения `salaryOffer` в вилку `salaryFrom = salaryTo` и удаляет столбец.

Сценарий демо (шаги для жюри):

1. На `/` выбрать кандидата: под каждым написано, какое резюме и какую ссылку брать (имена в сиде совпадают с резюме).
2. В чате нажать «Загрузить демо-резюме» — PDF берётся с сервера (`GET /api/demo/resume`, только для демо-кандидатов), а ссылка на GitHub подставляется в поле ссылок. Нажать «Отправить».
3. Консультант отвечает по шаблонам: что прочитал, сколько утверждений нашёл и отбросил, скрытый текст (у третьего кандидата), предложение теста. Вверху чата — пометка «Демо-режим без языковой модели».
4. Подтвердить карточки («Да», «Поправить», «Нет» или «Подтвердить все со слов» — только для утверждений со слов; артефакты по одному). До подтверждения вакансий нет: консультант и экран профиля это объясняют.
5. Спросить «Какие есть вакансии?», «Что дальше?» или про тест — ответы строятся из `recommend_*`.

PDF демо-резюме лежат в `src/server/demo/pdf/` (в standalone-сборку попадают через `outputFileTracingIncludes`). Пересоздать:
`node eval/scripts/make-pdfs.mjs --font /путь/к/DejaVuSans.ttf --out /tmp/pdf` и скопировать `demo-1..3.pdf`
(без `--out` PDF всех резюме eval пишутся в `eval/pdf/`).

Скрипты `prisma/seed.ts` и `eval/run.ts` сами загружают `platform/.env`, если `DATABASE_URL` не задан,
чтобы общий Prisma Client не ушёл в чужую БД. Явно заданные переменные окружения главнее файла.

## Скрипты

| Скрипт | Что делает |
|---|---|
| `dev` / `build` / `start` | Next.js; `build` = `prisma generate && next build` (standalone) |
| `typecheck` | `tsc --noEmit` |
| `lint` | ESLint (flat config Next.js: core-web-vitals + typescript) |
| `test` | все проекты Vitest |
| `test:unit` | проекты `unit` (`tests/unit/**/*.test.ts`, Node) и `components` (`*.test.tsx`, jsdom) |
| `test:integration` | `tests/integration/**`, реальная БД `TEST_DATABASE_URL`, файлы последовательно |
| `e2e` | Playwright (`e2e/`), сам поднимает `next dev` на :3100 с `APP_URL` = адрес теста, `LLM_PROVIDER=stub`, `LLM_STUB_DEMO=true`, `DEMO_LOGIN=true` (не зависит от `.env`); БД — `DATABASE_URL` из окружения или `.env`, нужны миграции и `db:seed`. Вход в тестах — через окно входа (`e2e/helpers.ts`) или `/demo` |
| `db:migrate` / `db:deploy` / `db:seed` / `db:generate` | Prisma |
| `npx tsx scripts/build-openapi.ts` | Спецификация OpenAPI 3.1 из `src/app/api/**/route.ts` (кроме `api/dev`) → `docs/openapi.yaml` и `src/server/openapi/spec.generated.ts`; запускать после любого нового или изменённого маршрута (тест `tests/unit/openapi` сверяет актуальность). Формы ответов и пояснения к ошибкам — `scripts/openapi/overrides.ts`. Просмотр: `/api-docs`, сам документ — `GET /api/openapi` |

Тесты своего модуля: `npx vitest run tests/unit/<module>`. Полный прогон,
`next build`, Playwright — только оркестратор/интегратор, последовательно.

Integration-тесты: перед прогоном `globalSetup` применяет миграции к
`TEST_DATABASE_URL` (имя БД обязано содержать `test` — тесты её чистят
`resetDb()` из `tests/helpers/db.ts`). Route handler'ы вызываются напрямую:
`await POST(jsonRequest('/api/x', 'POST', body, cookie))` (`tests/helpers/requests.ts`).

## Переменные окружения

Схема и проверка — `src/server/env.ts` (`getEnv()` — лениво, при первом обращении;
`parseEnv()` — чистая функция). Полный список с комментариями — `.env.example`.
Обязательные: `DATABASE_URL`, `SESSION_SECRET` (≥ 32 символа). При
`LLM_PROVIDER=yandex` — `YANDEX_API_KEY`, `YANDEX_FOLDER_ID`, `YANDEX_MODEL`; при
`openai-chat` — `OPENAI_CHAT_BASE_URL`, `OPENAI_CHAT_API_KEY`, `OPENAI_CHAT_MODEL`.

Озвучка: `TTS_PROVIDER=auto|yandex|elevenlabs|off`. `elevenlabs` включается только явно (`auto` его не
выбирает) и требует `ELEVENLABS_API_KEY` и `ELEVENLABS_VOICE` (voice_id); необязательны
`ELEVENLABS_VOICE_EMPLOYER` (иначе общий голос), `ELEVENLABS_MODEL` (по умолчанию `eleven_multilingual_v2`),
`ELEVENLABS_BASE_URL` (по умолчанию `https://api.elevenlabs.io`; со стенда в РФ — реверс-прокси вне РФ, прямой
адрес отдаёт 302 на гео-блокировку). Только синтез, mp3; текст реплик ИИ уходит за рубеж.

Запасная модель — `LLM_FALLBACK_BASE_URL`, `LLM_FALLBACK_API_KEY`, `LLM_FALLBACK_MODEL` (задаются
вместе), `LLM_FALLBACK_FOLDER_ID` (каталог Yandex AI Studio, иначе `YANDEX_FOLDER_ID`),
`LLM_FALLBACK_NAME`, `LLM_FALLBACK_EXTRA_BODY`. Получает запрос, если основная не ответила после
ретраев (5xx/429, таймаут, сеть); следующие 60 с запросы идут сразу в неё (`server/llm/client.ts`).

Модель для созвонов — `LLM_CALL_BASE_URL`, `LLM_CALL_API_KEY`, `LLM_CALL_MODEL` (задаются вместе),
`LLM_CALL_FOLDER_ID`, `LLM_CALL_NAME`, `LLM_CALL_EXTRA_BODY` (формат как у `LLM_FALLBACK_*`). Не задана —
созвоны идут на основной модели; задана — созвон (`getLlm({ purpose: 'call' })`) идёт на ней, а при её сбое
запрос уходит на основную. Чат, консультант и подбор не затрагиваются.

Пароль на стенд: `SITE_PASSWORD` (или его SHA-256 в `SITE_PASSWORD_SHA256`, на стенде — в
`docker-compose.prod.yml`) задан → публичный адрес пускает только после ввода пароля на
`/site-access` (без логина; кука `site_access` на 30 дней, подписана `SESSION_SECRET`, смена пароля сбрасывает её у всех).
Проверка — `src/middleware.ts` + `src/server/site-access.ts`. Не закрываются localhost/127.0.0.1/[::1],
`/api/health` (CI, healthcheck) и статика; API без куки отвечает 401 `site_locked`. Пусто — стенд открыт.

Почта (вход по email, уведомления о приглашениях — `src/server/mail/`):

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `MAIL_PROVIDER` | `smtp` | `smtp` — боевой режим: письма на реальные ящики через SMTP-провайдера (локально — Mailpit, веб-ящик :8025); `log` — только локально и в тестах: письмо в лог сервера и журнал в памяти, без сети (тесты ставят `log` в `vitest.config.mts`) |
| `MAIL_FROM` | `ФСП Карьера <no-reply@fsp-career.local>` | отправитель |
| `SMTP_HOST`, `SMTP_PORT` | `localhost`, `1025` | SMTP-сервер (в compose — `mailpit:1025`) |
| `SMTP_SECURE` | `false` | `true` — TLS с первого байта (порт 465); STARTTLS не поддерживается |
| `SMTP_USER`, `SMTP_PASSWORD` | пусто | AUTH PLAIN; пусто — без авторизации (Mailpit) |

Регистрация по почте работает только через настоящее письмо: **на стенде без SMTP
регистрация жюри невозможна** (вход через демо-профили `/demo` при этом работает).
Код подтверждения возвращается в ответе и показывается на экране только при локальной
разработке — тот же гейт, что у дебаг-панели (`isDevRequest`: не production, Host —
localhost/127.0.0.1/[::1], `DEVTOOLS` не `false`); письмо в этом режиме не отправляется
(проверить настоящее письмо локально — `DEVTOOLS=false`). Код сброса пароля в ответе не
отдаётся никогда. Смена пароля отзывает выданные сессии (версия пароля в куке `cid`).

## Вход через Яндекс ID

На стенде ключи можно передать без локального SSH-доступа: сохранить
`YANDEX_CLIENT_ID` и `YANDEX_CLIENT_SECRET` в GitHub Actions Secrets и запустить
`Deploy stand` с `configure_yandex_only=true`. Настройки остальных сервисов
сохраняются; подробности — [развёртывание](../docs/deploy.md#автодеплой).

OAuth-клиент уже реализован в `src/server/auth/yandex.ts`: authorization code,
PKCE S256 и подписанная кука `state` на 10 минут. Токены Яндекса после получения
профиля не сохраняются; аккаунты разных способов входа по email не объединяются.

Для включения:

1. В [кабинете Яндекс OAuth](https://oauth.yandex.ru/) создать приложение
   **для авторизации пользователей**, указать название «MESHWORK», иконку
   `public/assets/yandex-oauth-icon.png` и контактную почту. У этой иконки есть
   поля вокруг знака, чтобы круглая рамка Яндекса не обрезала его края.
2. Выбрать «Веб-сервисы». Redirect URI стенда —
   `https://fsp2.ru/api/auth/yandex/callback`; для локальной разработки добавить
   `http://localhost:3000/api/auth/yandex/callback`. Suggest Hostname — `https://fsp2.ru`.
3. Выбрать только `login:info` и `login:email`. Сохранение приложения требует
   принятия [условий API Яндекс ID](https://yandex.ru/legal/authid_api/).
4. Передать серверу `YANDEX_CLIENT_ID` и `YANDEX_CLIENT_SECRET` из карточки
   приложения. Секреты не выводить в журнал и не добавлять в git; локальное
   хранение — scrt4 или macOS Keychain. `APP_URL` на стенде должен быть `https://fsp2.ru`:
   callback вычисляется из него, и адрес должен совпадать с настройкой Яндекса.
5. После обновления окружения пересоздать только контейнер приложения из
   `/opt/fsp/platform`: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps --no-build app`.
   Пересборка образа не нужна: настройки входа читаются на сервере при запросе.
6. На `/auth` отметить согласие на обработку персональных данных и нажать
   «Войти через Яндекс ID». Новый аккаунт попадает в `/consultant` для знакомства;
   повторный вход использует прежний аккаунт. Пока приложение не верифицировано
   Яндексом, на его экране входа может появляться предупреждение.

Без обеих OAuth-переменных кнопка неактивна. Демо-вход управляется отдельно
флагом `DEMO_LOGIN`. Порядок регистрации приложения —
[документация Яндекса](https://yandex.ru/dev/id/doc/ru/register-auth),
проектное решение — [ADR 0001](../docs/decisions/0001-auth-yandex-id.md).

Проверки без обращений к настоящему Яндексу:

```bash
npx vitest run --project unit --project components tests/unit/auth/yandex.test.ts tests/unit/components/auth-screen.test.tsx tests/unit/components/auth-entry.test.tsx
npx vitest run --project integration tests/integration/auth/yandex-callback.test.ts
```

Для второй команды нужен `TEST_DATABASE_URL` с именем базы, содержащим `test`;
тесты очищают эту базу.

## Админка платформы (`/admin`)

Админка для владельцев платформы и персонала (E-08, ADR [0009](../docs/decisions/0009-admin-staff.md), контракты —
[docs/admin.md](../docs/admin.md)): обзор, пользователи, кандидаты, компании, вакансии, приглашения, очереди
модерации (жалобы, апелляции, возражения по 152-ФЗ, красные флаги, верификация компаний), настройки, справочники,
метрики механик, журнал действий.

- Адрес: **https://fsp2.ru/admin/login** (стенд), локально — `http://localhost:<порт>/admin/login`.
- **Демо-вход** (кнопка «Демо-вход (только просмотр)» на странице входа) работает, когда `DEMO_LOGIN=true`.
  Вход без пароля и 2FA выполняется сотрудником-владельцем `demo-owner@admin.demo`, которому видны все экраны.
  Изменения и раскрытие ПДн отвечают 403, чтобы один проверяющий не менял стенд остальным. Выключили
  `DEMO_LOGIN` — выданные демо-сессии перестают действовать.
- **Полный вход** — почта, пароль и код TOTP из приложения-аутентификатора. Первого владельца создают на сервере
  (пароль только через stdin или `ADMIN_PASSWORD`, не аргументом):

  ```bash
  printf '%s' "$PASS" | npx tsx scripts/admin-create.ts --email owner@example.ru --name "Имя" --role owner
  ```

  При первом входе на экране появится ключ TOTP: его нужно добавить в приложение и ввести код. Остальных
  сотрудников (роли owner, moderator, support) владелец заводит в `/admin/staff`. Если потерян телефон:
  `npx tsx scripts/admin-create.ts --reset-totp --email …`.
- Сессия персонала хранится в отдельной куке `fsp_admin` (12 ч). Вход кандидата или работодателя в админку не
  пускает. Каждое изменяющее действие и каждое раскрытие ПДн записываются в журнал `/admin/audit`.

## Дебаг-панель (только localhost)

Плавающая кнопка `dev` справа внизу (`Ctrl+Shift+D`, Esc - закрыть): кто я, путь, быстрые действия - «Начать диалог заново», «Очистить онбординг» (с галкой «и ответы профиля»), «Очистить аккаунт» (с подтверждением), «Новый пользователь», «Сбросить попытки теста», «Войти как…», «Выйти». Действия - `POST /api/dev/<действие>` над пользователем из сессии (`src/app/api/dev/`, логика - `src/server/devtools/`).

Гейт `isDevHost()` (`src/server/devtools/guard.ts`): включено, только если `NODE_ENV` не `production`, `Host` - `localhost`, `127.0.0.1` или `[::1]` (любой порт) и не задано `DEVTOOLS=false`. Иначе панель не монтируется (клиентский код не отдаётся), а все `/api/dev/*` отвечают 404. На стенде и проде панели нет независимо от хоста.

## Общие модули (foundation)

- `src/server/db.ts` — `prisma`, один экземпляр на процесс.
- `src/server/errors.ts` — `{ error: { code, message } }`; `AppError`, `errors.*`,
  `withErrors(handler)` (AppError → свой статус, ZodError → 400 `validation_failed`,
  прочее → 500 без текста).
- `src/server/session.ts` — HMAC-кука `cid`; `requireCandidate(req)` → candidateId
  или AppError 401 (синхронно, проверяет подпись и срок; владение объектом —
  в сервисе, чужое → 404); `sessionCookie(id)` для `NextResponse.cookies.set`.
- `/demo` и `/api/demo/login` — список демо-аккаунтов и вход за них (только `isDemo`);
  без `DEMO_LOGIN=true` оба отдают 404. `DELETE /api/demo/login` — выход. На `/auth` демо-аккаунтов нет.
- Вход по почте (ADR 0001, «Дополнение 10.10»): `POST /api/auth/register` (email, пароль ≥ 8,
  версия согласия) → письмо с 6-значным кодом; `POST /api/auth/verify` (код → почта
  подтверждена, кука `cid`); `POST /api/auth/verify/resend`; `POST /api/auth/login`
  (только подтверждённая почта; неверная почта и пароль — одинаковый 401);
  `POST /api/auth/password/forgot` (всегда 200) и `POST /api/auth/password/reset`. Логика —
  `src/server/auth/email.ts`, пароль — scrypt (`password.ts`), коды — `codes.ts`,
  лимиты — `rate-limit.ts` (в памяти процесса).
- Переключение роли (ADR 0004): `POST /api/auth/role/switch` `{ role }` — у учётки может быть и профиль
  кандидата, и профиль работодателя; активна одна роль (`User.role`), кука `cid` несёт id профиля только
  активной роли. Нет профиля — создаётся (работодателю нужна `companyName`), знакомство новой роли идёт в
  ленте `/consultant`. Метка роли и переключатель — в шапке (`shell/RoleSwitch`). На общих демо-аккаунтах
  из сида вторую роль не создать (403) — для показа берите «Новый пользователь» на `/demo`.
- `/api/health` — 200 `{ ok, db, llm }`; 503, если БД недоступна.
- `src/styles/tokens.css` — токены тёмной темы прототипа. Шрифты подключает `src/app/layout.tsx` через `next/font`: JetBrains Mono — из `src/app/fonts`, Golos Text скачивается при сборке.

## LLM

```ts
import { getLlm } from '@/server/llm/client';
const llm = getLlm({ candidateId, conversationId, onQueue: (position) => emit({ type: 'queue', position }) });
const res = await llm.complete({ purpose: 'consultant', system, messages, tools });
```

`getLlm()` возвращает `LlmProvider` (контракт — `src/server/llm/types.ts`) поверх
провайдера из `LLM_PROVIDER`: семафор `LLM_MAX_CONCURRENCY` (8) с FIFO-очередью и
позицией, таймаут попытки `timeoutMs ?? LLM_TIMEOUT_MS`, ретраи `LLM_MAX_RETRIES`
(2) только на 429/5xx (таймаут и отмена не ретраятся), запись `AgentRun` на
каждый вызов (`ok`, токены, `attempts`, `queueWaitMs`, `jsonValid` — пришёл ли
`kind: 'json'` на запрос со `schema`; семантику проверяет вызывающий Zod-ом).
Провайдеры бросают `LlmError(code, message, status)`; ошибки SDK openai со
`.status` распознаются так же. Для тестов — `createLlmClient({ provider, ... })`
с моком `recordRun`. Провайдер без tools → «план В» (`llm/plan-b.ts`, лейн llm).

### Заглушка `LLM_PROVIDER=stub` (`src/server/llm/providers/stub.ts`)

Детерминированная, без сети. Решает по первому сработавшему правилу:

1. **Фикстура**: `registerStubResponse(purpose, (req) => ({ json } | { text } | { toolCalls }) | undefined)`
   — возвращает функцию «снять»; `clearStubResponses()` в `afterEach`.
2. **Ошибка**: `[[error 429]]` или `[[error 503 текст]]` в последнем сообщении
   user → `LlmError` с этим статусом (проверка ретраев и fallback).
3. **Инструменты**: есть `tools`, `toolChoice !== 'none'`, последнее сообщение —
   от user и содержит `[[tool:name {"json":"args"}]]` (можно несколько, JSON
   вложенный) → `kind: 'tool_calls'`, id `call_<n>_<name>`. Имя не сверяется
   со списком — так проверяется обработка неизвестного инструмента.
   `toolChoice: { name }` без маркера → вызов этого инструмента с `{}`. После
   сообщения `role: 'tool'` маркер повторно не срабатывает — ответ текстом.
4. **JSON**: есть `schema` → `[[json {...}]]` из сообщения, иначе минимально
   валидный объект по JSON Schema (`minimalFromSchema`: required-поля, `enum[0]`,
   `const`, `default`, `minimum`, `minItems`, `minLength`, `$ref`/`$defs`,
   `anyOf`). Схему из Zod: `z.toJSONSchema(Schema)`.
5. **Текст**: `[[reply текст]]`, иначе ответ по ключевым словам (привет/тест/
   вакансии) или эхо `Заглушка LLM: …`.

`[[delay 300]]` — задержка ответа (уважает `AbortSignal`).
`createStubProvider({ latencyMs })` — задержка на каждый ответ.

## Консультант (лейн agent)

`POST /api/consultant/messages` `{conversationId?, text, uploadIds?, urls?}` → SSE
(`data: <AgentEvent>\n\n`): первый кадр `conversation` (id, он же в заголовке
`X-Conversation-Id`), дальше `step` / `queue` / `claims` / `ask` /
`recommendations` / `message` / `error`, последний — `done`. Один ход на
разговор одновременно (`pg_try_advisory_xact_lock` на время хода), второй →
409 `busy`. Разрыв соединения (`request.signal`) останавливает цикл.
`GET /api/consultant/conversations[/id]` — список и история (только владелец).

Цикл (`src/server/agent/loop.ts`): первый ход с вложениями — детерминированный
конвейер `pipeline.ts` (сборщик → извлекатель → проверяющий → событие `claims`),
затем модель с 18 инструментами `tools/` (14 из ТЗ § 4.1 + 4 служебных на чтение; записи в профиль нет), не
больше `MAX_TOOL_CALLS_PER_TURN` = 6 вызовов за ход, после лимита — ответ без
инструментов. Внешний текст идёт в модель только в
`<external_data … trust="untrusted">` (`external.ts`); невалидные аргументы и
исключения инструментов возвращаются модели результатом `{ error }`. Бюджет
`LLM_DAILY_TOKEN_BUDGET` — сумма токенов `AgentRun` за 24 ч (0 — без лимита).
Падение провайдера / таймаут / бюджет → план В `fallback.ts` (извлечение по
маркерам каталога + шаблонные ответы), событие `step` про упрощённый режим.
Системный промпт — `prompts/consultant.md` (источник правды), константа
`prompt.ts` генерируется из него (тест сверяет); версия пишется системной
строкой `prompt:<версия>` в `Message` разговора.

### Инструменты по ролям

| Роль | Реестр | Инструменты |
|---|---|---|
| Кандидат — консультант, 18 = 14 из ТЗ + 4 служебных | `server/agent/tools/index.ts` | ТЗ § 4.1: `read_upload`, `fetch_url`, `fetch_profile`, `catalog_search`, `propose_claims`, `get_profile`, `get_gap_map`, `recommend_test`, `recommend_tasks`, `recommend_targets`, `explain_invitation`, `start_verification`, `render_profile_pdf`, `ask_user`; служебные (чтение): `get_onboarding_status`, `get_test_status`, `get_invitations`, `explain_evidence` |
| Работодатель — помощник по подбору, 7 | `server/agent/employer/tools/index.ts` | `get_employer_context`, `match_for_need`, `search_candidates`, `explain_candidate`, `draft_invitation`, `create_need_draft`, `ask_user` |

Реестры не пересекаются (тест `employer-tools.test.ts`): кандидатский инструмент
в ходе работодателя — `unknown_tool`, и наоборот. Подробно о помощнике —
`docs/employer-assistant.md`.

## Помощник работодателя (лейн emp-agent)

`POST /api/employer/assistant/messages` `{conversationId?, text}` → SSE
`EmployerAgentEvent` (`server/agent/employer/types.ts`): `conversation`, `step`,
`queue`, `ask`, `candidates` (карточки выдачи), `invitation_draft`, `need_draft`,
`message`, `error`, `done`. Только роль employer (401/403), один ход на разговор
(409). Разговоры — свои таблицы `EmployerConversation` / `EmployerMessage`
(миграция `202610091500_employer_agent`), purpose `employer_assistant` в `AgentRun`.
Страница — `/employer/assistant`; после онбординга работодателя та же лента
продолжается помощником. Демо без модели (`LLM_STUB_DEMO=true`) и план В —
скриптовый ход на тех же инструментах (`employer/demo.ts`).

## Контракты и заглушки лейнов

Типы — в модулях-владельцах, функции-заглушки бросают `not implemented: <lane>`:

| Модуль | Типы | Функции |
|---|---|---|
| `server/collector` | `types.ts`: `SourceKind`, `DocLine`, `ExtractedDoc`, `ProfileKind` | `extractFile`, `fetchUrl`, `fetchProfile` (`profiles.ts`), `maskContacts` |
| `server/claims` | `types.ts`: `EvidenceLevel`, `CatalogEntry`, `ProposedClaim`, `VerifiedClaim`, `VerifyResult`, `ProfileView` | `getCatalog`, `maxLevelFor`, `extractClaims`, `verifyClaims`, `proposeClaims`, `confirmClaim`, `editClaim`, `rejectClaim`, `getProfile` |
| `server/agent` | `types.ts`: `AgentEvent`, `ToolContext`, `AgentTool`, `TurnInput`, `MAX_TOOL_CALLS_PER_TURN` | `tools` (`tools/index.ts`), `encodeSse`, `runTurn` |
| `server/recommend` | `types.ts`: `Gap`, `TestRecommendation`, `TaskRec`, `TargetRec`, `Coverage` | `gapMap`, `recommendTest`, `recommendTasks`, `recommendTargets`, `explainInvitation` (`matcher.ts`) |
| `server/defense` | `types.ts`: `DefenseQuestion`, `DefenseVerdict` | `startDefense`, `answerDefense` |
| `server/llm/providers` | `YandexResponsesConfig`, `OpenAiChatConfig` | `createYandexResponsesProvider`, `createOpenAiChatProvider`; `plan-b.ts` |

Общие доменные типы — `src/server/types.ts` (`Specialization`, `Grade`, `FspState`).

## Работа в отдельном git worktree

```bash
cd <worktree>/platform
ln -s <основной чекаут>/platform/node_modules node_modules   # не npm install
bash scripts/db-local.sh start                               # если кластер не запущен
bash scripts/db-local.sh create fsp_<lane>
bash scripts/db-local.sh create fsp_test_<lane>
cp .env.example .env   # DATABASE_URL=…/fsp_<lane>, TEST_DATABASE_URL=…/fsp_test_<lane>, SESSION_SECRET
npx prisma migrate deploy
npx vitest run tests/unit/<module>
# новый или изменённый маршрут в src/app/api → npx tsx scripts/build-openapi.ts (и закоммитить docs/openapi.yaml)
```

Prisma Client сгенерирован в общий `node_modules` (`@prisma/client`). `prisma
generate` в лейне перезапишет его для всех — схему меняет только интегратор
(лейн описывает изменение в отчёте, правило 6 плана).

## Стенд (Docker)

`docker compose up --build`: `db` (Postgres 16), `migrate` (миграции + сид,
одноразово), `app` (standalone, :3000), `mailpit` (веб-ящик :8025). Секреты —
в `.env`. Локально Docker не нужен.

Стенд с HTTPS: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
— добавляется `caddy` (80/443, сертификат Let's Encrypt для `SITE_ADDRESS` из `.env`),
порты `app` и `mailpit` наружу закрыты. Сервер, `.env` и автодеплой — `../docs/deploy.md`.

## Дизайн

Сравнение сетчатого консультанта:

- `/design/consultant-grid-v1` — сохранённый одобренный Canvas-вариант;
- `/design/consultant-grid-v2` — эксперимент WebGL2 с невидимой поверхностью
  глубины и сглаженной сеткой. Сам материал головы не рисуется.
- `/design/consultant-grid-v3` — зеркальный вариант: чат слева,
  голова справа, взгляд и подсветка следуют курсору с учётом отражения.

Версии открываются с выбранными Кариной настройками 42 px / 1.25 / 0.18.
V3 сохраняет изменённые шаг, выпуклость и угол в этом браузере и восстанавливает
их после перезагрузки; «Твой сохранённый вид» возвращает исходные параметры.
Кнопки в панели позволяют сравнивать версии и возвращать сохранённые параметры.
Исходный экран и контрольные SHA-256 сохранены в
`design-baselines/consultant-grid-v1`; HTML v1 не перезаписывать.
Для пересборки HTML эксперимента: `node scripts/build-consultant-grid-v2.mjs`.
Рендерер эксперимента — `public/design/consultant-grid-v2/grid-surface.mjs`
(исходные модель/движения) и `grid-webgl.mjs` (проекция/глубина/линии).
HTML v3 собирается из v2: `node scripts/build-consultant-grid-v3.mjs`.
Рендерер общий; при обновлении HTML v2 пересобрать и v3.

Тестовый экран из экспорта `consultant-handoff`:
`http://localhost:3000/design/consultant-grid-preview`.
Панель регулирует шаг сетки, выпуклость и угол без перезапуска анимации или
чата; «Как в оригинале» возвращает 46 px / 1 / 0.5. Настройки действуют до
перезагрузки, панель сворачивается. Это сценарный дизайн-мокап с вымышленными
данными, без подключения к агенту и профилю пользователя.

Исходный самодостаточный HTML (Canvas 2D, модель, шрифты, фотографии и
среда исполнения экспорта) сохранён в `public/design/consultant-grid/index.html`.
Он изолирован от CSS платформы в iframe. Чтобы повторить импорт:
`node scripts/import-consultant-grid.mjs "<путь к Карьерный консультант.html>"`.
Скрипт распаковывает вложенные ресурсы локально и добавляет проверяемый канал
настроек; модель и алгоритм анимации остаются исходными. Ссылки мокапа ведут
в `/profile` и `/test` платформы; для них может потребоваться вход.

Токены (`src/styles/tokens.css`) сведены из `docs/design-spec.md` и `site/styles.css`: светлая тема, `--ink`/`--paper`/`--muted`/`--blue`, стекло (`--glass*`, `--blur`), квадратная форма (все `--radius*` = 0), без теней. Старые имена (`--bg`, `--panel`, `--text`…) оставлены алиасами.
Шрифты - `next/font` в `src/app/layout.tsx`: Golos Text (Google, самохостинг при сборке, нужна сеть) и JetBrains Mono (`src/app/fonts/`); в CSS - `var(--font)` и `var(--mono)`.
Общие классы - `src/components/ui.module.css`: `btn` (призрак), `primary` (чёрная), `cta` (синяя), `small`, `chip`/`chipOn`, `tag`+`outline|solid|red`, `field`/`input`/`label`/`hint`, `panel`/`glass`, `notice`/`errorBox`, `kicker`, `muted`. Использовать: `import ui from './ui.module.css'` и `className={`${ui.btn} ${ui.cta}`}`.
Лайм `#D4FF3A` - только на карте; уровни доказательств - `LevelBadge` (текст + знак + форма).

### Consultant head animation
The glass consultant portrait uses `public/models/head-mouth.glb` with Blender
mouth morphs and a fixed-base neck deformation. `Demo speech` plays the local
synthetic recording and animates lips from its audio energy; chat replies are
not currently voiced. Pause stops audio and decorative motion. The model is
not initialized on narrow screens, and reduced-motion disables animation.

Authoring: run Blender in background with
`--python scripts/rig-head-mouth.py -- --export-only` from the repository root.
The editable rig is written to ignored `output/head-lab/head-mouth-rig.blend`.

The consultant's local design preview at `/design/head-motion-preview` uses the
same Chat panel as `/consultant`. To verify its layout without a database, start
`npm run dev`, set `E2E_PORT=3000`, and run
`npx playwright test --config playwright.design.config.ts`.
If Playwright's browser is not installed, set `PLAYWRIGHT_CHANNEL=msedge` to use
an installed Edge. This checks desktop, tablet and phone widths.

Основной `/consultant` использует утверждённую сеточную голову v3 с сохранением
параметров. Для обновления изолированного документа головы:
`node platform/scripts/build-consultant-grid-head.mjs` (из корня репозитория).

Обычные ссылки `/auth` открывают модальное окно роли и входа поверх страницы;
прямая ссылка `/auth` показывает то же окно над главной. Демо-профиль выбирается
внутри окна, новый профиль продолжает знакомство в чате `/onboarding`.
Расширенный демо-стенд `/demo` остаётся доступен при `DEMO_LOGIN=true`.
