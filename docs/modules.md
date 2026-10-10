# Карта модулей `platform/`

Короткая карта для людей и агентов. Актуальность: 10 октября 2026 года. Где что лежит и от чего зависит. Запуск и
переменные — `platform/README.md`, стек — `docs/stack.md`, дизайн-правила —
`docs/design-system.md`. Зависимости ниже — по импортам `src/server/*`.

## Модули `src/server/*`

| Модуль | Назначение | Точка входа | Зависит от |
|---|---|---|---|
| `db.ts`, `env.ts`, `errors.ts`, `session.ts`, `types.ts` | Prisma-клиент, проверка env (Zod), типизированные ошибки, подписанная кука сессии | `env.ts` (`getEnv()`) | — |
| `llm` | Единый клиент LLM: семафор, ретраи, журнал `AgentRun`, план Б (JSON в тексте); провайдеры `stub`, `openai-chat`, `yandex-responses` | `llm/index.ts` | db, env, errors |
| `collector` | Разбор загрузок (PDF/DOCX/MD), скрытый текст, SSRF-защита, GitHub/Codeforces/StackOverflow, демо-ФСП, маскирование ПДн | `collector/index.ts` | db, env, errors |
| `claims` | Каталог навыков, извлечение и проверка утверждений, уровни, сервис подтверждения | `claims/index.ts` | collector, llm, db |
| `agent` | Цикл консультанта (SSE), реестр из 18 инструментов только на чтение/предложение, блокировка диалога, промпты, бюджет токенов | `agent/index.ts` (`runTurn`), `agent/tools/index.ts` | claims, collector, recommend, employer, onboarding, llm, demo |
| `agent/employer` | Отдельный цикл и 7 инструментов ассистента работодателя | `agent/employer/index.ts` (`runEmployerTurn`) | employer, recommend, claims |
| `recommend` | Карта пробелов, задания, целевые роли, матчинг вакансий, объяснение приглашений | `recommend/index.ts` | claims, db |
| `defense` | Защита утверждения: интервьюер и оценщик | `defense/index.ts`, `defense/session.ts` | claims, llm |
| `test` | Адаптивный тест на грейд (IRT, генераторы заданий, политика остановки) — ADR `docs/decisions/0002-grade-test.md` | `test/index.ts`, `test/service.ts` | claims, recommend, env |
| `onboarding` | Анкета и сценарий онбординг-чата, ИНН, согласие, сервис завершения | `onboarding/service.ts`, `onboarding/engine.ts` | auth, claims, collector, llm, recommend |
| `auth` | Яндекс ID (OAuth), роли, согласие, CSRF, устаревшие сессии — ADR `docs/decisions/0001-auth-yandex-id.md` | `auth/users.ts`, `auth/yandex.ts` | onboarding, session |
| `mail` | Отправка писем (SMTP, Mailpit на стенде), шаблоны писем подтверждения и сброса пароля | `mail/index.ts` | env |
| `employer` | Кабинет работодателя: вакансии, ранжирование, приглашения, приватность, веса | `employer/index.ts`, `employer/ranking.ts` | claims, recommend |
| `demo` | Демо-режим для жюри: вход за сид-кандидата, демо-резюме (PDF), контекст | `demo/mode.ts`, `demo/resumes.ts` | db, env, session |
| `stt` | Голос в текст: Yandex SpeechKit или браузер (Web Speech) | `stt/index.ts` | env, llm |
| `devtools` | Отладочная панель и `/api/dev/*`, только localhost | `devtools/guard.ts`, `devtools/actions.ts` | auth, db, session |
| `project` | Ступень 2 (ADR 0003): шаблоны проектов (`project-templates/`), условие и рубрика под потребность (LLM `project_spec`/`project_rubric`, детерминированный запасной путь), лента заданий, сдача из публичного GitHub, прогон в runner (stub без `RUNNER_URL`), отчёт работодателю, приглашение на защиту — `docs/project-templates.md` | `project/service.ts` | llm, runner, employer, collector, claims |
| `runner` | HTTP-клиент песочницы автопроверки (контракт `runner/src/contract.ts`) | `runner/client.ts` | env, collector |

Серверной озвучки (TTS) в коде нет; «говорящая голова» (`src/components/head/`) — клиентская.

## Маршруты `src/app/api/**`

| Группа | Маршруты | Модуль |
|---|---|---|
| Служебные | `health`, `openapi` (спецификация, `docs/openapi.yaml`) | — |
| Вход и роли | `auth/yandex`, `auth/yandex/callback`, `auth/consent`, `auth/logout`, `auth/me`, `auth/role`, `auth/stale`, `auth/onboarding/complete`, `auth/register`, `auth/verify[/resend]`, `auth/login`, `auth/password/forgot|reset` (вход по email) | auth, onboarding, mail |
| Онбординг | `onboarding` (SSE) | onboarding, agent |
| Консультант | `consultant/messages` (SSE), `consultant/conversations[/id]` | agent |
| Загрузки | `uploads` | collector |
| Профиль | `profile`, `profile/contact`, `profile/privacy`, `claims/[id]/[action]`, `claims/confirm-batch` | claims |
| Рекомендации | `recommendations` | recommend |
| Защита | `defense`, `defense/[sessionId]` | defense |
| Тест на грейд | `test/start`, `test/attempts`, `test/attempt/[id]` (+`answer`, `finish`, `confirm-junior`) | test |
| Приглашения (кандидат) | `invitations`, `invitations/[id]` | employer |
| Работодатель | `employer/vacancies[/id[/matches]]`, `employer/search`, `employer/invitations`, `employer/assistant/messages` (SSE) | employer, agent/employer |
| Проекты (кандидат) | `project-tasks/feed`, `project-tasks/[id]` (+`take`, `skeleton.zip`, `submissions`), `project-submissions/[id]` | project |
| Проекты (работодатель) | `employer/needs/[id]/project`, `employer/project-templates`, `employer/project-submissions[/id/invite-to-defense]` | project |
| Голос | `stt` | stt |
| Демо | `demo/login`, `demo/resume` | demo |
| Отладка | `dev/*` (login-as, new-user, reset-*, delete-account, …) | devtools |

Страницы: `(candidate)/{consultant,profile,test,defense,invitations,projects}`, `employer/*`,
`onboarding`, `auth`, `consent`, `demo`, `design/*` (превью, не для пользователей), `api-docs` (Swagger UI по спецификации).

## Общие файлы: правила правки

- `prisma/schema.prisma` — секции помечены `// lane: <модуль>`; правим аддитивно и в своей секции.
  Каждое изменение схемы — новая миграция в `prisma/migrations/` (`npm run db:migrate`), старые не переписывать.
  Сид — `prisma/seed.ts` + `prisma/seed/*`.
- `src/server/agent/tools/index.ts` — реестр инструментов консультанта. Новый инструмент: файл в `tools/`,
  строка в реестре, правка `tests/unit/agent/tools.test.ts`. Записывающих в профиль и пишущих от имени
  пользователя инструментов быть не должно (тест это проверяет). У работодателя свой реестр — `agent/employer/tools/index.ts`.
- `package.json` / `package-lock.json` — новые зависимости только с обоснованием в PR; лок-файл коммитить вместе.
- `src/styles/tokens.css` — единственный источник цветов; в `*.module.css` нет сырых `#hex`/`rgb()`
  (`tests/unit/design-tokens.test.ts`). Новый токен или компонент сначала описать в `docs/design-system.md`;
  примитивы — `src/components/ui`.
- `src/server/env.ts` + `.env.example` — новая переменная добавляется в оба места.
- Промпты — `*.md` рядом с модулем (`agent/prompts`, `claims/prompts`, `defense/prompts`); `.ts`-копии
  (`agent/prompt.ts`, `onboarding/prompt.ts`) собираются `npx tsx scripts/build-prompts.ts` — не править вручную.

## Тесты

| Вид | Где | Как гнать точечно (из `platform/`) |
|---|---|---|
| unit (Node) | `tests/unit/**/*.test.ts` | `npx vitest run tests/unit/<модуль>` |
| компоненты (jsdom) | `tests/unit/**/*.test.tsx` | `npx vitest run tests/unit/components/<файл>` |
| integration (реальная БД) | `tests/integration/<модуль>/` | `npx vitest run tests/integration/<модуль>`; нужна `TEST_DATABASE_URL`, имя БД содержит `test` (её чистят) |
| e2e | `e2e/*.spec.ts` (Playwright, `next dev` на :3100) | `npx playwright test e2e/<файл>` |
| eval (валидация, не CI) | `eval/` | `npx tsx eval/run.ts --predictor catalog-keywords` (извлечение), `npx tsx eval/matching/run.ts` (подбор), `npx tsx eval/test/run.ts` (тест на грейд), `eval/prompt-traps/run.ts`, `eval/llm-bench/` (сравнение моделей) |

Хелперы — `tests/helpers/*` (`resetDb()`, `jsonRequest()`). Проекты Vitest: `unit`, `components`, `integration`
(`vitest.config.mts`). Полный прогон, `next build`, Playwright — последовательно, машина слабая.

## Заглушки и имитации

- Заглушка LLM: `LLM_PROVIDER=stub` (`llm/providers/stub.ts`); `LLM_STUB_DEMO=true` — извлекатель размечает резюме
  словарём каталога, консультант отвечает шаблонами (`demo/mode.ts`, `claims/stub-demo.ts`, `agent/demo-reply.ts`).
- Профили GitHub/Codeforces без сети: `COLLECTOR_FIXTURES=true` (`collector/fixtures.ts`, данные `eval/demo/*/links.json`).
- ФСП — демонстрационный источник, API реестра не дан: `collector/fsp-demo.ts` (состояния `not_linked | no_achievements |
  unavailable | linked`), данные размечены как демо. Вход через ФСП ID не подключён — в UI подсказка, работает Яндекс ID.
- Демо-вход и демо-аккаунты: `DEMO_LOGIN=true` (`/demo`, `/api/demo/*`); на стенде включён, пока его смотрит жюри (`docs/deploy.md`).
- Яндекс ID: пусто `YANDEX_CLIENT_ID/SECRET` — кнопка неактивна, остаётся демо-вход.
- Голос: `STT_PROVIDER=auto|yandex|browser|off`; без ключей SpeechKit — распознаёт браузер.
- Тест на грейд: `TEST_DEMO_INTERVALS=true` — интервалы пересдачи в минутах, не днях (стенд жюри). Параметры заданий
  экспертные, на людях не оценены.
- Проверка проектов: пусто `RUNNER_URL`/`RUNNER_TOKEN` — stub-runner (`project/runner-client.ts`): счёт по числу тестов шаблона, адрес с `reference` — всё зелёное, `starter` — всё красное, `runner-fail` — сбой. При `LLM_PROVIDER=stub` условие и рубрика собираются детерминированно (`project/fallback.ts`).
- Отладочная панель и `/api/dev/*`: только localhost и не production; выключатель `DEVTOOLS=false`.
- Почта: `SMTP_HOST/PORT` (Mailpit на стенде).
