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
| `e2e` | Playwright (`e2e/`), сам поднимает `next dev` на :3100 |
| `db:migrate` / `db:deploy` / `db:seed` / `db:generate` | Prisma |

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
- `/api/health` — 200 `{ ok, db, llm }`; 503, если БД недоступна.
- `src/styles/tokens.css` — токены тёмной темы прототипа, JetBrains Mono из `public/assets/fonts`.

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
