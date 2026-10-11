# Шаблоны проектов (ступень 2, ADR 0003)

Шаблон — фиксированный контракт и скрытые автотесты к нему. Работодатель выбирает шаблон под потребность,
модель (`project_spec`) переписывает условие в его домен, но **проверка всегда идёт по контракту шаблона**:
скрытые тесты от вакансии не зависят, поэтому балл сравним между кандидатами. Код — `platform/src/server/project/`,
шаблоны — `platform/project-templates/`.

## Раскладка

```
project-templates/<subcategoryId>/<grade>/<templateId>/
  template.json      манифест (ниже)
  contract.md        контракт: имена модулей, функций, маршрутов, полей; первая строка — маркер PLATFORM-OWNED
  starter/           заготовка, которую кандидат скачивает (skeleton.zip): пустые реализации + tests/visible/
  visible/           видимые тесты (копия starter/tests/visible/ — должна совпадать байт в байт)
  hidden/            скрытые тесты — кандидату не выдаются никогда
  reference/         эталонное решение; накладывается поверх starter при проверке шаблона
```

`subcategoryId` — подкатегория из карты направлений (`backend.web-api`, `frontend.ui-app`, …), `grade` — `junior | middle | senior`.

## Манифест `template.json`

| Поле | Что это |
|---|---|
| `id` | Уникальный id, совпадает с именем каталога: `<спец>-<подкат>-<грейд>-<тема>` |
| `subcategoryId`, `specialization`, `grade` | Куда шаблон относится; `specialization` — строка (`backend`, `frontend`, `ai`, `engineering`) |
| `title`, `summary` | Заголовок и одна строка о сути (видит работодатель; заголовок идёт в ленту кандидата) |
| `stack` | Теги стека для карточки |
| `catalogIds` | Навыки каталога (`claims`), которые проверяет шаблон; из них работодатель выбирает обязательные критерии. Только реальные id каталога — проверяет unit-тест |
| `image` | Образ runner: `node20` или `python312` |
| `testEnvironment` | `node` или `jsdom` (для UI-шаблонов) |
| `contractRef`, `starterRef`, `visibleTestsRef`, `hiddenTestsRef`, `referenceRef` | Относительные пути внутри каталога шаблона |
| `timeLimitSec` | Лимит прогона тестов в runner |
| `timeBudgetMin` | Ориентир по времени для кандидата (попадает в условие) |
| `platformOwned` | Glob-пути, которые кандидат не может менять: минимум `contract.md`, `tests/visible/**`, `.platform-tests/**`, плюс файлы инфраструктуры шаблона (например, `src/db.ts`) |

## PLATFORM-OWNED

Каждый файл из `platformOwned`, который лежит в `starter/`, начинается с комментария `PLATFORM-OWNED`.
При сдаче платформа сверяет хеши этих файлов в репозитории кандидата с заготовкой (перевод строк нормализуется)
и пишет в отчёт работодателю `modified` или `missing`. runner в любом случае удаляет эти пути из копии кандидата
и кладёт свои тесты в `.platform-tests/` (скрытые) и `.platform-tests/visible/` (видимые).

## Требования к тестам

- **Эталон зелёный:** `starter` + `reference` проходит весь скрытый и весь видимый набор.
- **Заготовка красная:** чистый `starter` не проходит ни одного скрытого теста. Тесты должны падать проверками,
  а не ошибкой сбора (иначе runner вернёт 0/0): тяжёлую подготовку — в `beforeAll`.
- Скрытых тестов больше, чем видимых; видимые — подмножество по смыслу, не по тексту.
- Тесты проверяют только то, что записано в `contract.md`. Детали, которых нет в контракте, не проверять.
- Без сети наружу: моки поднимать на `127.0.0.1` внутри теста.
- Зависимости — только предустановленные в песочнице runner (express, supertest, react, testing-library, jsdom,
  vitest; для Python — pytest, fastapi, httpx, numpy, pandas). Новая зависимость — правка образа runner.
- **Скрытые тесты опубликованного шаблона не меняются.** Иначе баллы уже сданных работ несравнимы.
  Исправление — новый шаблон с новым id, старый оставить.

## Senior

Senior-шаблон (ADR 0003, «Дополнение 16:15») проверяет проектные решения и компромиссы, а не объём кода:
бюджет 6–8 ч (`timeBudgetMin` 360–480), контракт требует в корне репозитория `DESIGN.md` с разделами
`## Решения`, `## Компромиссы`, `## Границы применимости` (каждый ≥ 200 символов). Скрытый тест проверяет
только наличие и объём разделов; содержание разбирается на защите проекта. Эталон кладёт свой `DESIGN.md`
в `reference/`.

## Условие задания

Модель (`project_spec`) пишет только легенду в домене работодателя и требования поверх контракта
(критерии и пожелания работодателя). Контракт она не пересказывает: `contract.md` прикладывается к условию
дословно (`specJson.contractMd`), а требования, которые повторяют имена, коды ошибок, HTTP-статусы или
маршруты из контракта, отбрасываются кодом (`dropContractEcho`). Заголовок, «как проверяется» и заметки
собирает код. Поэтому правка `contract.md` опубликованного шаблона меняет условие только новых заданий.

## Как добавить шаблон

1. Скопировать ближайший шаблон того же образа в `project-templates/<subcategoryId>/<grade>/<новый id>/`.
2. Написать `contract.md`, заготовку, эталон, видимые тесты (и копию в `starter/tests/visible/`), скрытые тесты.
3. Заполнить `template.json`; `catalogIds` взять из каталога навыков.
4. Проверить эталон и заготовку так же, как это делает runner (из `platform/`):

   ```bash
   npx tsx scripts/project-templates-check.ts --only <id>                   # скрытые
   npx tsx scripts/project-templates-check.ts --only <id> --suite visible   # видимые
   ```

   Ожидаемый вывод: эталон N/N, заготовка 0/N. Нужен набор зависимостей песочницы:
   `TEMPLATE_NODE_DEPS` (по умолчанию `runner/sandbox/node/node_modules`) и `TEMPLATE_PYTHON`
   (по умолчанию `runner/sandbox/python/.venv/bin/python`).
5. `npx vitest run tests/unit/project` — проверяет манифесты, маркеры, совпадение видимых тестов и id каталога.
6. Шаблоны синхронизируются в таблицу `ProjectTemplate` при первом обращении к заданиям (`syncTemplates`); миграция не нужна.

## Выкладка

- Все шаблоны лежат во вложенной раскладке. runner ищет шаблон по id в ней и в плоской `<id>/` (`runner/src/templates.ts`,
  `resolveTemplateDir`), загрузчик приложения читает только вложенную; id уникален во всём дереве. Два учебных Junior-шаблона
  runner (`be-webapi-junior-notes`, `fe-uiapp-junior-widget`; эталоны — `tests/fixtures/runner/`, а не `reference/`) перенесены
  туда 10.10 из плоской раскладки; они вторые Junior в своих подкатегориях и при автовыборе уступают `…-booking` и `…-catalog`
  (порядок по id).

## Покрытие шаблонов

56 шаблонов, покрыты все 54 категории (18 подкатегорий × Junior / Middle / Senior). Второй Junior есть у `backend.web-api` и `frontend.ui-app` (учебные шаблоны runner, без `reference/`: их не проверяет `project-templates-check`). Приёмка каждого шаблона с `reference/`: эталон N/N, чистая заготовка 0/N на скрытых и видимых тестах.

| Подкатегория | Junior | Middle | Senior |
| --- | --- | --- | --- |
| `ai.ai-integration` | `ai-aiint-junior-classifier` | `ai-aiint-middle-toolloop` | `ai-aiint-senior-pii-guard` |
| `ai.bi-analytics` | `ai-bi-junior-salesmart` | `ai-bi-middle-retention` | `ai-bi-senior-metriclayer` |
| `ai.data-science` | `ai-datasci-junior-eda` | `ai-datasci-middle-abtest` | `ai-datasci-senior-cohorts` |
| `ai.llm-apps` | `ai-llmapps-junior-triage` | `ai-llmapps-middle-rag` | `ai-llmapps-senior-gateway` |
| `ai.ml-engineering` | `ai-mleng-junior-metrics` | `ai-mleng-middle-leakfree` | `ai-mleng-senior-serving` |
| `ai.mlops` | `ai-mlops-junior-registry` | `ai-mlops-middle-drift` | `ai-mlops-senior-rollout` |
| `backend.data-model` | `be-datamodel-junior-orders` | `be-datamodel-middle-migrations` | `be-datamodel-senior-audit` |
| `backend.highload` | `be-highload-junior-cache` | `be-highload-middle-coalesce` | `be-highload-senior-jobqueue` |
| `backend.integrations` | `be-integrations-junior-webhook` | `be-integrations-middle-delivery` | `be-integrations-senior-outbox` |
| `backend.web-api` | `be-webapi-junior-booking`<br>`be-webapi-junior-notes` | `be-webapi-middle-orders` | `be-webapi-senior-ratelimit` |
| `engineering.data-eng` | `eng-dataeng-junior-etl` | `eng-dataeng-middle-quality` | `eng-dataeng-senior-incremental` |
| `engineering.devops` | `eng-devops-junior-deploycfg` | `eng-devops-middle-ci-runner` | `eng-devops-senior-rollout` |
| `engineering.qa-automation` | `eng-qaauto-junior-shipping` | `eng-qaauto-middle-orders-api` | `eng-qaauto-senior-cache-model` |
| `engineering.sre` | `eng-sre-junior-slo` | `eng-sre-middle-alerts` | `eng-sre-senior-resilience` |
| `frontend.design-system` | `fe-designsys-junior-primitives` | `fe-designsys-middle-combobox` | `fe-designsys-senior-dialog` |
| `frontend.realtime` | `fe-realtime-junior-feed` | `fe-realtime-middle-reconnect` | `fe-realtime-senior-board` |
| `frontend.ui-app` | `fe-uiapp-junior-catalog`<br>`fe-uiapp-junior-widget` | `fe-uiapp-middle-tasks` | `fe-uiapp-senior-search` |
| `frontend.web-perf` | `fe-webperf-junior-suggest` | `fe-webperf-middle-virtual` | `fe-webperf-senior-dashboard` |

Особый случай: `eng-qaauto-*` — кандидат пишет `verify(impl)`, скрытые тесты проверяют, что он пропускает эталон и ловит мутантов (мутационное тестирование). Senior-шаблоны требуют `DESIGN.md`. Шаблоны `ai-bi-junior-salesmart`, `ai-bi-middle-retention`, `ai-bi-senior-metriclayer`, `ai-datasci-junior-eda`, `ai-datasci-middle-abtest`, `ai-datasci-senior-cohorts`, `ai-mleng-junior-metrics`, `ai-mleng-middle-leakfree`, `ai-mlops-middle-drift`, `eng-dataeng-middle-quality` используют numpy/pandas из песочницы runner (numpy 2.3.3, pandas 2.3.3, BLAS в один поток, образ linux/amd64).

- `reference/` исключён из обоих образов (`platform/.dockerignore`), приложение получает шаблоны через
  `outputFileTracingIncludes` в `next.config.ts` (standalone-сборка сама файлы с диска не трассирует).
