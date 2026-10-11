# Шаблоны проектов (ступень 2, ADR 0003)

Базовый шаблон – спец × грейд с фиксированным контрактом и скрытыми тестами. Работодатель выбирает
шаблон, ИИ пишет условие в домене работодателя поверх контракта (lane project), runner проверяет
решение скрытыми тестами ([runner/README.md](../runner/README.md)).

Каталог шаблонов приложения – [docs/project-templates.md](../../docs/project-templates.md). Ниже – все 56 шаблонов: покрыты все 54 категории
(18 подкатегорий × Junior / Middle / Senior). Два учебных Junior-шаблона runner (`be-webapi-junior-notes`, `fe-uiapp-junior-widget`) – Node 20, без
установки зависимостей кандидата, эталоны в `tests/fixtures/runner/`. Остальные 54 имеют `reference/`; приёмка: эталон N/N, чистая заготовка 0/N
(`npx tsx scripts/project-templates-check.ts`). Раскладка `<подкатегория>/<грейд>/<id>/`.

| id | Подкатегория × грейд | Что проверяется | Скрытых тестов (эталон) |
| --- | --- | --- | --- |
| `ai-aiint-junior-classifier` | ai.ai-integration × junior | Классификатор обращений через LLM | 15/15 |
| `ai-aiint-middle-toolloop` | ai.ai-integration × middle | Цикл вызова инструментов моделью | 18/18 |
| `ai-aiint-senior-pii-guard` | ai.ai-integration × senior | Охранный шлюз вызовов LLM: ПДн, бюджет, кэш, запасная модель | 25/25 |
| `ai-bi-junior-salesmart` | ai.bi-analytics × junior | Витрина метрик продаж: join без потери и размножения строк, месячные метрики, доли категорий | 39/39 |
| `ai-bi-middle-retention` | ai.bi-analytics × middle | Проверки качества журнала событий, недельный retention с цензурированием, строгая воронка | 34/34 |
| `ai-bi-senior-metriclayer` | ai.bi-analytics × senior | Слой метрик: определения, сверка срезов с итогом, план-факт с допуском | 49/49 |
| `ai-datasci-junior-eda` | ai.data-science × junior | Очистка таблицы и сводка: пропуски, дубли, выбросы | 22/22 |
| `ai-datasci-middle-abtest` | ai.data-science × middle | Анализ A/B-теста: SRM, конверсия, выручка, решение | 29/29 |
| `ai-datasci-senior-cohorts` | ai.data-science × senior | Когортное удержание, LTV и CUPED для A/B по выручке | 35/35 |
| `ai-llmapps-junior-triage` | ai.llm-apps × junior | Классификация обращений через LLM: промпт, разбор ответа, отказ | 19/19 |
| `ai-llmapps-middle-rag` | ai.llm-apps × middle | RAG по локальным документам с цитированием | 13/13 |
| `ai-llmapps-senior-gateway` | ai.llm-apps × senior | Шлюз извлечения данных через LLM | 17/17 |
| `ai-mleng-junior-metrics` | ai.ml-engineering × junior | Метрики классификации и стратифицированное разбиение | 16/16 |
| `ai-mleng-middle-leakfree` | ai.ml-engineering × middle | Конвейер признаков без утечки и логистическая регрессия | 17/17 |
| `ai-mleng-senior-serving` | ai.ml-engineering × senior | Пакетный инференс с версиями модели: совместимость схемы и откат | 17/17 |
| `ai-mlops-junior-registry` | ai.mlops × junior | Реестр моделей: версии, стадии, продвижение | 26/26 |
| `ai-mlops-middle-drift` | ai.mlops × middle | Мониторинг дрейфа: PSI и KS по окнам | 28/28 |
| `ai-mlops-senior-rollout` | ai.mlops × senior | Контроллер выкатки модели: теневой режим, канарейка, автооткат | 23/23 |
| `be-datamodel-junior-orders` | backend.data-model × junior | Схема и запросы: клиенты, товары, заказы (SQLite) | 37/37 |
| `be-datamodel-middle-migrations` | backend.data-model × middle | Миграции схемы: версии, откат шага, индексы | 34/34 |
| `be-datamodel-senior-audit` | backend.data-model × senior | Версионируемые записи: аудит, оптимистичная блокировка, состояние на дату | 36/36 |
| `be-highload-junior-cache` | backend.highload × junior | Кеш перед медленным источником | 16/16 |
| `be-highload-middle-coalesce` | backend.highload × middle | Объединение запросов к источнику: singleflight и батчинг | 18/18 |
| `be-highload-senior-jobqueue` | backend.highload × senior | Очередь фоновых задач с backpressure | 20/20 |
| `be-integrations-junior-webhook` | backend.integrations × junior | Приём вебхука платёжного провайдера: подпись и повторы | 15/15 |
| `be-integrations-middle-delivery` | backend.integrations × middle | Клиент внешнего API доставки: ретраи, таймауты, маппинг | 11/11 |
| `be-integrations-senior-outbox` | backend.integrations × senior | Outbox вебхуков: порядок, ретраи, предохранитель | 18/18 |
| `be-webapi-junior-booking` | backend.web-api × junior | REST API записи на приём | 15/15 |
| `be-webapi-junior-notes` | backend.web-api × junior | HTTP API заметок: три эндпоинта по контракту | 0/13 |
| `be-webapi-middle-orders` | backend.web-api × middle | API заказов: идемпотентность, курсорная пагинация, версии | 14/14 |
| `be-webapi-senior-ratelimit` | backend.web-api × senior | Лимитер запросов публичного API | 16/16 |
| `eng-dataeng-junior-etl` | engineering.data-eng × junior | ETL: CSV заказов → SQLite с валидацией | 10/10 |
| `eng-dataeng-middle-quality` | engineering.data-eng × middle | Проверки качества данных с карантином (pandas) | 31/31 |
| `eng-dataeng-senior-incremental` | engineering.data-eng × senior | Инкрементальная агрегация: повторы, опоздания, водяной знак | 12/12 |
| `eng-devops-junior-deploycfg` | engineering.devops × junior | Валидатор конфигурации деплоя: секреты, ресурсы, понятные ошибки | 21/21 |
| `eng-devops-middle-ci-runner` | engineering.devops × middle | Исполнитель CI-пайплайна: DAG шагов, параллелизм, кеш | 30/30 |
| `eng-devops-senior-rollout` | engineering.devops × senior | Оркестратор выкатки: батчи, проверка здоровья, автооткат, повтор | 24/24 |
| `eng-qaauto-junior-shipping` | engineering.qa-automation × junior | Тест-дизайн для расчёта стоимости доставки | 16/16 |
| `eng-qaauto-middle-orders-api` | engineering.qa-automation × middle | Проверка HTTP API по контракту: коды, валидация, идемпотентность | 16/16 |
| `eng-qaauto-senior-cache-model` | engineering.qa-automation × senior | Модельное тестирование кэша с TTL: проверка, которая ловит редкие дефекты | 18/18 |
| `eng-sre-junior-slo` | engineering.sre × junior | SLI/SLO и бюджет ошибок по журналу запросов | 21/21 |
| `eng-sre-middle-alerts` | engineering.sre × middle | Движок алертов по burn rate с молчаниями | 21/21 |
| `eng-sre-senior-resilience` | engineering.sre × senior | Клиент к нестабильной зависимости: breaker, ретраи с бюджетом, load shedding | 20/20 |
| `fe-designsys-junior-primitives` | frontend.design-system × junior | Базовые компоненты дизайн-системы: Button, Badge, TextField | 16/16 |
| `fe-designsys-middle-combobox` | frontend.design-system × middle | Доступный Combobox и токены темы | 19/19 |
| `fe-designsys-senior-dialog` | frontend.design-system × senior | Модальный Dialog: focus trap, возврат фокуса, вложенность | 19/19 |
| `fe-realtime-junior-feed` | frontend.realtime × junior | Лента сообщений в реальном времени | 17/17 |
| `fe-realtime-middle-reconnect` | frontend.realtime × middle | Realtime-клиент с переподключением и оптимистичной отправкой | 29/29 |
| `fe-realtime-senior-board` | frontend.realtime × senior | Совместная доска: сходимость реплик при любом порядке доставки | 22/22 |
| `fe-uiapp-junior-catalog` | frontend.ui-app × junior | Каталог товаров с фильтрами и корзиной (React) | 10/10 |
| `fe-uiapp-junior-widget` | frontend.ui-app × junior | React-виджет: список с фильтром | 1/9 |
| `fe-uiapp-middle-tasks` | frontend.ui-app × middle | Доска задач с серверным состоянием (React) | 8/8 |
| `fe-uiapp-senior-search` | frontend.ui-app × senior | Поиск с подсказками: гонки, кэш, доступность | 14/14 |
| `fe-webperf-junior-suggest` | frontend.web-perf × junior | Подсказки без лишних запросов: debounce, throttle, отмена | 18/18 |
| `fe-webperf-middle-virtual` | frontend.web-perf × middle | Виртуализация списка: только видимое окно в DOM | 15/15 |
| `fe-webperf-senior-dashboard` | frontend.web-perf × senior | Дашборд: бюджет рендеров, кэш и дедупликация запросов | 16/16 |

## Каталог шаблона

Раскладка `<подкатегория>/<грейд>/<id>/`, формат манифеста и проверка – [docs/project-templates.md](../../docs/project-templates.md).
runner ищет шаблон по id во вложенной и плоской `<id>/` (`resolveTemplateDir`).

```text
<id>/
  template.json   манифест (ниже)
  contract.md     контракт для кандидата: модуль, экспорт, поведение, окружение проверки
  starter/        заготовка репозитория кандидата (package.json, точка входа)
  visible/        видимые тесты – кандидат кладёт их в tests/visible/
  hidden/         скрытые тесты – только в образе runner, кандидату не выдаются
```

Эталонные решения – не здесь, а в `tests/fixtures/runner/` (в образ runner не попадают).

## template.json

| Поле | Значение |
| --- | --- |
| `id` | Совпадает с именем каталога; `testsBundleRef` в runner = `id` или `id:visible` |
| `specialization`, `grade` | Категория (grade: junior / middle / senior) |
| `title`, `stack` | Для работодателя и генерации условия |
| `image` | `node20` или `python312` – окружение runner |
| `testEnvironment` | Только node20: `node` или `jsdom` |
| `contractRef`, `starterRef` | Пути внутри каталога шаблона |
| `visibleTestsRef`, `hiddenTestsRef` | Каталоги с тестами |
| `timeLimitSec` | Таймаут прогона по умолчанию (5…300) |
| `platformOwned` | Пути в репозитории кандидата, которыми владеет платформа: при проверке копия кандидата удаляется. Формат – точный путь или `каталог/**` |

Схема манифеста – `templateManifestSchema` в [runner/src/templates.ts](../runner/src/templates.ts).

## Правила для тестов

- Первая строка каждого файла платформы – маркер `PLATFORM-OWNED` (идея WorkAI): видно, что файл не
  кандидата и его правки не учитываются.
- Скрытые тесты лежат в `.platform-tests/` внутри репозитория кандидата и импортируют его код
  относительным путём (`../src/app.js`); видимые – на глубине `tests/visible/` (`../../src/app.js`).
- Только пакеты из предустановленного набора runner (`runner/sandbox/node/package.json`,
  `runner/sandbox/python/requirements.txt`); новый пакет – правка набора и пересборка образа runner.
- Тест проверяет поведение по контракту, а не внутреннее устройство; каждый вызов фабрики (`createApp()`)
  независим, чтобы порядок тестов не влиял на результат.
- Новый шаблон: эталонное решение в `tests/fixtures/runner/<id>-solution/` и проверка в
  `tests/runner/service.test.ts`, что эталон проходит весь скрытый набор.
