# Шаблоны проектов (ступень 2, ADR 0003)

Базовый шаблон — спец × грейд с фиксированным контрактом и скрытыми тестами. Работодатель выбирает
шаблон, ИИ пишет условие в домене работодателя поверх контракта (lane project), runner проверяет
решение скрытыми тестами ([runner/README.md](../runner/README.md)).

Каталог шаблонов приложения — [docs/project-templates.md](../../docs/project-templates.md). Ниже — два учебных Junior-шаблона
лейна runner (Node 20, без установки зависимостей кандидата); лежат в общей раскладке `<подкатегория>/<грейд>/<id>/`.

| id | Спец × грейд | Что проверяется | Тестов (видимых / скрытых) |
| --- | --- | --- | --- |
| `be-webapi-junior-notes` | backend × junior | HTTP API заметок: `GET /health`, `POST /notes`, `GET /notes/:id`, валидация, 404 | 3 / 13 |
| `fe-uiapp-junior-widget` | frontend × junior | React-компонент «список с фильтром»: доступные роли, фильтр, счётчик, пустое состояние, кнопка сброса и фокус | 2 / 9 |

## Каталог шаблона

Раскладка `<подкатегория>/<грейд>/<id>/`, формат манифеста и проверка — [docs/project-templates.md](../../docs/project-templates.md).
runner ищет шаблон по id во вложенной и плоской `<id>/` (`resolveTemplateDir`).

```text
<id>/
  template.json   манифест (ниже)
  contract.md     контракт для кандидата: модуль, экспорт, поведение, окружение проверки
  starter/        заготовка репозитория кандидата (package.json, точка входа)
  visible/        видимые тесты — кандидат кладёт их в tests/visible/
  hidden/         скрытые тесты — только в образе runner, кандидату не выдаются
```

Эталонные решения — не здесь, а в `tests/fixtures/runner/` (в образ runner не попадают).

## template.json

| Поле | Значение |
| --- | --- |
| `id` | Совпадает с именем каталога; `testsBundleRef` в runner = `id` или `id:visible` |
| `specialization`, `grade` | Категория (grade: junior / middle / senior) |
| `title`, `stack` | Для работодателя и генерации условия |
| `image` | `node20` или `python312` — окружение runner |
| `testEnvironment` | Только node20: `node` или `jsdom` |
| `contractRef`, `starterRef` | Пути внутри каталога шаблона |
| `visibleTestsRef`, `hiddenTestsRef` | Каталоги с тестами |
| `timeLimitSec` | Таймаут прогона по умолчанию (5…300) |
| `platformOwned` | Пути в репозитории кандидата, которыми владеет платформа: при проверке копия кандидата удаляется. Формат — точный путь или `каталог/**` |

Схема манифеста — `templateManifestSchema` в [runner/src/templates.ts](../runner/src/templates.ts).

## Правила для тестов

- Первая строка каждого файла платформы — маркер `PLATFORM-OWNED` (идея WorkAI): видно, что файл не
  кандидата и его правки не учитываются.
- Скрытые тесты лежат в `.platform-tests/` внутри репозитория кандидата и импортируют его код
  относительным путём (`../src/app.js`); видимые — на глубине `tests/visible/` (`../../src/app.js`).
- Только пакеты из предустановленного набора runner (`runner/sandbox/node/package.json`,
  `runner/sandbox/python/requirements.txt`); новый пакет — правка набора и пересборка образа runner.
- Тест проверяет поведение по контракту, а не внутреннее устройство; каждый вызов фабрики (`createApp()`)
  независим, чтобы порядок тестов не влиял на результат.
- Новый шаблон: эталонное решение в `tests/fixtures/runner/<id>-solution/` и проверка в
  `tests/runner/service.test.ts`, что эталон проходит весь скрытый набор.
