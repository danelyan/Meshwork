# ADR 0003. Три ступени оценки: созвон → проект под работодателя → защита

- Статус: принято 10.10.2026 (решения владельца продукта, виджеты 10.10); реализация — лейнами по
  плану ниже
- Основание: ресёрч владельца `research/24` (мировая практика: Karat, Codility, micro1; Lehtinen/QLC —
  вопросы по своему коду предсказывают успех лучше сданного кода; индустрия 2025–26 разрешает ИИ и
  проверяет понимание), инвентаризация кода 10.10
- Не отменяет ADR 0001 (профиль доказанности) и ADR 0002 (тест на грейд): **категорию задаёт тест**,
  ступени добавляют доказательства и картину для работодателя

## Решения

1. **Ступень 1 — квалифицирующий созвон** в том же чате кандидата (`/consultant`): кнопка
   «Созвониться» или предложение агента → правая панель переключается в режим звонка (аватар сверху,
   текст реплики ИИ снизу, микрофон, индикатор записи), лента чата сворачивается. ИИ задаёт 4–6
   зондирующих вопросов по специализации и резюме (маршрут по уровню: после ответа — уровень выше или
   ниже), **отдельный слепой оценщик** по рубрике A-02 (глубина / «почему так» / граница знаний /
   доведение, 0–2) ставит оценку по каждой затронутой теме. Результат — «карта глубины»
   (тема → заявлено → копнули → подтвердилось/нет) в профиле кандидата и в карточке работодателя.
   Категорию не меняет; утверждения, подтверждённые в созвоне, получают уровень `platform` (как защита).
2. **Ступень 2 — проект под работодателя.** Работодатель выбирает **базовый шаблон** платформы
   (спец × грейд; контракт + скрытые тесты фиксированы), задаёт **обязательные критерии** (из каталога
   утверждений) и **пожелания свободным текстом**; ИИ формирует условие проекта в домене работодателя и
   рубрику для LLM-проверки пожеланий. Кандидат получает проект по приглашению (или сам берёт открытый
   проект потребности), пушит репозиторий, указывает **журнал работы с ИИ** (ИИ разрешён явно).
   Автопроверка: скрытые тесты шаблона → балл (воспроизводим); статанализ; LLM-рубрика по критериям
   и пожеланиям → пояснения и флаги, **не балл**. Результат — таблица «критерий → прошёл/нет →
   доказательство» в отчёте работодателю. Детали шаблонов — после разведки Worker-билдера (отдельный
   раздел ниже, дополняется).
3. **Ступень 3 — защита проекта.** Ведёт ИИ голосом с аватаром (тот же режим звонка): вопросы
   генерируются из кода и коммитов кандидата (QLC), плюс «измени поведение»/«смени ограничение», плюс
   очередь вопросов работодателя. **Работодатель может подключиться живьём**: входит в комнату, может
   перебить, «замьютить ИИ» (ИИ не вступает, пока не разрешат) и говорить сам — аудио **WebRTC P2P**
   (сигналинг через наш API, публичный STUN), текст как запасной канал. Вопросы работодателя, заданные
   **после** защиты, копятся в очереди и задаются кандидату при следующем входе (асинхронная дозащита).
   Оценка — по рубрике A-02 отдельным оценщиком; **слабая защита при сильном проекте = флаг
   работодателю, не понижение**; автоматического вердикта «фейк» нет (ст. 16 152-ФЗ).
4. **Запись.** Транскрипт + аудио кандидата (файлы на диске, не в БД), отдельный пункт согласия перед
   первым звонком; работодатель видит запись только после принятого приглашения (R-C-16: до контакта —
   псевдоним). В подборке — только оценки по рубрике и флаги.
5. **LLM.** Локально — ключи владельца (`openai-chat`/DeepSeek и Yandex); если оценщику не хватает
   мощности — более сильная модель через российских провайдеров или локальная. Все новые вызовы — через
   `llm/client.ts` с новыми `LlmPurpose`, stub-провайдер возвращает детерминированные ответы.

## Контракты для параллельных лейнов (обязательны)

### Схема данных (`prisma/schema.prisma`, секции `// lane: <name>`; миграции собирает интегратор)

- `CallSession` (lane call): id, candidateId, kind `qualifying | defense`, projectSubmissionId?,
  status `active | finished | cancelled`, startedAt, finishedAt, transcriptJson (реплики с ролями
  `ai | candidate | employer`, таймкоды), audioPath?, verdictJson? (рубрика), policyVersion.
  `DefenseSession` остаётся для защиты утверждений; защита проекта — `CallSession.kind=defense`.
- `CallParticipant` (lane call): callSessionId, userId, role `employer`, joinedAt, leftAt,
  aiMuted bool.
- `EmployerQuestion` (lane call): id, companyId, candidateId, projectSubmissionId?, text, askedAt,
  answeredInCallSessionId?, status `queued | asked | answered`.
- `DepthMap` — не отдельная модель: результат ступени 1 хранится в `CallSession.verdictJson` и
  проецируется в `Claim.level=platform` для подтверждённых утверждений.
- `ProjectTemplate` (lane project): id, specialization, grade, title, contractMd, hiddenTestsRef
  (путь в `platform/project-templates/<id>/`), stackTags, visibleTestsRef.
- `ProjectTask` (lane project): id, vacancyId, templateId, specJson (сгенерированное условие),
  requiredCatalogIds[], wishesText, rubricJson, createdAt.
- `ProjectSubmission` (lane project): id, projectTaskId, candidateId, repoUrl, commitSha,
  aiLogText, status `submitted | running | checked | failed`, resultJson (тесты / статанализ /
  рубрика), submittedAt, checkedAt.
- `Consent` — новая версия с пунктом записи (lane call), константа версии в одном месте.

### API (все маршруты — в OpenAPI через `npm run build-openapi`; zod-схемы в `src/server/*/schemas.ts`)

- lane call: `POST /api/call/start {kind, projectSubmissionId?}` → `{sessionId, webrtc: {iceServers}}`;
  `POST /api/call/{id}/turn {text | audioRef}` → реплика ИИ `{text, audioUrl?, done}`;
  `GET /api/call/{id}/events` (SSE: реплики, участники, mute, вопросы работодателя);
  `POST /api/call/{id}/finish`; `POST /api/call/{id}/signal {sdp|ice}` (сигналинг WebRTC);
  `POST /api/employer/call/{id}/join | /mute-ai | /say {text}`; `GET /api/call/{id}/recording`
  (кандидату — всегда, работодателю — после accepted-приглашения);
  `POST /api/employer/questions {candidateId, text}`; `GET /api/employer/questions?candidateId=`.
- lane runner: внутренний сервис `runner` (compose), HTTP `POST /run {repoTarballUrl | repoUrl,
  commitSha, testsBundleRef, image, timeoutSec}` → `{jobId}`; `GET /run/{jobId}` →
  `{status, tests: [{name, passed, ms}], lint: {...}, logTail, durationMs}`; без сети у задания,
  лимиты CPU/RAM/время/размер, один job за раз на машине; токен между app и runner
  (`RUNNER_TOKEN`).
- lane project: `POST /api/employer/needs/{id}/project` (создать/перегенерировать задание),
  `GET /api/project-tasks/{id}` (кандидату — условие, видимые тесты),
  `POST /api/project-tasks/{id}/submissions {repoUrl, aiLogText}`,
  `GET /api/project-submissions/{id}` (статус/результат), `GET /api/employer/project-submissions?needId=`.

### Точки стыка

- Ранжирование/карточка: `CandidateEvidence` получает `calls: {qualifying?: verdict, defense?:
  verdict}` и `projects: [{taskId, score, flags}]`; `scoreCandidate` учитывает проект под **эту**
  потребность (бонус, константа в `employer/weights.ts`), `Explanation` и `CandidateCard` показывают
  карту глубины, результат проекта, флаги защиты. Это делает lane employer-card **после** остальных.
- Уровень `platform` для утверждений — только через существующий путь (`claim.updateMany`, как в
  `test/service.ts:342` и `defense/session.ts`).
- Stub: `llm/providers/stub.ts` получает детерминированные ответы для новых purpose
  (`call_interviewer`, `call_evaluator`, `project_spec`, `project_rubric`, `defense_qlc`).
- UI: режим звонка — компонент `CallPanel` в правой панели `/consultant` (тот же аватар
  `components/avatar`, `/api/tts`, `/api/stt`), кнопка в `Composer`; работодатель — страница
  `/employer/calls/[id]` (комната) и блок «Вопросы кандидату» в карточке.

## План лейнов (параллельно, worktree на лейн, release-check перед push)

| Лейн | Модель | Содержание | Зависит от |
|---|---|---|---|
| call | opus | `CallSession`, интервьюер+оценщик ступени 1, SSE, режим звонка в UI, запись, согласие | — |
| runner | opus | сервис `runner` в compose, образы node/python, лимиты, API, тесты | — |
| defense-room | opus | защита проекта в `CallSession.kind=defense`: QLC-вопросы из репо, WebRTC-сигналинг и P2P-аудио, подключение/мьют/реплики работодателя, очередь вопросов, страница комнаты | call (общие модели — через `// lane:` секции и единый контракт выше) |
| project | opus | шаблоны (после разведки Worker), генерация условия, сабмит, вызов runner, рубрика, отчёт | runner (контракт), разведка Worker |
| employer-card | sonnet | `CandidateEvidence`/`scoreCandidate`/`CandidateCard`/объяснение — новые поля | call, project |
| validation | opus | персоны для ступеней 1 и 3 (сам / ИИ целиком / понимает частично), повторяемость оценщика ×3, цифры в `validation-results.md` | call, defense-room |
| docs | sonnet | `platform.md`, `modules.md`, CJM, документ сдачи, OpenAPI | все |

## Открыто

- Шаблоны проектов: сколько, какой стек, формат скрытых тестов — по разведке Worker-билдера.
- Видео-запись кандидата — рассматривается (владелец), в этот план не входит.
