# Трассировка требований ТЗ и граница доказательств

Актуальность: **10 октября 2026**, состояние ветки `main` (коммит 4a97859). Критерий оценки 5 («полнота и документация», 6 %) и опора для питча.
Статус выставлен по коду (`platform/src`) и тестам (`platform/tests`), а не по обещаниям документов. Что не удалось проверить по коду — «не проверено».

Идентификаторы `R-*` — реестр требований владельца (`fsp/docs/context/requirements.md`, приоритет и страница ТЗ там же). В командном `docs/requirements.md` те же требования нумеруются иначе (C01, E01, M01…); соответствие по смыслу.

**Условные обозначения.** Пути кода — от `platform/src/`, тестов — от `platform/tests/`. «Стенд» — https://fsp2.ru; вход жюри — `/demo` (сквозной сценарий — [submission/fsp-career.md](submission/fsp-career.md), приложение А). Статусы: **готово** / **частично** / **нет** / **не проверено** / **в работе (лейн …)** — лейн ещё не слит в `main`, статус после слияния нужно пересмотреть.

## 1. Трассировка по требованиям

### Кандидат

| ID | Статус | Где в коде | Чем подтверждено | Как увидеть на стенде | Оговорка |
|---|---|---|---|---|---|
| R-C-01 Профиль вручную | частично | `server/onboarding/` (сценарий `scenario.ts`, движок `engine.ts`), `components/ProfilePage.tsx` | `unit/onboarding/engine.test.ts`, `integration/onboarding/api.test.ts`, `unit/components/profile-page.test.tsx` | `/onboarding` (чат-опрос), затем `/profile` | Отдельной формы профиля нет: данные собирает чат-онбординг и резюме; правка — через карточки утверждений |
| R-C-02 PDF-резюме с распознаванием | частично | `server/collector/files.ts`, `parse-worker.ts`, `server/claims/extractor.ts`, `server/resume-fields/`, `app/api/uploads/route.ts` | `unit/collector/files.test.ts`, `integration/collector/upload-files.test.ts`, `unit/claims/extractor.test.ts`, `unit/resume-fields/*`, `integration/resume-fields/upload-fields.test.ts` | `/consultant` → скрепка → `demo-1.pdf`, затем `/profile` → «Из резюме» | Форматы PDF, DOCX, MD, TXT, CSV до 5 МБ. Распознаются утверждения о навыках и стеке с дословной цитатой и рекомендация грейда (LLM). ФИО, контакт (почта/Telegram), стаж, роли (без компаний) и софт-скиллы (словарь) — детерминированными правилами `server/resume-fields/parse.ts`, с цитатой: пустые поля профиля заполняются с пометкой «из резюме», заполненные не перетираются — предложение «в резюме указано иначе». Правила покрывают типовую разметку резюме, на произвольных резюме распознавание неполное. ФИО и контакт работодателю — только после принятия приглашения |
| R-C-03 PDF-профиль | частично | `components/ProfilePage.tsx` (кнопка «PDF-профиль» → `window.print()`) | `unit/components/profile-page.test.tsx` (отрисовка страницы, не PDF) | `/profile` → «PDF-профиль» | Печатная версия страницы: файл формирует браузер, серверной генерации PDF нет |
| R-C-04 Опрос по отрасли и специализации | готово | `server/onboarding/scenario.ts` (шаги `specialization`, `subcategory`, `goal`, `stack`), `server/directions.ts` | `unit/onboarding/engine.test.ts`, `integration/onboarding/api.test.ts` | `/onboarding` | Отрасль спрашивается у работодателя (`industry`); у кандидата — специализация и подкатегория |
| R-C-05 Выбор предполагаемого грейда | готово | шаг `grade` в `scenario.ts`; `app/api/test/start/route.ts` (`grade`) | `integration/test/grade-test.test.ts` | `/onboarding` → `/test` | — |
| R-C-06 Тест на заявленный грейд → категория | готово | `server/test/{service,policy,irt}.ts`, `server/test/generators/`, `CandidateCategory` (источник — только тест) | `integration/test/grade-test.test.ts`, `unit/test/irt.test.ts`, `unit/test/senior-policy.test.ts`, `unit/test/junior-probe.test.ts` | `/test` | Параметры заданий `a`, `b` экспертные, на людях не оценены (раздел 3, критерий 2) |
| R-C-07 Статус и история | частично | `app/api/test/attempts/route.ts`, `components/ProfilePage.tsx`, `components/TestPage.tsx` | `unit/components/profile-page.test.tsx`, `unit/components/test-page.test.tsx`, `integration/test/grade-test.test.ts` | `/profile`, `/test` | История попыток теста — есть. История опросов (версионность ответов онбординга) — не проверено |
| R-C-08 Пересдача без принудительного понижения | готово | `server/test/service.ts`, `server/recommend/test.ts` (Middle не понижается), `app/api/test/attempt/[id]/confirm-junior/route.ts` | `integration/test/grade-test.test.ts` (строки «Middle не сдан → предложение Junior»), `integration/recommend/recommend.test.ts` («R-C-08») | `/test` после неудачной попытки | — |
| R-C-09 Ограничение частоты смены грейда | готово | `server/test/service.ts` (`GRADE_CHANGE_INTERVAL_DAYS` = 30, `RETAKE_SAME_GRADE_DAYS` = 14), коды `grade_change_too_soon`, `retake_too_soon` | `integration/test/grade-test.test.ts` («интервалы R-C-09») | `/test` (на стенде демо-интервалы 2 и 1 минута) | Интервал выбран нами (предложение, не калибровка); на стенде сокращён для показа |
| R-C-10 Регулярные задания от работодателя | нет | — (ближайший аналог: проектное задание ступени 2, `server/project/`) | `integration/project/project-flow.test.ts` (аналог) | `/projects` (аналог) | Регулярных коротких заданий и влияния на «актуальность» профиля нет; проектное задание — разовое, сверх ТЗ |
| R-C-11 Входящие приглашения, принять/отклонить | готово | `server/employer/invitations.ts`, `app/api/invitations/[id]/route.ts`, `components/candidate/CandidateInvitations.tsx` | `integration/employer/employer-api.test.ts` («приглашение → кандидат видит своё → принял»), `integration/employer/invite-contact.test.ts` | `/invitations` | — |
| R-C-12 Вакансии, самоотклик, мои отклики | частично | `app/api/career/vacancies/route.ts`, `server/recommend/career.ts`, `components/candidate/CareerPage.tsx` | `unit/recommend/career-route.test.ts`, `unit/recommend/career.test.ts`, `integration/recommend/recommend.test.ts` | `/career` | Есть подборка вакансий под профиль. Самоотклика и списка «мои отклики» нет (модели отклика в `prisma/schema.prisma` нет) |
| R-C-13 Настройки приватности | частично | `app/api/profile/privacy/route.ts`, `server/employer/privacy.ts`, `components/employer/PrivacyToggle.tsx` | `integration/employer/employer-api.test.ts` («скрытый кандидат не виден»), `unit/app/candidate-guard.test.tsx` | `/settings` | Один флаг «скрыть меня от работодателей» (`hiddenFromEmployers`); выбора отдельных полей нет |
| R-C-14 Согласие (152-ФЗ) | готово | `server/auth/consent.ts` (версия и время), `app/consent/page.tsx`, `app/api/auth/consent/route.ts`, `server/auth/erase-account.ts` (удаление аккаунта) | `integration/auth/roles.test.ts` («согласие: фиксируется версия»), `integration/auth/email-auth.test.ts` («без согласия аккаунт не создаётся»), `integration/auth/account-erasure.test.ts` | `/consent`, `/settings`; шаг `consent` онбординга | Юридическая проверка текста согласия — не проверено |
| R-C-15 Привязка ФСП ID | частично | шаг `fsp` в `server/onboarding/scenario.ts`, `Candidate.fspState`, `server/collector/fsp-demo.ts`, `server/fsp-id/` (OIDC-клиент, мок провайдера, реестр), `app/api/fsp-id/` | `unit/collector/profiles.test.ts`, `unit/components/profile-page.test.tsx`, `unit/fsp-id/oidc.test.ts`, `unit/fsp-id/routes.test.ts` | `/settings` → «Привязать ФСП ID» → выбор демо-участника | Вход по OIDC (Authorization Code + PKCE, проверка ID-токена по JWKS) работает; провайдер на стенде — встроенный мок ФСП ID, участники и достижения демонстрационные. Симулятор команды на Keycloak подключается через env (нужен секрет клиента) |
| R-C-16 Только свои приглашения и отклики | готово | `server/auth/access.ts` (карта страниц, API, действий), гварды `requireCandidate/requireEmployer`, выборка по `candidateId` сессии | `unit/auth/access-coverage.test.ts` (каждый маршрут в карте), `integration/auth/roles.test.ts`, `integration/employer/employer-api.test.ts` (чужая потребность), `integration/recommend/recommend.test.ts` (чужое приглашение — 404) | — (проверка негативных путей) | — |

### Работодатель

| ID | Статус | Где в коде | Чем подтверждено | Как увидеть на стенде | Оговорка |
|---|---|---|---|---|---|
| R-E-01 Профиль компании | готово | `server/employer/company.ts`, `app/api/employer/company/route.ts`, `components/employer/CompanyForm.tsx` | `integration/employer/company-api.test.ts`, `unit/employer/company.test.ts` | `/employer/company` | — |
| R-E-02 Описание потребности | готово | `server/employer/vacancies.ts`, `schemas.ts` (`VacancyInput`: специализация, грейд, подкатегория, требования из каталога), `components/employer/VacancyForm.tsx`, помощник `server/agent/employer/` | `integration/employer/employer-api.test.ts` («потребности: создание, правка, архив»), `unit/employer/ranking.test.ts` («потребность») | `/employer/needs/new`, `/employer/assistant` | Требования выбираются только из каталога утверждений своей специализации |
| R-E-03 Подборка с обоснованием | готово | `server/employer/matching.ts` (`matchForVacancy`), `ranking.ts` (`Explanation`), `components/employer/MatchResults.tsx`, `CandidateMatchCard.tsx` | `unit/employer/ranking.test.ts` («объяснение: закрывает N из M, доказанное, нехватка, ФСП, категория»), `integration/employer/employer-api.test.ts` («подборка: ранжирована, с обоснованием») | `/employer/needs/[id]` | — |
| R-E-04 Поиск по банку с фильтрами | готово | `matching.ts` (`searchBank`), `ranking.ts` (`MatchFilters`: специализация, подкатегория, грейд, стек, ФСП, только с категорией), `components/employer/FilterForm.tsx` | `integration/employer/employer-api.test.ts` («поиск по банку (R-E-04)»), `unit/employer/ranking.test.ts` («фильтры») | `/employer/search` | Фильтр ФСП — по факту привязки (`fspState = linked`), не по содержанию достижений |
| R-E-05 Приглашение без привязки к вакансии | готово | `server/employer/invitations.ts` (`vacancyId` необязателен), `components/employer/InviteForm.tsx`, `InvitationTracker.tsx` | `integration/employer/employer-api.test.ts` («без привязки к потребности (R-E-05)»), `unit/employer/ranking.test.ts` («приглашение») | карточка кандидата → «Пригласить»; `/employer/invitations` | Дневной лимит приглашений компании — 20 (`weights.ts`), ответ 429 покрыт тестом |
| R-E-06 Вакансии и отклики | частично | `server/employer/vacancies.ts` (создание, правка, архив), `app/(employer)/employer/needs/[id]/edit` | `integration/employer/employer-api.test.ts` | `/employer/needs/new`, `/employer/needs/[id]/edit` | Откликов кандидатов нет (см. R-C-12), значит просмотра и обработки откликов тоже нет |
| R-E-07 Контакты скрыты до принятия | готово | `server/employer/privacy.ts` (псевдоним `Кандидат #…`, `contacts: null` до `accepted`), `server/employer/matching.ts` (`acceptedCandidateIds`) | `unit/employer/ranking.test.ts` («приватность карточки (R-E-07)»), `integration/employer/invite-contact.test.ts`, `integration/employer/employer-api.test.ts`, `integration/agent/employer-assistant.test.ts` | работодатель: карточка до и после принятия приглашения | Помощник работодателя использует ту же карточку. **в работе (лейн extras)**: автотест приватности по всем маршрутам |

### Поиск и подбор

| ID | Статус | Где в коде | Чем подтверждено | Как увидеть на стенде | Оговорка |
|---|---|---|---|---|---|
| R-M-01 Выдача по категориям, не по самоописанию | готово | `prisma/schema.prisma` (`CategorySource` = только `test`), `server/employer/ranking.ts` (категория — множитель покрытия, `CATEGORY_MULT_*`), `dropUncovered` | `unit/employer/ranking.test.ts` («категория — множитель покрытия», «только категория остаётся в подборке») | `/employer/needs/[id]` | Утверждения «со слов» в покрытии весят 0,25; доказанные — выше |
| R-M-02 Ранжирование внутри категории: тест + ФСП | частично | `ranking.ts` (`FSP_BOOST` = 0,05, доказанность утверждений, подкатегория), `weights.ts` | `unit/employer/ranking.test.ts` («ФСП — небольшая прибавка, отсутствие не штрафуется») | карточка кандидата: «ФСП: …» в обосновании | θ и уверенность теста в балл не входят; вес ФСП фиксированный. **в работе (лейн ranking)**: вес ФСП, близость технологий |
| R-M-03 Ранжирование под потребность + объяснимость | готово | `ranking.ts` (`scoreCandidate`, `Explanation`), `weights.ts` | `unit/employer/ranking.test.ts` (детерминизм, объяснение), `eval/matching/run.ts` (метрики, раздел 3) | `/employer/needs/[id]` | Веса — наши предложения, не калиброваны на живой разметке. **в работе (лейн match-eval)**: расширенный набор, BM25 |
| R-M-04 Уточнение без потери подборки | частично | `components/employer/FilterForm.tsx`, `RefinementHistory.tsx` (прежние выдачи по URL, список в `sessionStorage` вкладки), фильтры в query | `integration/employer/employer-api.test.ts` («фильтры — query (R-M-04)»), `unit/components/employer-astra.test.tsx` | `/employer/needs/[id]` → фильтры → «прежние выдачи» | История — на вкладку браузера, не на сервере. **в работе (лейн ranking)**: подсказки ослабления фильтров |

### Механика тестирования

| ID | Статус | Где в коде | Чем подтверждено | Как увидеть на стенде | Оговорка |
|---|---|---|---|---|---|
| R-T-01 Устойчивость к распространению заданий | готово | `server/test/generators/` (параметрические генераторы, экземпляр от `seed` попытки), `server/test/rng.ts` | `unit/test/generators.test.ts` (разные seed — разные варианты, ключ проверяется), `integration/test/grade-test.test.ts` («повторяемость: тот же seed → те же задания») | `/test` у двух кандидатов — разные числа в условиях | Экспозиция шаблонов (доля попыток 0,49–0,94) и точечно-бисериальная в [validation-results.md](validation-results.md); утечка на живых людях не проверялась |
| R-T-02 Сопоставимость и объективность | частично | `server/test/irt.ts`, `policy.ts`; ключ считает код, не модель | `unit/test/irt.test.ts`, `unit/test/senior-policy.test.ts`; персоны — `eval/test/subcategory-personas.ts` | `/test` | Параметры `a`, `b` экспертные, на людях не оценены; цифры — симуляция |
| R-T-03 Формат заданий | частично | `server/test/answers.ts`, `generators/` | `unit/test/generators.test.ts` | `/test` | Форматы: число, вывод кода, строка с дефектом, список. Написание кода — только в проектном задании (ступень 2, `server/project/`) |
| R-T-04 Вакансии → задания и тесты | частично | `Vacancy.needs` (id утверждений каталога), `catalogIds` у генераторов, `server/project/service.ts` (шаблон проекта по потребности) | `integration/project/project-flow.test.ts`, `unit/project/templates.test.ts` | `/employer/needs/[id]` → «Проектное задание» | Тест на категорию из вакансии не собирается (единый по категории); связь — через каталог утверждений. Для проекта — собирается. Описание — [submission/fsp-career.md](submission/fsp-career.md), п. 2.7 |
| R-T-05 Справочник специализаций и грейдов | готово | `server/directions.ts`, `app/api/directions/route.ts`, `lib/directions.ts`, `lib/grades.ts` | `unit/lib/directions.test.ts` | `/onboarding` (шаги специализации и подкатегории) | 4 направления × 17 подкатегорий × 3 грейда — шире, чем нужно по ТЗ |

### Данные и видимость

| ID | Статус | Где в коде | Чем подтверждено | Как увидеть на стенде | Оговорка |
|---|---|---|---|---|---|
| R-D-01 Зарплата «от–до» обязательна | готово | `server/employer/schemas.ts` (`VacancyInput`, приглашение: «от» ≥ 1, «до» ≥ «от»), поля `salaryFrom/salaryTo` в `Vacancy`, `Invitation` | `unit/employer/ranking.test.ts` («вилка „от–до“ обязательна»), `integration/employer/invite-contact.test.ts` («вилка: оба конца обязательны») | форма потребности и приглашения | В вакансии в схеме допускается 0; обязательность проверена для приглашения |
| R-D-02 Состав приглашения | готово | `server/employer/invitations.ts` (описание, вилка, компания, способ связи компании), `Company.contact` | `integration/employer/invite-contact.test.ts` («кандидат видит компанию, описание, вилку и способ связи до принятия»; «способ связи компании») | `/invitations` у кандидата | — |
| R-D-03 Статусы, видны обеим сторонам | готово | `InvitationStatus` (`sent → viewed → accepted/declined`), `components/employer/InvitationTracker.tsx`, `CandidateInvitations.tsx` | `integration/employer/employer-api.test.ts` | `/employer/invitations`, `/invitations` | — |
| R-D-04 Регистрация по email с подтверждением | готово | `server/auth/email.ts`, `codes.ts` (код 6 цифр, 15 минут, 5 попыток), `app/api/auth/register/route.ts`, `verify/route.ts` | `integration/auth/email-auth.test.ts`, `unit/auth/email-auth-primitives.test.ts` | окно входа на главной | Письмо доходит до реального ящика только при подключённом SMTP; без него — Mailpit стенда ([deploy.md](deploy.md)). Вход за жюри — `/demo` |
| R-D-05 Верификация компаний и модерация | не требуется | — | — | — | В MVP не нужны (ТЗ). Концепция — R-X-01 |

### ФСП

| ID | Статус | Где в коде | Чем подтверждено | Как увидеть на стенде | Оговорка |
|---|---|---|---|---|---|
| R-FSP-01 Связь с ФСП ID | частично | `Candidate.fspState` (4 состояния), привязка ФСП ID по OIDC — `server/fsp-id/`, вход — Яндекс ID (`server/auth/yandex.ts`, ADR 0001) | `unit/fsp-id/*.test.ts`, `unit/auth/yandex.test.ts`, `integration/auth/yandex-callback.test.ts` | `/settings` → «Привязать ФСП ID» | Вход на платформу через ФСП ID (окно входа, роль «Ищу работу»; новый аккаунт — кандидат с привязкой) и привязка к профилю (знакомство, настройки) по OIDC работают со встроенным моком ФСП ID (Keycloak ФСП организаторы не дают). Клиент готов к симулятору команды на Keycloak и его API реестра (`FSP_OIDC_*`, `FSP_API_URL`); на стенде не включён — нет секрета клиента. Яндекс ID на стенде 10.10 не включён (ключи не заданы) |
| R-FSP-02 Состав данных о достижениях | готово | `server/collector/fsp-demo.ts` (событие, год, результат, роль), `server/employer/privacy.ts` (источник `fsp`) | `unit/collector/profiles.test.ts` | `/profile` у демо-кандидата с ФСП | Модель — наше предложение; все строки помечены «демонстрационные» |
| R-FSP-03 Кандидат без истории ФСП | готово | `FspState.not_linked/no_achievements`, `ranking.ts` (нет ФСП — нет штрафа), шаг `fspParticipation` | `unit/employer/ranking.test.ts` («отсутствие ФСП не штрафуется»), `unit/components/profile-page.test.tsx` | `/demo` → «frontend Junior без ФСП» либо новый пользователь с ответом «нет истории» | — |
| R-FSP-04 Схема интеграции с реестром ФСП | готово (документ) | — | [fsp-integration.md](fsp-integration.md), [submission/fsp-career.md](submission/fsp-career.md) (раздел про ФСП) | — | Схема реализована в коде на моке: OIDC-клиент + адаптер реестра (`server/fsp-id/registry.ts`, `GET /me/achievements` по токену участника) |

### За рамками MVP

| ID | Статус | Где | Чем подтверждено | Оговорка |
|---|---|---|---|---|
| R-X-01 Антифрод вакансий и работодателей | частично (концепция); **в работе (лейн extras)** | [submission/fsp-career.md](submission/fsp-career.md), приложение Б.1; в коде есть только лимит приглашений (`DAILY_INVITATION_LIMIT`, `weights.ts`) | `integration/employer/employer-api.test.ts` («лимит приглашений — 429») | Реализация сигналов антифрода — в лейне extras, в `main` её нет |
| R-X-02 Интеграция с ATS | частично (концепция); **в работе (лейн extras)** | [submission/fsp-career.md](submission/fsp-career.md), приложение Б.2 | — | ATS-вебхук — в лейне extras, в `main` кода нет |
| R-X-03 Адаптивная вёрстка | частично, не проверено | 33 CSS-модуля с `@media`; токены `styles/tokens.css` | `unit/design-tokens.test.ts` (токены); `playwright.config.ts` — только Desktop Chrome | Прогона на телефоне и планшете в тестах нет; макет мобильной версии есть среди [скриншотов](screenshots/) |

### Нефункциональные

| ID | Статус | Где | Чем подтверждено | Оговорка |
|---|---|---|---|---|
| R-N-01 Обычная машина / недорогой VPS | не проверено | `platform/docker-compose.prod.yml` (db, app, mailpit, caddy), [deploy.md](deploy.md) | Стенд работает на одном сервере | Потребление памяти не замерялось |
| R-N-02 ML/NLP | частично | Извлечение утверждений языковой моделью (`server/claims/extractor.ts`, `server/llm/`), адаптивный тест (IRT), словарный режим без модели | `unit/claims/extractor.test.ts`, `unit/llm/`, [validation-results.md](validation-results.md) | Семантического поиска нет. **в работе (лейн match-eval)**: BM25 в подборе. Языковая модель на стенде 10.10 не включена (stub) |
| R-N-03 Открытый код, лицензии | частично | `LICENSE` (MIT), `package.json` | — | Зависимости в основном разрешительные; полный аудит лицензий — не проверено |
| R-N-04 Разделение Frontend / Backend / хранилище | готово | `app/` + `components/` (интерфейс), `server/` (логика), `prisma/` + Postgres; отдельный сервис `platform/runner` | [modules.md](modules.md), [platform.md](platform.md) | Модульный монолит; допустимо по ТЗ |
| R-N-05 Docker и воспроизводимый запуск | готово | `platform/Dockerfile`, `docker-compose.yml` (db, migrate, app, runner, mailpit), `docker-compose.prod.yml` | Развёртывание на стенде ([deploy.md](deploy.md)); БД с нуля через `prisma migrate deploy` и сид — [validation-results.md](validation-results.md) | Стенд требует Docker ≥ 28 |
| R-N-06 OpenAPI | готово | `docs/openapi.yaml` (89 путей, 109 операций), `server/openapi/spec.generated.ts`, `/api-docs`, `GET /api/openapi` | `unit/openapi/openapi.test.ts` (каждый `route.ts` описан, у операции есть успех и ошибка, тела — из Zod, файл совпадает с генератором) | `/api-docs` |
| R-N-07 152-ФЗ, роли, защита, пароли | частично | Роли: `server/auth/access.ts`; пароли: scrypt (`server/auth/password.ts`); CSRF: проверка Origin (`server/auth/csrf.ts`); лимиты входа: `server/auth/rate-limit.ts`; сессии отзываются при смене пароля; удаление аккаунта | `unit/auth/access-coverage.test.ts`, `integration/auth/email-auth.test.ts` (чужой Origin → 403, лимит → 429, смена пароля отзывает сессии), `integration/auth/account-erasure.test.ts` | Размещение данных в РФ и юридическое соответствие 152-ФЗ — не проверено. **в работе (лейн extras)**: автотест приватности |
| R-N-08 Desktop-браузеры, независимость от ОС | не проверено | — | Сквозные тесты Playwright — только Chromium | Firefox и Safari не проверялись |
| R-N-09 Десятки пользователей, приемлемое время | не проверено | — | Нагрузочного прогона подбора, профиля и поиска нет; ход консультанта на DeepSeek: p95 18,9 с, под нагрузкой 10 диалогов — 25,7 с ([validation-results.md](validation-results.md)) | Цель p95 ≤ 15 с не достигнута |
| R-N-10 Комментарии, код соответствует документации | частично | Короткие JSDoc в модулях; [modules.md](modules.md) | `unit/openapi/openapi.test.ts` и `unit/agent/prompts.test.ts` сверяют документы с кодом | Полное соответствие остальных документов коду не проверялось; часть документов устарела (например, [demo-script.md](demo-script.md) описывает прежний сценарий) |
| R-N-11 Цвета ФСП | готово | `styles/tokens.css` (светлые токены «ФСП Карьера»), [design-system.md](design-system.md) | `unit/design-tokens.test.ts` | Соответствие брендбуку проверено глазами по [design-spec.md](design-spec.md), автоматически — только использование токенов |

### Итог по статусам (54 требования без R-D-05)

| Статус | Сколько | ID |
|---|---:|---|
| готово | 29 | R-C-04…06, 08, 09, 11, 14, 16; R-E-01…05, 07; R-M-01, 03; R-T-01, 05; R-D-01…04; R-FSP-02…04; R-N-04…06, 11 |
| частично | 21 | R-C-01…03, 07, 12, 13, 15; R-E-06; R-M-02, 04; R-T-02…04; R-FSP-01; R-X-01…03; R-N-02, 03, 07, 10 |
| нет | 1 | R-C-10 |
| не проверено | 3 | R-N-01, 08, 09 |

Строки с пометкой «в работе»: R-E-07, R-M-02, R-M-03, R-M-04, R-X-01, R-X-02, R-N-02, R-N-07. После слияния лейнов их статусы пересмотреть.

## 2. Критерии оценки: что показываем и граница доказательств

Источник критериев — `fsp/docs/context/scoring.md`. Цифры — [validation-results.md](validation-results.md) и [validation-stages.md](validation-stages.md), даты 9–10 октября 2026. **Общая граница:** все метрики получены на синтетике — персонах с заданной моделью знаний, вымышленных профилях и разметке агента. Ни одной цифры по живым кандидатам и независимым экспертам нет, и называть их «точностью на людях» нельзя.

### 1. Новая механика подбора — 35 %

| Что показываем | Страница / сценарий | Цифра |
|---|---|---|
| Обратная механика: работодатель описывает потребность, получает подборку по категориям из теста, каждая позиция с обоснованием («закрывает N из M», доказано, нехватка, ФСП, категория) | `/employer/needs/new` → `/employer/needs/[id]`; поиск по банку `/employer/search`; помощник `/employer/assistant` | P@5 **0,675** при потолке 0,750; nDCG@5 **0,969** (17 профилей × 8 вакансий, `eval/matching/run.ts`, правило Q-36). Baseline «больше утверждений — выше»: nDCG@5 0,58, P@5 0,35 (замер на прежней разметке и 16 профилях) |
| Выход на контакт: приглашение с вилкой, статусы, контакты открываются после принятия | приглашение → `/invitations` → «Принять» → у работодателя имя и контакт | Автотесты приватности: `unit/employer/ranking.test.ts`, `integration/employer/invite-contact.test.ts` |

Граница доказательств:
- Разметка релевантности выполнена одним агентом, второго оценщика нет; критерий разметки близок к формуле подбора («закрыта половина требований и половина закрытого доказана»), поэтому цифры проверяют согласованность формулы с правилом, а не независимую релевантность.
- Веса подбора подгонялись на том же наборе; независимого тестового набора нет. Строка «До» и строка «После» в таблице [validation-results.md](validation-results.md) несопоставимы (разметка расширена); сопоставимы строки с одной разметкой: P@5 0,500 → 0,675, nDCG@5 0,890 → 0,969.
- Категории демо-профилей поставлены сидом, не получены тестом.
- Тестовый набор жюри «вакансия–кандидат» нам неизвестен. **в работе (лейн match-eval)**: расширенный набор и BM25; **(лейн ranking)**: вес ФСП, близость технологий, подсказки ослабления. Цифры выше после слияния этих лейнов перемерить.

### 2. Тестирование, валидация, категоризация — 25 %

| Что показываем | Страница / сценарий | Цифра |
|---|---|---|
| Тест на заявленный грейд: адаптивный (IRT), параметрические задания (каждый экземпляр от seed попытки), ключ считает код, не модель; при неуверенном Junior — дозадавание | `/test` | Персоны на подкатегорию, политика `adr-0002-v4`, N = 1000, seed 1 (после калибровки backend): новичок → Junior **0,00**; пограничный новичок → Junior **≤ 0,09**; Junior подтверждается **0,99–1,00**; Middle **0,99–1,00**; ложный Senior у Middle **0,00**; идеальный Junior **1,00**. Не достигнуто: backend.highload, Junior → ложный Middle **0,13** при цели ≤ 0,10 |
| Аргумент против утечки | раздел о тесте в [submission/fsp-career.md](submission/fsp-career.md) | Доля попыток на шаблон 0,49–0,94; точечно-бисериальная корреляция 0,30–0,46 (backend, N = 2000, синтетика) |
| Стабильность при повторе | `integration/test/grade-test.test.ts` («повторяемость») | Тот же seed и те же ответы → те же задания и тот же грейд (детерминизм движка). Test-retest на людях не измерялся |
| Ступени 1 (созвон) и 3 (защита) — сверх ТЗ | `/consultant` → «Созвониться»; `/defense-room` | Созвон: 44 из 45 тем при покрытии 100 %. Защита: «сделал сам» отделяется от остальных, «ИИ целиком» и «понимает частично» различаются слабо (AUC 0,61–0,89) |
| Страницы `/validation` и `/evaluate` | **в работе (лейн validation)** | В `main` отсутствуют |

Граница доказательств:
- Кандидаты — персоны: восемь-десять вымышленных профилей знаний («решит / монета / не решит» по шаблону), прогнанных через боевой движок без людей. Для ступеней 1 и 3 персон играет та же языковая модель, что оценивает, — это может завышать согласие.
- Параметры заданий `a`, `b` экспертные, подгонялись под те же персоны; на людях не оценены.
- Дискриминативность «сильные против слабых» — между персонами, не между реальными кандидатами. Согласия с экспертом нет вовсе.
- Результат зависит от популяции: θ-синтетика, подобранная по персонам, даёт ложное подтверждение Middle до 32 % (цель 10 %). Какая популяция ближе к людям, неизвестно ([test-calibration.md](test-calibration.md)).
- Пороги и интервалы (30 и 14 дней, 0,25 / 0,15 для рекомендации) — предложения, не калибровка.
- **Граница доказательств: защита от нейросети.** Тест не защищён от модели в соседнем окне, эффективность против моделей не измерялась. Организаторы: обязательна устойчивость к распространению заданий, защита от подсказок и прокторинг необязательны ([V04](meetings/2026-10-06/questions-and-answers.md#v04-обязательна-ли-защита-от-списывания-и-подсказок-в-mvp)). Закрываем R-T-01 (слив ответов); умение подтверждают созвон, проект и защита.

### 3. UI/UX — 10 %

| Что показываем | Страница | Цифра |
|---|---|---|
| Два кабинета: кандидат (`/profile`, `/test`, `/invitations`, `/career`, `/settings`) и работодатель (`/employer/*`); палитра ФСП; тёмная и светлая тема | `/demo` → вход за роль → сквозной путь без пояснений | Playwright, 14 из 14 сценариев (повторный прогон 10.10, [validation-results.md](validation-results.md)); компонентные тесты `unit/components/` |

Граница: юзабилити-тестирования с людьми не было; «путь без пояснений» проверен прогонами Playwright и глазами команды. Мобильные и планшетные экраны не тестировались (R-X-03).

### 4. Техническая проработка — 7 %

| Что показываем | Где | Цифра |
|---|---|---|
| Слои `app/` – `server/` – Prisma/Postgres, OpenAPI, docker-compose, границы доверия, защита от инъекций и SSRF | `/api-docs`, [modules.md](modules.md), [platform.md](platform.md) | Vitest 1239 из 1239 (112 файлов), интеграция с PostgreSQL 260 из 260 (29 файлов), `tsc`, ESLint и `next build` без ошибок — прогон 10.10 в [validation-results.md](validation-results.md); 0 выполненных инъекций из 10 атак (только словарный режим); 33 из 33 SSRF-адресов отбиты |

Граница: цифры тестов — на интеграционной сборке 10.10, до слияния сегодняшних лейнов; перед сдачей их нужно перемерить. Нагрузка не замерялась (R-N-09). «0 из 10 инъекций» словарный режим получает по построению; стойкость модели к инъекциям этим не доказана.

### 5. Полнота и документация — 6 %

| Что показываем | Где |
|---|---|
| Трассировка требований | этот документ |
| Документ сдачи по разделам ТЗ 3.4 | [submission/fsp-career.md](submission/fsp-career.md) |
| Путь соискателя целиком, кандидат без ФСП | [submission/fsp-career.md](submission/fsp-career.md), приложение А; демо-кандидат «frontend Junior без ФСП» |
| Что не реализовано и что имитировано | [submission/fsp-career.md](submission/fsp-career.md), приложение В |

Граница: из обязательных (MVP) требований целиком не закрыты R-C-01…03, 07, 13, 15 (см. таблицы); документ сдачи нужно сдать в DOC или PDF — текущие Markdown-файлы рабочие ([delivery.md](delivery.md)). Часть документов отстаёт от кода ([demo-script.md](demo-script.md)).

### 6. Дополнительный функционал — 7 %

| Что показываем | Статус |
|---|---|
| Самоотклик и вакансии | вакансии работодателя и подборка вакансий кандидату (`/career`) — есть; самоотклика нет |
| Регулярные задания от работодателя | нет; аналог — проектное задание (`/projects`, `/employer/needs/[id]`) |
| Концепции антифрода и ATS | текст в [submission/fsp-career.md](submission/fsp-career.md), приложение Б; реализация — **в работе (лейн extras)** |
| Мобильная версия | не проверено (R-X-03) |
| Сверх списка | созвон с ИИ-интервьюером, проектное задание с автопроверкой, защита проекта, помощник работодателя, избранное и уведомления |

Граница: из дешёвых баллов («хотя бы самоотклик и концепции R-X-01/02») самоотклика в `main` нет; закрыты только концепции.

### 7. Питч — 10 %

| Что показываем | Где |
|---|---|
| Сквозное демо 3–5 минут, запасное видео | [demo-script.md](demo-script.md) (прежний сценарий, требует обновления под три ступени), [delivery.md](delivery.md) |
| Слайды 7–11 шаблона обязательны | [delivery.md](delivery.md) |

Граница: питч строится на тех же цифрах, что критерии 1–2, и должен называть их симуляцией; ответ на вопрос «проверено на людях?» — «нет, это следующий шаг» ([validation-results.md](validation-results.md), раздел «Чего нет и что нужно для честной цифры»).

## 3. Что говорить жюри, если спросят про доказательства

| Вопрос | Честный ответ | Основание |
|---|---|---|
| Точность подбора на ваших данных? | P@5 0,675 (потолок 0,750), nDCG@5 0,969 на 17 синтетических профилях × 8 вакансий; разметка одного агента, веса подгонялись на этом же наборе | раздел 2, критерий 1 |
| Сколько ложных Middle/Senior пропускает тест? | На персонах — до 0,13 (backend.highload), в остальных подкатегориях ≤ 0,10; на людях не измерено | раздел 2, критерий 2 |
| Защищён ли тест от ChatGPT? | Нет, и мы это говорим. Текстовый тест нельзя защитить от нейросети в соседнем окне, и мы этого не обещаем: эту проблему не решает никто, а сигналы вкладок, вставки и person-fit ловят случайного, а не намеренного. Поэтому тест у нас - предварительная калибровка грейда, а единственные, кто проверяет умение вне теста, - мы: созвон с ИИ-интервьюером, проект на скрытых тестах и защита по собственному коду. Уникальные экземпляры и ротация заданий защищают от слива ответов, не от модели. | V04 организаторов; раздел 2, критерий 2 |
| Стабильность оценки при повторе? | Движок детерминирован по seed; повтор человеком не измерялся | раздел 2, критерий 2 |
| Работает ли вход через ФСП ID? | Привязка по настоящему OIDC-потоку работает, провайдер — встроенный мок ФСП ID с демо-участниками (Keycloak ФСП не выдан) | R-FSP-01 |
| Есть ли отклик на вакансию? | Нет | R-C-12, R-E-06 |
