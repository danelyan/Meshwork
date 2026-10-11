# Карта модулей `platform/`

Актуальность: **11 октября 2026 года** (МСК), main `e255a1de`. Для людей и агентов: что делает каждый модуль, какие модели
и маршруты ему принадлежат, какие переменные окружения читает и чего не делает. Архитектура целиком и поток по трём
ступеням — [platform.md](platform.md), пути пользователей — [cjm.md](cjm.md), запуск — `platform/README.md`, стек —
[stack.md](stack.md), дизайн-правила — [design-system.md](design-system.md). Зависимости — по импортам `src/server/*`.
Полный список переменных — `platform/.env.example`, проверяет их `src/server/env.ts`.

Формат записи: **Назначение · Модели · Маршруты · Env · Ограничения**. «Ограничения» — то, чего модуль сознательно не
делает, и известные пределы.

## Сводка

| Слой | Модули |
|---|---|
| Основа | `db.ts`, `env.ts`, `errors.ts`, `session.ts`, `types.ts`, `contact.ts`, `site-access.ts`, `llm`, `mail`, `auth`, `onboarding`, `directions` |
| Профиль кандидата | `collector`, `uploads`, `claims`, `agent`, `consultant`, `resume-fields`, `consent`, `fsp-id`, `recommend`, `defense` |
| Три ступени оценки | `test` → `call` → `project` + `runner` → `defense-room` (ADR 0003); `interview` — ИИнтервью по модели компетенций |
| Работодатель | `employer`, `agent/employer`, `live-defense`, `favorites` (избранное обеих ролей) |
| Для жюри | `expert`, `validation`, `mechanics` |
| Персонал платформы | `admin` |
| Сервисные | `stt`, `tts`, `demo`, `devtools`, `openapi` |

---

## Основа

### `db.ts`, `env.ts`, `errors.ts`, `session.ts`, `types.ts`, `contact.ts`, `site-access.ts`
- **Назначение:** Prisma-клиент; проверка окружения (Zod, `getEnv()`); типизированные ошибки и формат `{ error: { code, message } }`
  (`withErrors`); подписанная кука `cid` (HMAC-SHA256, 30 суток) и `requireCandidate`/`requireEmployer`; нормализация контакта
  (почта или Telegram); закрытый стенд по паролю (`middleware.ts`, страница `/site-access`).
- **Модели:** —
- **Маршруты:** `GET /api/health` (`{ ok, db, llm, time }`, 503 при недоступной БД).
- **Env:** `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`, `NODE_ENV`, `DEMO_LOGIN`, `SITE_PASSWORD`, `SITE_PASSWORD_SHA256`.
- **Ограничения:** лимиты попыток входа живут в памяти процесса (сбрасываются при рестарте). `SITE_PASSWORD_SHA256` задан в
  `docker-compose.prod.yml`: стенд закрыт паролем, он оставлен на время сдачи (решение владельца 11.10 15:30,
  [product-decisions.md](product-decisions.md)), жюри получает пароль в документе сдачи.

### `llm`
- **Назначение:** один интерфейс `complete()` над провайдерами `stub`, `openai-chat`, `yandex-responses`: семафор с очередью,
  таймаут, ретраи (429 и 5xx), журнал каждого вызова, план Б (JSON в тексте) для моделей без вызова инструментов, строгий JSON
  по схеме (`completeJson`), стриминг дельт.
- **Модели:** `AgentRun` (провайдер, модель, задержка, токены, попытки, ожидание в очереди, валидность JSON).
- **Маршруты:** —
- **Env:** `LLM_PROVIDER`, `LLM_STUB_DEMO`, `LLM_MAX_CONCURRENCY` (8), `LLM_TIMEOUT_MS` (40 с), `LLM_MAX_RETRIES`,
  `LLM_DAILY_TOKEN_BUDGET` (200 000 на кандидата за 24 ч), `YANDEX_API_KEY`, `YANDEX_FOLDER_ID`, `YANDEX_MODEL`, `YANDEX_BASE_URL`,
  `YANDEX_SUPPORTS_TOOLS`, `OPENAI_CHAT_BASE_URL|API_KEY|MODEL|NAME|SUPPORTS_TOOLS|SUPPORTS_JSON_SCHEMA|STREAM`.
- **Ограничения:** не знает предметной области. Цели вызова (`LlmPurpose`): `consultant`, `employer_assistant`, `extractor`,
  `interviewer`, `evaluator`, `call_interviewer`, `call_evaluator`, `interview_interviewer`, `defense_qlc`, `project_spec`, `project_rubric`,
  `consultant_memory`, `smoke`. На стенде 10.10 провайдер — `stub`.

### `mail`
- **Назначение:** отправка писем (свой SMTP-клиент, Mailpit на стенде): коды подтверждения, сброс пароля, уведомления о
  приглашениях (фоновые: сбой письма приглашение не отменяет). Письмо — текст и HTML одного содержания
  (`multipart/alternative`); HTML-оболочка `layout.ts` описана в [дизайн-системе](design-system.md), «Письма».
- **Модели:** —
- **Маршруты:** —
- **Env:** `MAIL_PROVIDER` (`smtp` \| `log`), `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`.
- **Ограничения:** без внешнего SMTP-провайдера письма не доходят до ящика пользователя, регистрация по почте на стенде не
  завершится (демо-вход работает).

### `auth`
- **Назначение:** вход по почте (код, пароль scrypt, сброс) и Яндекс ID (OAuth + PKCE), роли и их переключение
  ([ADR 0001](decisions/0001-auth-yandex-id.md), [0004](decisions/0004-role-switching.md)), согласие с версией текста, CSRF по Origin,
  устаревшие сессии.
- **Модели:** `User`, `AuthAccount`, `EmployerProfile`, `Consent`, `AuthCode`.
- **Маршруты:** `auth/register`, `auth/verify[/resend]`, `auth/login`, `auth/password/forgot|reset`, `auth/yandex[/callback]`,
  `auth/consent`, `auth/role[/switch]`, `auth/me`, `auth/logout`, `auth/stale`, `auth/onboarding/complete`,
  `DELETE auth/account` (удаление аккаунта), `GET|POST /api/notifications` (уведомления и отметка прочитанного, `auth/notifications`).
- **Env:** `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`.
- **Ограничения:** автоматической верификации компании работодателя нет (R-D-05 её не требует; ручная проверка модератором — модуль `admin`); токены Яндекса не хранятся; без ключей Яндекс ID
  кнопка «Войти через Яндекс ID» в окне входа скрыта (`components/auth/AuthEntryFlow.tsx`, `hideWhenOff`). Вход через ФСП ID — модуль `fsp-id`.

### `onboarding`
- **Назначение:** сценарий опроса в чате для обеих ролей, ИНН (контрольная сумма), согласие, завершение; кандидат выбирает
  **подкатегорию** — без неё тест на грейд не стартует.
- **Модели:** `CandidateProfile`, `OnboardingState`, `Candidate` (специализация, подкатегория, контакт),
  `OnboardingAnswerRevision` (журнал редакций ответов: шаг, было, стало, источник `user|fsp|reset`).
- **Маршруты:** `GET /api/onboarding` (состояние: шаг, лента, прогресс), `POST /api/onboarding` (действие
  `answer|skip|goto|later`); оба отвечают JSON, не SSE. `GET /api/onboarding/history` — журнал редакций своих ответов
  (только кандидат).
- **Env:** — (LLM по общим настройкам).
- **Ограничения:** «найдено в реестре» для ИНН — демо-метка, запроса в ЕГРЮЛ нет; ФСП ID — имитация.

### `directions` (`server/directions.ts`, `lib/directions.ts`, `lib/grades.ts`)
- **Назначение:** четыре направления (backend, frontend, ai, engineering), 18 подкатегорий и три грейда (список и счётчики — [документ сдачи § 2.1](submission/fsp-career.md#21-справочник-направлений-подкатегорий-и-грейдов-r-t-05))
  (`junior < middle < senior`) — единый список для кода, UI и сида ([ADR 0003, дополнение 10.10](decisions/0003-three-stage-assessment.md); R-T-05).
  Подкатегория `active` ⇔ банк теста полон (6 Junior + 4 Middle + 4 Senior).
- **Модели:** `Subcategory` (`id` вида `backend.web-api`, `status active|planned`).
- **Маршруты:** `GET /api/directions`.
- **Env:** —
- **Ограничения:** Senior — сверх ТЗ (организаторам достаточно двух грейдов); в каталоге утверждений весов Senior нет, берутся веса
  Middle (предложение). Новое направление: сначала `lib/directions.ts`, затем enum в схеме и миграция; `Record<Specialization, …>` TS проверит.

---

## Профиль кандидата

### `collector` и `uploads`
- **Назначение:** разбор загрузок (PDF/DOCX ≤ 5 МБ, ≤ 20 стр., в `worker_threads` с таймаутом 15 с и кучей 384 МБ), HTML в текст,
  URL с SSRF-фильтром, профили GitHub, Codeforces, Stack Overflow, демо-ФСП; маскирование контактов; скрытый текст и подозрение
  на инъекцию — флаги. `uploads` хранит оригинал файла кандидата на диске (владельцу — «скачать»).
- **Модели:** `Upload` (текст с координатами, флаги, `storageKey`), `Source` (снимок внешнего источника, он же кэш 24 ч).
- **Маршруты:** `POST /api/uploads`, `GET /api/uploads/:id/file`, `DELETE /api/uploads/:id`, `DELETE /api/sources/:id`.
- **Env:** `UPLOAD_DIR` (`./data/uploads`; в Docker — том `app-data`), `GITHUB_TOKEN`, `COLLECTOR_FIXTURES`.
- **Ограничения:** не вызывает модель и не пишет в профиль; OCR сканов нет; подтверждения владения аккаунтом GitHub/Codeforces/ФСП
  нет, поэтому максимум «артефакт»; ФСП — вымышленные демо-данные. Маскирование — регулярные выражения, нестандартная запись
  контакта может пройти.

### `claims`
- **Назначение:** закрытый каталог утверждений (142 записи: backend 36, frontend 31, ai 31, engineering 31, общих 13),
  извлекатель (LLM, JSON), проверяющий (код: id из каталога, дословная цитата ≥ 2 слов в видимом тексте, один id — одно
  утверждение), уровни доказанности по источнику (`levels.ts`), подтверждение, правка, отклонение.
- **Модели:** `ClaimCatalog`, `Claim` (`proposed → confirmed|edited|rejected`, `level`, `sourceRef`).
- **Маршруты:** `POST /api/claims/:id/{confirm|edit|reject}`, `POST /api/claims/confirm-batch`, `GET /api/profile`,
  `GET /api/profile/details` (`claims/profile-details`).
- **Env:** —
- **Ограничения:** не присваивает категорию; уровень `platform` из источников не выдаёт (только тест, защита, созвон);
  `third_party` сейчас не выдаётся (нет подтверждения владения). Каталог — черновик, разметил один агент.

### `agent` и `agent/employer`
- **Назначение:** цикл хода консультанта (SSE), реестр из 21 инструмента (только чтение и предложение), детерминированный
  конвейер первого хода, блокировка хода (`pg_try_advisory_xact_lock`), суточный бюджет токенов, план Б. Отдельный цикл и
  9 инструментов помощника работодателя.
- **Модели:** `Conversation`, `Message`, `EmployerConversation`, `EmployerMessage`.
- **Маршруты:** `POST /api/consultant/messages` (SSE: `conversation`, `step`, `queue`, `claims`, `ask`, `recommendations`, `delta`,
  `discard`, `message`, `error`, `done`), `GET /api/consultant/conversations[/:id]`, `POST /api/consultant/messages/stop` (кнопка «Стоп»: отменить активный ход),
  `POST /api/employer/assistant/messages` (SSE).
- **Env:** `WEB_SEARCH` (`auto` \| `off`; Yandex Search API при ключах), `LLM_DAILY_TOKEN_BUDGET`.
- **Ограничения:** нет инструментов записи в профиль, отклика и письма (проверяет `tests/unit/agent/tools.test.ts`); HTTP только
  через сборщик; помощник работодателя видит публичную карточку без имени, контактов и цитат даже после `accepted`;
  один ход на разговор (второй — 409 `busy`); ≤ 6 вызовов инструментов за ход.

### `consultant` (память, настройки, боковая панель)
- **Назначение:** память консультанта «что я о тебе знаю» (заметки из разговора или добавленные человеком), настройки
  собеседника, навыки, подсказки боковой панели.
- **Модели:** `ConsultantMemory`, `ConsultantSettings`.
- **Маршруты:** `GET|POST /api/consultant/memory`, `PATCH|DELETE /api/consultant/memory/:id`,
  `GET|PUT /api/consultant/settings`, `GET /api/consultant/aside`.
- **Env:** —
- **Ограничения:** запись в память идёт от имени человека или из его реплики; на профиль, категорию и подбор не влияет.

### `resume-fields` — поля профиля из резюме
- **Назначение:** поля профиля из загруженного резюме (R-C-01/02): ФИО, контакт, стаж, роли, гибкие навыки (`name`, `contact`,
  `experienceYears`, `roles`, `softSkills`). Пустое поле профиля заполняется само (`applied`, пометка «из резюме»); заполненное
  кандидатом не перетирается — остаётся предложение «в резюме указано иначе» (`suggested`), кандидат принимает, отклоняет или правит сам.
- **Модели:** `ResumeField` (`ResumeFieldStatus`: `applied | suggested | dismissed`).
- **Маршруты:** `GET|POST /api/profile/resume-fields`.
- **Env:** —
- **Ограничения:** модель не вызывает, разбор — правила в `resume-fields/parse.ts`; ФИО и контакт видит только кандидат, работодатель до
  принятия приглашения их не видит (`employer/privacy.ts`).

### `profile-pdf` — PDF-профиль кандидата
- **Назначение:** стандартизированный PDF-профиль (R-C-03): категория из теста, основное, подтверждённые утверждения с уровнем
  доказанности, ФСП, ступени проверки. Данные — те же загрузчики, что у экрана профиля; документ собирает `model.ts`, рисует
  `render.ts` (pdfkit, шрифт DejaVu Sans из `public/assets/fonts`).
- **Модели:** — (читает `Claim`, `CandidateCategory`, `CallSession`, `ProjectSubmission`, `DefenseSession`).
- **Маршруты:** `GET /api/profile/pdf` (файл, `attachment`).
- **Env:** —
- **Ограничения:** только свой профиль (`candidateId` из сессии); работодателю PDF не отдаётся.

### `consent` — согласия и возражения ([ADR 0005](decisions/0005-consents.md))
- **Назначение:** выдача, отзыв и проверка согласий, список для кабинета (страница `/consent`); возражения против автоматической
  оценки (ст. 16 152-ФЗ): кандидат оспаривает категорию из теста, оценку созвона или защиты; удаление аудио созвонов при отзыве
  согласия на запись и по сроку хранения (`recordings.ts`).
- **Модели:** `Consent` (`ConsentKind`: `pd_processing`, `call_recording`, `ai_assessment`, `employer_visibility`, `research`, `marketing`,
  `identity_disclosure`, `employer_offer`, `employer_data_obligation`), `AssessmentObjection`.
- **Маршруты:** `GET|POST /api/consents`, `DELETE /api/consents/:kind`, `GET|POST /api/objections`; отвечает на возражение поддержка
  в админке (`/api/admin/objections`).
- **Env:** `CALL_RECORDING_RETENTION_DAYS` (90; в админке — настройка `call.recordingRetentionDays`), `CALL_DATA_DIR`.
- **Ограничения:** отзыв `pd_processing` — 409 `consent_revoke_is_erase` (отзыв = удаление аккаунта, `DELETE /api/auth/account`);
  `marketing` хранится и ни на что не влияет (рассылок нет); срок ответа на возражение — 30 дней, работодатель возражений не видит;
  при удалении аудио транскрипт и оценки остаются.

### `fsp-id` — вход и привязка через ФСП ID (имитация)
- **Назначение:** клиент OIDC (Authorization Code + PKCE S256, state, nonce; проверка ID-токена RS256 по JWKS на `node:crypto`,
  `jwt.ts`): вход на платформу кнопкой «Войти через ФСП ID» и привязка ФСП ID к профилю в настройках кандидата; достижения
  участника из реестра (`registry.ts`). Провайдер — либо симулятор ФСП ID команды на Keycloak (задан в env), либо встроенный мок
  (`fsp-id/mock`) со страницей выбора демо-участника.
- **Модели:** своих нет: `AuthAccount` (провайдер `fsp`), `Candidate.fspState`, `Source` (`kind = fsp`, `origin = "fsp:<sub>"`,
  `ownershipVerified = true`, в снимке — достижения на момент привязки).
- **Маршруты:** `GET /api/fsp-id/login`, `GET /api/fsp-id/link`, `GET /api/fsp-id/callback`;
  `GET|POST /api/fsp-id/realms/fsp/protocol/openid-connect/auth` — authorization endpoint мока (404, когда настроен внешний провайдер).
- **Env:** `FSP_OIDC_ISSUER`, `FSP_OIDC_CLIENT_SECRET` (нужны оба, иначе мок), `FSP_OIDC_CLIENT_ID` (`fsp-career`), `FSP_API_URL`
  (API реестра симулятора, `GET /me/achievements`), `FSP_OIDC_DEMO_HINT` (подсказка у кнопок, только с симулятором), `APP_URL`.
- **Ограничения:** это имитация: с настоящим ФСП ID и реестром ФСП интеграции нет, участники и достижения демонстрационные.
  Уникальность «один ФСП ID — один кандидат» на стенде намеренно не введена (демо-участники общие). Мок держит ключ подписи и коды
  в памяти процесса: после перезапуска ключ новый. Сбой реестра — состояние `unavailable`, без штрафа.

### `recommend`
- **Назначение:** рекомендация теста (порог покрытия 0,25 для Middle), карта пробелов, задания из банка, вакансии «закрываешь
  k из n», объяснение приглашения; общий матчер, которым пользуется и работодатель.
- **Модели:** `Task` (банк заданий), `Recommendation` (объявлена, кодом не заполняется).
- **Маршруты:** `GET /api/recommendations?target=&limit=`.
- **Env:** —
- **Ограничения:** не вызывает модель; не даёт рыночных цифр и вероятности приглашения; пороги и веса — предложения без
  калибровки (`recommend/weights.ts`); банк из 16 заданий рекомендуется, но решения по ним не проверяются.

### `defense` (защита утверждения)
- **Назначение:** короткое интервью по одному утверждению: 3–5 вопросов, оценщик по рубрике из четырёх признаков, порог в коде,
  подъём уровня до `platform`. Рубрику и проверку цитат переиспользуют `call` и `defense-room`.
- **Модели:** `DefenseSession`, `DefenseTurn`.
- **Маршруты:** `POST /api/defense`, `GET|POST /api/defense/:sessionId`.
- **Env:** —
- **Ограничения:** одна активная сессия на утверждение, 2 попытки за 30 дней; не проверяет подлинность истории из резюме;
  на stub оценщик всегда выдаёт «не пройдено». Не путать с защитой проекта (`defense-room`).

---

## Три ступени оценки

### `test` — тест на грейд ([ADR 0002](decisions/0002-grade-test.md))
- **Назначение:** адаптивный тест IRT 2PL (EAP по сетке, информация Фишера, randomesque 3). Генераторы заданий `be.*`, `fe.*`,
  `ai.*`, `eng.*` — 492 семейства: 26–27 на каждую из 17 исходных подкатегорий, 18 у `ai.bi-analytics`, 29 общих (минимум пула — 6 Junior + 4 Middle + 4 Senior). Пул попытки — семейства
  подкатегории (`poolFor`); заявка Senior идёт по Senior-пулу с дозадаванием Middle (до 4), заявка Middle и Junior — по всему пулу с
  дозадаванием Junior (до 3). Пороги θ: Junior −0,7, Middle −0,1, Senior +0,8; подтверждение при P ≥ 0,8; версия политики `adr-0002-v7` (`POLICY_VERSION` в `test/policy.ts`).
  Итог — `CandidateCategory` и подъём подтверждённых утверждений до `platform`.
- **Модели:** `TaskTemplate`, `TestAttempt` (seed, θ, SE, P(pass), исход, `subcategoryId`, версия политики), `TestItem`, `CandidateCategory`.
- **Маршруты:** `GET|POST /api/test/start`, `GET /api/test/attempts`, `GET /api/test/attempt/:id`,
  `POST …/answer|finish|confirm-junior|confirm-start|signal` (`confirm-start` — подтверждающий тест к попытке в статусе
  `needs_confirmation`; `signal` — дельты сигналов браузера для индекса честности, только счётчики).
- **Env:** `TEST_DEMO_INTERVALS` (интервалы пересдачи в минутах — только для показа); `TEST_INTEGRITY` (выключатель индекса честности), `TEST_INTEGRITY_ACTION=silent|confirm` (по умолчанию `silent`: high не задерживает категорию и кандидату не раскрывается), `JURY_INSIGHTS` (слой «только для жюри»: на стенде true, на проде false).
- **Ограничения:** без LLM; параметры заданий `a`, `b` экспертные, на людях не оценены; подкатегория без полного банка — «тест пока
  недоступен»; смена грейда не чаще раза в 30 дней, пересдача того же — через 14 (предложение); принудительного понижения нет.
  Сопоставимость результатов (R-T-02) — внутри подкатегории.

### `call` — ступень 1, квалифицирующий созвон
- **Назначение:** ИИ-интервьюер задаёт 4–6 вопросов по темам профиля и специализации (маршрут по уровню 1–3: после сильного ответа
  уровень выше, после слабого ниже; ≤ 2 вопроса на тему, ≤ 5 тем), слепой оценщик по рубрике A-02 (глубина / «почему так» / граница
  знаний / доведение, 0–2; 3 прогона, медиана, ≥ 2 валидных) строит карту глубины. Подтверждённые темы поднимают утверждения до
  `platform`. Запись: транскрипт в БД, аудио кандидата — WAV в `CALL_DATA_DIR`, видео с камеры (комната звонка, по желанию) — WebM-сегменты
  там же (`video.ts`, `POST|GET /api/call/:id/video`), без анализа на сервере; на клиенте при камере — значок взгляда и поворот головы
  за лицом (MediaPipe, `lib/face-gaze.ts`), никуда не отправляется. Драйверы видов созвона (`drivers.ts`) — через них
  работает и защита проекта. SSE-шина событий.
- **Связь теста и созвона (11.10):** в конце созвона (после обычных вопросов) интервьюер по отдельному промпту `prompts/test-review.md`
  просит объяснить 1 задание из **последней завершённой попытки теста по той же подкатегории** (`test-review.ts`: верно решённое,
  ближайшее по сложности к порогу заявленного грейда; запасное — неверное; условие и ответ берутся из `TestItem`) и задаёт один вопрос
  на изменение условия: +2 реплики ИИ, в `questionTurns` и слепой оценщик они не входят (`meta.testReview`). Отдельный оценщик
  (`prompts/ownership.md`, 1 прогон, «объяснил» без дословной цитаты понижается до «частично») пишет в `verdictJson.testOwnership`
  (`explained|partial|failed|not_checked`, схему БД не менял). Работодатель видит строку «Решения теста: объяснил сам / не смог
  объяснить» в блоке созвона (без причины), в ранжирование и категорию это не входит. Нет попытки теста — этап пропускается.
- **Модели:** `CallSession` (`kind qualifying|defense`, `status pending|active|finished|cancelled`, транскрипт, `verdictJson`,
  `audioPath`, `policyVersion`), `CallParticipant`, `EmployerQuestion`, `Consent` (пункт о записи).
- **Лимит реплик и итог (отладка 11.10):** реплик ИИ на созвон не больше 8 (`CALL_LIMITS.maxAiTurns`): обычные вопросы, разбор теста,
  дополнительные вопросы и одна итоговая реплика (её повтор после дополнительного вопроса не считается). При попытке теста обычных
  вопросов квалифицирующего созвона — до 5, ИИнтервью — до 5 (без попытки — 6 и 7). Итоговая реплика называет число тем и был ли разбор
  теста, оценок не называет. «Не знаю» закрывает тему (без штрафа: рубрика `boundary`), просьба подсказать ответ или оценку — вежливый
  отказ одной фразой (код добавляет его, если модель не отказала сама). Таймаут вопроса интервьюера — 20 с, дальше вопрос из шаблона.
  Этап разбора теста есть и в ИИнтервью (`kind=interview`): после теста сцена консультанта открывает именно его. Шина SSE и защита от
  двойного «Завершить» — на `globalThis` (один инстанс). Демо-кандидаты (`isDemo`) — без суточного лимита и паузы (общие для жюри).
  Условия старта (`call/readiness.ts`, `callReadiness` → `readiness` в `GET /api/call`): qualifying — есть утверждение о навыке, interview — есть категория из теста
  (иначе 409 `call_not_ready`); повтор вида — не раньше 24 ч после завершённого созвона с вердиктом (409 `call_cooldown`, `details.retryAt`); активный созвон продолжается без проверок.
- **Скорость ответа (лейн call-speed, 11.10):** при `CALL_STREAMING=true` (по умолчанию) вопрос интервьюера генерируется потоком
  (`onJsonDelta`, только openai-chat со stream; yandex/stub — ответ целиком, как раньше) и уходит клиенту по предложениям SSE-событием
  `utterance_delta {afterIndex, n, text}` до ответа `/turn`; в транскрипт пишется реплика целиком, и она всегда начинается с отданных
  предложений (`call/stream.ts`, нарезка `lib/sentences.ts:stableSentences`), поэтому счёт услышанного для `/interrupt` сходится.
  Защиты проверяются по мере поступления: тема/компетенция, покрытие, «не знаю», `done` — до первого предложения; пересказ профиля и
  кириллица — на всём полученном тексте перед каждым предложением; отказ подсказывать — первым предложением. Сбой после прозвучавшего —
  без повтора: прозвучавшее (+ шаблон), `meta.streamCut`. Этап разбора теста и первый вопрос не стримятся. Панель консультанта
  (`components/call/useReplySpeech.ts`) озвучивает по предложениям через очередь голоса компаньона (тот же `AnalyserNode` липсинка);
  комната `/interview/room` поток не слушает (озвучивает реплику по предложениям после `/turn`, как раньше). Замер: `Server-Timing`
  у `/turn` (`llm`, `first`), `/audio` (`stt`), `/api/tts` (`tts`), лог `[call] turn|stt timing` без текста кандидата, в браузере
  `window.__fspCallLatency`; скрипт `eval/call/latency.ts`, цифры — `validation-results.md` («Задержка созвона 11.10»).
- **Маршруты:** `GET /api/call`, `POST /api/call/consent`, `POST /api/call/start`, `GET /api/call/:id`, `POST …/turn|audio|finish`,
  `GET …/events` (SSE), `GET …/recording`, `POST …/signal`.
- **Env:** `CALL_STREAMING` (`true`; `false` — вопрос целиком, как до 11.10), `CALL_DATA_DIR` (`./data`; том `app-data`), `CALL_DAILY_LIMIT` (5 за 24 ч, `0` — без лимита; демо-кандидаты не
  ограничены; `call/service.ts` читает лимит из настройки админки `call.dailyLimit` (по умолчанию — эта переменная) и считает
  созвоны того же вида; защита проекта считает иначе, см. `defense-room`; на стенде переменная не задана → 5 для обычных кандидатов), `STT_*`, `TTS_*`. `/turn` требует `text` (распознанный в `/audio`
  или браузером): только `audioRef` — 400.
- **Ограничения:** категорию не меняет; порог подтверждения темы — предложение, на людях не калиброван; сегмент аудио ≤ 3 МБ, ≤ 40
  сегментов; до `accepted` работодатель видит только публичный вердикт (оценки по темам без цитат), запись — только после `accepted`;
  на stub ответы детерминированы по `<call_context>`; отдельная валидация ступени — `docs/validation-stages.md` (дополняется).

### `interview` — ИИнтервью ([модель компетенций](competency-model.md))
- **Назначение:** структурированное интервью после теста (экран `interview.html` мокапа) как вид созвона `CallSession.kind=interview` на
  инфраструктуре `call` (транскрипт, запись, согласие, SSE, STT/TTS, слепой оценщик A-02 ×3). Четыре блока с вопросами — знакомство,
  разбор теста (технические компетенции подкатегории: ядро → с ошибками в тесте → верно), системный дизайн, работа в команде — 5–7 вопросов
  (до 9 с дополнительными), блок и компетенцию выбирает код (`plan.ts`), уровень вопроса 1/2/3 = Junior/Middle/Senior по сигналу
  интервьюера. Компетенция = «тема» карты глубины; сверху — оси (технический уровень, системное мышление, коммуникация), «соответствие
  грейду» (доля компетенций на уровне ≥ заявленного) и итог 0–100 (`verdict.ts`). Подтверждённые компетенции поднимают свои утверждения
  каталога до `platform`. Модель — `model.ts` (34 компетенции: 8 backend, 7 frontend, 8 ai, 7 engineering, 2 общие), тест сверяет её с
  каталогом, справочником подкатегорий и документом.
- **Модели:** `CallSession` (`kind=interview`, `verdictJson.interview`), `CallKind` и `LlmPurpose` += значения (миграция
  `20261010230000_call_kind_interview`).
- **Маршруты:** те же `/api/call/*` с `kind=interview` плюс `POST /api/call/{id}/interrupt` (кандидат перебил ИИ: реплика обрезается до
  услышанных предложений, хвост — интервьюеру). Страницы: `/interview` — результат и история, вход в режим созвона консультанта;
  `/interview/room` — комната звонка с перебиванием (`components/interview/InterviewRoom`, детектор речи `lib/vad.ts`, озвучка по
  предложениям `lib/sentences.ts`).
- **Env:** как у `call` (`CALL_DATA_DIR`, `CALL_DAILY_LIMIT`, `STT_*`, `TTS_*`).
- **Ограничения:** категорию не меняет; состав компетенций, фокусы, веса осей и пороги — экспертные, на людях не калиброваны; интервьюер видит
  названия компетенций и пометки «в тесте были ошибки/верно», не задания; в подборку и ранжирование результат пока не входит; stub:
  `interview_interviewer` отвечает по плану кода (`llm/providers/stub-interview.ts`).

### `project` — ступень 2, проект под работодателя
- **Назначение:** шаблоны (`platform/project-templates/<подкатегория>/<грейд>/<id>/`, [project-templates.md](project-templates.md)),
  условие и рубрика под потребность (LLM `project_spec` / `project_rubric`, детерминированный запасной путь), лента заданий
  без названия компании и зарплаты, взять задание (≤ 3 активных, срок по умолчанию 7 суток), сдача из публичного GitHub
  (≤ 5 сдач на задание, журнал ИИ ≤ 20 000 знаков), прогон в runner, отчёт работодателю, приглашение на защиту.
- **Модели:** `ProjectTemplate`, `ProjectTask` (одно на потребность, `visibility open|invited`), `ProjectAssignment`, `ProjectSubmission`.
- **Маршруты:** `GET /api/project-tasks/feed`, `GET /api/project-tasks/:id`, `POST …/take`, `GET …/skeleton.zip`, `POST …/submissions`,
  `GET /api/project-submissions/:id`, `POST /api/employer/needs/:id/project`, `GET /api/employer/project-templates`,
  `GET /api/employer/project-submissions`, `POST …/:id/invite-to-defense`.
- **Env:** `RUNNER_URL`, `RUNNER_TOKEN`, `GITHUB_TOKEN` (приватные репозитории).
- **Ограничения:** 56 шаблонов, покрыты все 54 категории (18 подкатегорий × 3 грейда; Junior по два в web-api и ui-app); открытая лента
  показывает направление кандидата и грейды не выше его категории; порядок: взятые, подкатегория кандидата (`preferredSubcategoryId`:
  категория из теста, иначе онбординг), соседние подкатегории того же направления; балл — доля пройденных скрытых тестов, рубрика LLM — пояснение и флаги, не балл; статанализ в отчёте
  «не выполнялся» (статанализ `lint` runner не выполняет, поле помечено `skipped`); без `RUNNER_URL` работает stub-runner (счёт по шаблону, не по коду); только публичный GitHub.

### `runner` — песочница автопроверки (`platform/runner/`, клиент `server/runner/client.ts`)
- **Назначение:** отдельный контейнер: распаковывает tarball репозитория, кладёт поверх тесты платформы и запускает только их
  (node20: vitest; python312: pytest). App сама скачивает архив (у runner нет интернета) и отдаёт его в `POST /uploads`.
  Подробно — [runner/README.md](../platform/runner/README.md).
- **Модели:** — (очередь и результаты в памяти runner).
- **Маршруты:** сервис `:8090` — `GET /health`, `POST /uploads`, `POST /run`, `GET /run/:jobId` (Bearer `RUNNER_TOKEN`); в app — только клиент.
- **Env:** app: `RUNNER_URL` (в compose `http://runner:8090`), `RUNNER_TOKEN` (≥ 32 символов). Runner: `RUNNER_TOKEN`, `RUNNER_PORT`,
  `RUNNER_LOCAL`, `RUNNER_WORK_DIR`, `RUNNER_TEMPLATES_DIR`, `RUNNER_JOB_MEM_MB`, `RUNNER_MAX_QUEUE`, `RUNNER_MAX_PENDING_MB`.
- **Ограничения:** одно задание за раз, очередь ≤ 5, архив ≤ 50 МБ, таймаут ≤ 300 с, 1,5 ГБ / 0,8 CPU; нет интернета, сервис не от root.
  Рестарт теряет очередь. Статанализ (`lint`) не выполняется — поле в отчёте помечено `skipped`. Балл — сигнал, не доказательство: код кандидата выполняется в одном процессе с vitest/pytest и может
  подделать результат; поэтому нужны рубрика и защита. `logTail` кандидату не показывать. `gateway_mode isolated` требует
  Docker Engine ≥ 28. Граница — общее ядро с хостом (без gVisor и Firecracker).

### `defense-room` — ступень 3, защита проекта
- **Назначение:** QLC-вопросы из кода и последних коммитов репозитория (`defense_qlc`: «что», «почему», «что сломается», «измени
  поведение», «смени ограничение»; снимок через GitHub API ≤ 14 файлов, ≤ 160 КБ), вопросы работодателя из очереди, интервьюер
  (`call_interviewer`, ≤ 1 уточнения), слепой оценщик A-02 ×3 с медианой и флагами, SSE-шина и сигналинг WebRTC. Работодатель входит
  в комнату, перебивает, «мьютит ИИ», говорит сам; режим `questions` — асинхронная дозащита по накопленным вопросам.
- **Модели:** `DefenseRoomPlan`, `CallSession` (`kind = defense`), `CallParticipant`, `EmployerQuestion`.
- **Маршруты:** `POST /api/defense-room/start`, `GET /api/defense-room/pending`, `GET|POST /api/defense-room/:id[/turn|finish]`,
  `GET …/events` (SSE), `POST /api/call/:id/signal`, `POST /api/employer/call/:id/{join|leave|mute-ai|say}`,
  `GET|POST /api/employer/questions`, `GET /api/employer/calls`; ИИ-защита своей проверенной сдачи без приглашения (ADR 0008 п. 1,
  `ai-defense.ts`) — `POST /api/defense-room/ai`, вердикт работодателю — `GET /api/employer/project-submissions/:id/ai-defense`.
- **Env:** `CALL_DATA_DIR`, `GITHUB_TOKEN`, `TTS_VOICE_EMPLOYER` (голос реплик работодателя), `STT_*`, `TTS_*`.
- **Ограничения:** флаги — `strong_project_weak_defense` (проект ≥ 0,8 по скрытым тестам, защита ниже порога),
  `short_defense` (< 3 ответов), `evaluator_disagreement`, `employer_questions_unanswered`, `no_project_result`; вердикта «фейк» нет;
  ≤ 3 завершённых защит на сдачу (суточный лимит: `defense-room/session.ts` считает за 24 ч все сессии кандидата любого вида, кроме `pending`, и берёт
  порог прямо из `CALL_DAILY_LIMIT`, настройку админки `call.dailyLimit` не читает; `call/service.ts` считает только сессии
  своего вида — модули считают по-разному; демо-кандидаты не ограничены; после закрывающей реплики ИИ молчит,
  реплики кандидата только пишутся в транскрипт), ответ ≤ 4000 знаков, в очереди ≤ 10 вопросов работодателя; **TURN нет**: аудио P2P через публичный
  STUN, за симметричным NAT не соединится — текстовый канал остаётся запасным; запись и контакты — после `accepted`; только GitHub-репозитории;
  оценщик на реальной модели не проверялся (валидация персонами — `docs/validation-stages.md`, дополняется).

---

## Работодатель

### `employer`
- **Назначение:** потребности (вакансии с требованиями из каталога, вилкой, командой), подбор и ранжирование (`ranking.ts`,
  веса в `weights.ts`), поиск по базе, приглашения (`sent → viewed → accepted|declined`; финальные `hired` — найм, `withdrawn` — отозвано работодателем,
  `closed_hired` — закрыто наймом в другую компанию), самоотклики кандидата на вакансию (`applications.ts`, R-C-12), приватность и псевдоним
  «Кандидат #XXXXXX» (`privacy.ts`), компания.
- **Модели:** `Company`, `Vacancy`, `Invitation`, `EmployerProfile`, `Application` (самоотклик), `Complaint`.
- **Маршруты:** `employer/vacancies[/:id[/matches]]`, `employer/search`, `employer/invitations`, `employer/company`,
  `invitations[/:id]`, `profile/privacy`, `profile/contact`; `employer/invitations/:id/{hire|withdraw}`, `invitations/:id/complaint`,
  `employer/vacancies/:id/applications`, `employer/applications/:id` (ответ на самоотклик), `employer/company/verification`
  (запрос ручной проверки компании), `employer/sanction-appeal`; кандидату — `career/vacancies[/:id/apply]`, `career/applications`.
- **Env:** `ATS_WEBHOOK_URL`, `ATS_WEBHOOK_SECRET` (необязательные, см. «Антифрод и ATS» ниже).
- **Ступени ADR 0003 в подборке** (`stages.ts`, `stages-load.ts`): `CandidateEvidence.calls/projects` грузятся пакетно (вердикт созвона —
  через `call/access.publicVerdict`, без цитат); `scoreCandidate` добавляет `PROJECT_BONUS_PER_SCORE` × балл за проверенный проект под
  ЭТУ потребность и `CALL_TOPIC_BONUS` за подтверждённые созвоном темы из требований (потолок `CALL_TOPIC_BONUS_MAX`); защита в балл
  не входит — флаг `strong_project_weak_defense` только пометка в `Explanation`; карточка показывает карту глубины, критерии своего
  проекта (чужие — подкатегория и балл), защиту, «Вопросы кандидату» и «Комнату защиты» (после принятого приглашения); пояснения
  рубрики до принятия проходят `maskContacts`.
- **Антифрод и ATS (концепт, R-X-01, R-X-02).** `antifraud.ts` — чистые функции без БД. `detectRedFlags` ищет в тексте потребности и
  приглашения признаки фиктивного предложения: нет вилки или она нереальна (меньше 25 000, больше 1 000 000 ₽, «до» выше «от» более чем
  втрое), почта, телефон или мессенджер в тексте, просьба оплатить обучение, оборудование, стажировку или взнос, обязательные ИП или
  самозанятость, обещания дохода без опыта, размытое описание. Работодатель видит предупреждение в формах потребности и приглашения
  (`RedFlagNotice`) до отправки, кандидат — пометку «Проверьте: …» на приглашении (`CandidateInvitationView.redFlags`). Флаг ничего не
  блокирует. `companyTrust` (`company.ts: loadCompanyTrusts`) считает «индекс доверия» 0–100 из заполненности профиля компании (35),
  ИНН с верной контрольной цифрой (25, реестр не сверяется), возраста первого представителя (15) и доли отклонённых приглашений (25, от 5
  приглашений); показывается кандидату с пометкой «концепция». Правила, пороги и веса — наше предложение, не калибровались на реальных
  обманах. `ats-webhook.ts` — подписанный вебхук о смене статуса приглашения (`sent`, `accepted`, `declined`; `viewed` не шлётся):
  тело JSON с идемпотентным `id` (`evt_` + sha256 от события, приглашения и статуса), заголовки `X-FSP-Event`, `X-FSP-Event-Id`,
  `X-FSP-Signature: sha256=<HMAC-SHA256 по телу>`, таймаут 5 с, сбой только в лог. Без `ATS_WEBHOOK_URL` и `ATS_WEBHOOK_SECRET` — no-op.
  В теле нет имени и контактов: псевдоним, `contactsOpen` и идентификаторы. Повторных попыток и очереди нет; получатель
  дедуплицирует по `id`.
- **Жалобы кандидатов и санкции (доп. функционал, R-X-01).** Кандидат жалуется на полученное приглашение кнопкой «Пожаловаться»
  (`ComplaintForm`) — `POST /api/invitations/{id}/complaint` `{ reason, comment? }`: причина `spam | salary_mismatch | offensive |
  fake_company | other`, комментарий до 1000 символов, одна жалоба на приглашение (повтор — 409), чужое — 404 (`complaints.ts`).
  Статус приглашения не меняется: отклонить кандидат может отдельно. Жалобы на компанию за 30 дней, кроме `dismissed`, снижают
  индекс доверия (−10 за жалобу, не больше −40) и включают санкцию `invitationSanction`: от 3 жалоб суточный лимит 20 → 5, от 5 —
  отправка закрыта (403 `company_blocked`). Санкция считается в транзакции `createInvitation` под тем же advisory-lock, что и
  суточный лимит. Работодатель видит предупреждение и сниженный лимит на странице «Приглашения» и в `GET /api/employer/invitations`
  (`limit.sanction`). Пороги — предложение, не калибровались. Не сделано: модерации и апелляции нет (R-D-05) — жалоба действует сразу,
  `dismissed`/`upheld` выставляются только вручную в БД; ассистент работодателя и счётчик лимита в боковой панели показывают базовый
  лимит 20, отправка всё равно проверяется сервером.
- **Ограничения:** без LLM; все веса и бонусы — предложения без калибровки; до `accepted` — псевдоним, категория, утверждения формулировкой каталога, отметка ФСП; лимит 20
  приглашений в сутки на компанию и одно открытое приглашение компании кандидату (предложение); компании по реестрам не сверяются — есть только ручная проверка модератором (`admin/moderation/verification.ts`, без API ФНС).

### `live-defense` — назначение живой защиты через слоты ([ADR 0008](decisions/0008-two-defenses-and-live-call-slots.md))
- **Назначение:** работодатель по принятому приглашению своей компании предлагает 2–5 слотов по 30 или 45 минут, кандидат выбирает
  один (с действующим согласием на запись) или отвечает «ни один не подходит»; выбор создаёт или привязывает ожидающую сессию защиты
  (`defense-room/pending.ts`). Правила слотов — чистые функции `rules.ts`.
- **Модели:** `LiveDefense` (`slots_proposed | scheduled | done | cancelled | no_show`), `LiveDefenseSlot`, `LiveDefenseEvent`.
- **Маршруты:** `POST /api/employer/invitations/:id/live-defense[/cancel]`, `POST /api/invitations/:id/live-defense/{choose|none-fit|cancel}`;
  голос работодателя в живой защите — `POST /api/employer/call/:id/audio`, `GET /api/call/:id/employer-audio[/file]`.
- **Env:** — (`APP_URL` для ссылок на комнату в письмах).
- **Ограничения:** слот не раньше чем через 2 часа и не позже 14 дней; комната открывается за 10 минут до начала; опоздание больше
  15 минут — `no_show`; отмена не позднее чем за 1 час (иначе 409 `cancel_too_late`); одно время компании не займут два кандидата
  (advisory-lock компании и уникальный `bookedKey` слота, 409 `slot_taken`); без проверенного проекта кандидата — 409 `project_not_submitted`.

### `favorites` — избранное
- **Назначение:** закладки обеих ролей: кандидат сохраняет вакансии, работодатель — кандидатов. Вид закладки определяется ролью
  аккаунта, а не телом запроса.
- **Модели:** `UserSavedVacancy`, `UserSavedCandidate`.
- **Маршруты:** `GET|PUT /api/favorites` (`{ kind: vacancy|candidate, targetId, saved }`). Страницы `(candidate)/saved`, `(employer)/employer/saved`.
- **Env:** —
- **Ограничения:** работодателю избранные кандидаты доступны после оферты и обязательства (ADR 0005, `assertEmployerConsents`);
  без профиля своей роли — 403.

### `companies` — каталог компаний для кандидата
- **Назначение:** список компаний с открытыми (неархивными) вакансиями и карточка компании: название, отрасль, описание,
  вакансии с вилкой. Сборка карточек — чистая функция `aggregate.ts`, запросы — `catalog.ts`.
- **Модели:** — (читает `Company`, `Vacancy`).
- **Маршруты:** API нет; страницы `(candidate)/companies` и `(candidate)/companies/[id]` читают сервис напрямую.
- **Env:** —
- **Ограничения:** контакт и ИНН компании не выбираются: инициатива у работодателя; компания без открытых вакансий не показывается.

---

## Для жюри

### `expert` — режим эксперта
- **Назначение:** страница `/expert`: жюри проходит настоящий тест на грейд без регистрации тем же сервисом, что у кандидата; грейд
  никому не присваивается.
- **Модели:** своих нет: одноразовые `Candidate` и `User` (`AuthAccount.provider = 'expert'`, почта `…@expert.invalid`), попытки — `TestAttempt`.
- **Маршруты:** `GET|POST /api/expert/start`, `GET /api/expert/attempt/:id`, `POST …/answer|finish|signal`.
- **Env:** `DEMO_LOGIN` (выключен — 404), `SESSION_SECRET` (подпись куки).
- **Ограничения:** своя кука `fsp_expert` (path `/api/expert`), вместо `cid` её подставить нельзя — остальные API эксперту закрыты; в
  подборку и поиск не попадает (`hiddenFromEmployers` и фильтр почты в `employer/matching.ts`); категорию после итога удаляет
  `scrubExpertCategories`; лимиты: 20 новых экспертов с адреса за 10 минут, 300 за сутки на всех, срок жизни эксперта — сутки.

### `validation` — страницы проверки для жюри
- **Назначение:** данные публичных страниц: `/validation` (цифры из закоммиченных `eval/test/results.json` и `eval/matching/results.json`
  и константы прогона персон, источник — [validation-results.md](validation-results.md)), `/method` (константы политики теста,
  информационная функция банка подкатегории, агрегат симуляций), `/simulator` (виртуальный кандидат с заданной θ проходит боевой
  движок теста шаг за шагом), `/evaluate` (наше ранжирование и базовая линия на наборе пользователя: P@k, nDCG@k, MRR).
- **Модели:** —
- **Маршруты:** `POST /api/evaluate`, `POST /api/simulator` (вход не нужен).
- **Env:** —
- **Ограничения:** без БД, LLM и сети, ничего не сохраняется; тело `/api/evaluate` ≤ 1 МБ, ≤ 50 вакансий, ≤ 1000 кандидатов, k ≤ 20;
  лимит с адреса за 10 минут — 30 прогонов `evaluate` и 120 `simulator`. Кандидаты симулятора смоделированы, параметры заданий
  экспертные и на людях не откалиброваны; режима «с угадыванием» в симуляторе нет.

### `mechanics` — «Лаборатория вариантов»
- **Назначение:** данные публичной страницы `/mechanics`: семейства генераторов теста по направлению и подкатегории, варианты одного
  семейства по seed, справка про утечку заданий (`leak-figures.ts`, цифры из [validation-results.md](validation-results.md)).
- **Модели:** —
- **Маршруты:** — (серверная страница, параметры в query: `spec`, `sub`, `family`, `seed`).
- **Env:** —
- **Ограничения:** только чтение реестра генераторов, без БД и LLM; логику теста, банк и политику не меняет; скрытая строка-ловушка
  для нейросети в публичный вывод не попадает; цифры про утечку на странице не пересчитываются.

---

## Персонал платформы

### `admin` — админка владельцев платформы (E-08, [ADR 0009](decisions/0009-admin-staff.md), [admin.md](admin.md))
- **Назначение:** вход персонала (почта и пароль, затем TOTP; `staff.ts`, `totp.ts`), три роли `owner | moderator | support` и матрица
  прав (`permissions.ts`), журнал действий (`audit.ts`). Разделы: модерация (жалобы, апелляции на санкции, красные флаги, возражения,
  ручная верификация компаний), пользователи, компании, кандидаты, вакансии, приглашения (блокировка, скрытие, удаление, раскрытие
  ПДн с причиной), настройки без деплоя с версиями и откатом, справочники, метрики (тест, подбор, LLM) и выгрузки CSV, демо-данные.
- **Модели:** `StaffMember`, `AdminSession`, `AdminAuditLog`, `SanctionAppeal`, `RedFlagReview`, `PlatformSetting`, `PlatformSettingVersion`.
- **Маршруты:** `/api/admin/*`: `auth/{login|totp|logout|me|password}`, `dashboard`, `users`, `companies`, `candidates`, `vacancies`,
  `invitations`, `applications`, `complaints`, `appeals`, `red-flags`, `objections`, `verification`, `settings[/:key[/rollback]]`,
  `catalogs`, `metrics/{test|matching|llm}`, `export/:file`, `audit`, `staff`, `demo`. Страницы — `(admin)/admin/*`, вход — `/admin/login`.
- **Env:** своих переменных в `env.ts` нет; кука подписывается `SESSION_SECRET`. Сотрудника создаёт `scripts/admin-create.ts`
  (пароль из stdin или `ADMIN_PASSWORD`, не из аргументов).
- **Ограничения:** персонал — не `UserRole`, своя кука `fsp_admin` (12 ч), каждый запрос сверяет сессию и сотрудника; журнал только
  на вставку (в БД триггер `AdminAuditLog_immutable`); намеренно нет ручной установки категории или грейда, входа под пользователем,
  показа паролей и токенов; секреты и `DEMO_LOGIN` в настройки не вынесены; лимиты входа — в памяти процесса.

---

## Сервисные

### `stt`, `tts`
- **Назначение:** голос в текст (Yandex SpeechKit v1 или Web Speech в браузере) и озвучка реплик аватара (SpeechKit TTS, второй
  голос — работодатель). «Говорящая голова» (`components/head/`) и `CallPanel` — клиентские.
- **Модели:** —
- **Маршруты:** `GET|POST /api/stt` (LPCM 16 бит моно 16 кГц, ≤ 1 МБ), `/api/tts`.
- **Env:** `STT_PROVIDER` (`auto|yandex|openai|browser|off`; openai - запасной whisper через OpenAI-совместимый `/audio/transcriptions`, нужны `STT_OPENAI_BASE_URL`, `STT_OPENAI_API_KEY`, опц. `STT_OPENAI_MODEL`), `TTS_PROVIDER` (`auto|yandex|off`), `TTS_VOICE`, `TTS_VOICE_EMPLOYER`, `TTS_EMOTION`,
  `TTS_SPEED`, `TTS_FORMAT`, `YANDEX_API_KEY`, `YANDEX_FOLDER_ID`.
- **Ограничения:** аудио ввода не хранится (аудио созвона хранит `call` с согласия); без ключей озвучки реплики остаются текстом.

### `demo`, `devtools`, `openapi`
- **Назначение:** демо-режим для жюри (вход за сид-кандидата, «Новый пользователь», демо-резюме PDF); отладочная панель и
  `/api/dev/*`; генерация и раздача OpenAPI 3.1 (`scripts/build-openapi.ts` → `docs/openapi.yaml`, `/api-docs`, `GET /api/openapi`).
- **Модели:** —
- **Маршруты:** `demo/login`, `demo/resume`, `dev/*`, `openapi`.
- **Env:** `DEMO_LOGIN`, `DEVTOOLS`, `COLLECTOR_FIXTURES`, `LLM_STUB_DEMO`.
- **Ограничения:** `dev/*` — только localhost и не production; `DEMO_LOGIN=true` на стенде, пока его смотрит жюри; формы ответов, которых
  нет в коде как схем, описаны вручную в `scripts/openapi/overrides.ts`; тест падает, если спецификация отстала от маршрутов.

---

## Страницы и клиентские компоненты

Страницы: `(candidate)/{profile,test,defense,defense-room,interview,invitations,projects,career,saved,settings,skills}`, `(shared)/consultant` (чат и режим звонка
`components/call/CallPanel`, `DepthMap` в профиле), `(employer)/employer/{,needs,search,invitations,calls,company,assistant,saved,vacancies}`, `(admin)/admin/*`, `onboarding`,
`auth`, `consent`, `demo`, `expert`, `validation`, `method`, `simulator`, `evaluate`, `mechanics`, `ai`, `privacy`, `terms`, `employer-terms`, `site-access`,
`design/*` (превью, не для пользователей), `api-docs` (Swagger UI).

## Общие файлы: правила правки

- `prisma/schema.prisma` — секции помечены `// lane: <модуль>`; правим аддитивно и в своей секции. Каждое изменение схемы —
  новая миграция (`npm run db:migrate`), старые не переписывать. Сид — `prisma/seed.ts` + `prisma/seed/*`.
- Направления и генераторы теста — файл в `src/server/test/generators/` + регистрация в `index.ts`; записи каталога направления —
  `scripts/catalog-direction-entries.json` и `node scripts/catalog-to-json.mjs` (каталог-Markdown владельца не трогаем).
- `src/server/agent/tools/index.ts` — реестр инструментов консультанта. Новый инструмент: файл в `tools/`, строка в реестре, правка
  `tests/unit/agent/tools.test.ts`. Записывающих в профиль и пишущих от имени пользователя инструментов быть не должно (тест это
  проверяет). У работодателя свой реестр — `agent/employer/tools/index.ts`.
- `package.json` / `package-lock.json` — новые зависимости только с обоснованием; лок-файл коммитить вместе.
- `src/styles/tokens.css` — единственный источник цветов; в `*.module.css` нет сырых `#hex`/`rgb()`
  (`tests/unit/design-tokens.test.ts`). Новый токен или компонент сначала описать в [design-system.md](design-system.md).
- `src/server/env.ts` + `.env.example` — новая переменная добавляется в оба места.
- Новый или изменённый маршрут API — `npx tsx scripts/build-openapi.ts` (тест сверяет файл со спецификацией).
- Промпты — `*.md` рядом с модулем (`agent/prompts`, `claims/prompts`, `defense/prompts`, `call/prompts`, `defense-room/prompts`);
  `.ts`-копии (`agent/prompt.ts`, `onboarding/prompt.ts`) собираются `npx tsx scripts/build-prompts.ts` — не править вручную.
- Шаблоны проектов — [project-templates.md](project-templates.md); скрытые тесты опубликованного шаблона не меняются.

## Тесты

| Вид | Где | Как гнать точечно (из `platform/`) |
|---|---|---|
| unit (Node) | `tests/unit/**/*.test.ts` | `npx vitest run tests/unit/<модуль>` |
| компоненты (jsdom) | `tests/unit/**/*.test.tsx` | `npx vitest run tests/unit/components/<файл>` |
| integration (реальная БД) | `tests/integration/<модуль>/` | `npx vitest run tests/integration/<модуль>`; нужна `TEST_DATABASE_URL`, имя БД содержит `test` (её чистят) |
| runner | `tests/runner/` | `npm run test:runner` (локальный режим); в контейнере — `RUNNER_DOCKER=1 npx vitest run --project runner tests/runner/docker.test.ts` |
| e2e | `e2e/*.spec.ts` (Playwright, `next dev` на :3100) | `npx playwright test e2e/<файл>` |
| eval (валидация, не CI) | `eval/` | `npx tsx eval/run.ts --predictor catalog-keywords` (извлечение), `npx tsx eval/matching/run.ts` (подбор), `npx tsx eval/test/run.ts`, `eval/test/personas.ts`, `eval/test/subcategory-personas.ts` (тест на грейд), `eval/prompt-traps/run.ts`, `eval/llm-bench/` |

Хелперы — `tests/helpers/*` (`resetDb()`, `jsonRequest()`). Проекты Vitest: `unit`, `components`, `integration`, `runner`
(`vitest.config.mts`). Полный прогон, `next build`, Playwright — последовательно, машина слабая.

## Заглушки и имитации

- **LLM:** `LLM_PROVIDER=stub`; `LLM_STUB_DEMO=true` — извлекатель размечает резюме словарём каталога, консультант отвечает шаблонами.
- **Созвон:** `call_interviewer` / `call_evaluator` на stub отвечают детерминированно по `<call_context>` (`llm/providers/stub-call.ts`):
  сигнал маршрута — по длине ответа, баллы — по признакам в тексте. ИИнтервью: `interview_interviewer` — вопрос-шаблон по плану кода (`stub-interview.ts`), оценщик тот же.
- **Проекты:** при `LLM_PROVIDER=stub` условие и рубрика собираются детерминированно (`project/fallback.ts`); пустые
  `RUNNER_URL`/`RUNNER_TOKEN` — stub-runner (`project/runner-client.ts`: адрес с `reference` — всё зелёное, `starter` — всё красное,
  `runner-fail` — сбой). Репозитории `https://github.com/fsp-demo/…` в защите — встроенные фикстуры.
- **Профили без сети:** `COLLECTOR_FIXTURES=true` (`collector/fixtures.ts`).
- **ФСП** — демонстрационный источник (`collector/fsp-demo.ts`: `not_linked | no_achievements | unavailable | linked`). Вход и привязка
  через ФСП ID (`server/fsp-id`, `/api/fsp-id/*`) работают с имитацией: при заданных `FSP_OIDC_ISSUER` и `FSP_OIDC_CLIENT_SECRET` — симулятор
  ФСП ID команды на Keycloak, иначе встроенный мок с выбором демо-участника. С настоящим ФСП ID и реестром ФСП интеграции нет.
- **Яндекс ID:** пусто `YANDEX_CLIENT_ID/SECRET` — кнопка в окне входа скрыта, остаётся демо-вход (`DEMO_LOGIN=true`, `/demo`).
- **Голос:** без ключей SpeechKit ввод распознаёт браузер, озвучки нет.
- **Тест:** `TEST_DEMO_INTERVALS=true` — интервалы пересдачи в минутах (стенд жюри); `JURY_INSIGHTS=true` — слой жюри над тестом (на проде не включать).
- **Почта:** `SMTP_HOST/PORT` (Mailpit на стенде); `MAIL_PROVIDER=log` — только в лог.
- **Отладочная панель** и `/api/dev/*`: только localhost и не production; выключатель `DEVTOOLS=false`.
