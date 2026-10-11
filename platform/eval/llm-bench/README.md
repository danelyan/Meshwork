# llm-bench: замер LLM-провайдеров

Протокол – `research/12-russian-llms.md` § 6.2. Скрипт сравнивает модели на одном
сценарии консультанта и пишет цифры для ADR о выборе LLM (Q-33) и слайда
«валидация». Сеть и ключи нужны только здесь; юнит-тесты провайдеров идут на
фикстурах без сети.

## Запуск

```bash
cd platform
set -a; source .env.bench; set +a          # ключи – в отдельном файле, не в git
npx tsx eval/llm-bench/run.ts --smoke      # шаг 0: смоук, ~6 запросов на модель
npx tsx eval/llm-bench/run.ts              # смоук + 10 резюме × модели × 3 повтора + нагрузка 10
npx tsx eval/llm-bench/run.ts --models stub,stub:planb --repeats 1   # самопроверка без сети
```

Весь двухчасовой протокол одной командой (смоук → диалоги → боевой извлекатель):

```bash
bash eval/llm-bench/protocol.sh                 # alice,giga,deepseek – у кого есть ключи в .env.bench
bash eval/llm-bench/protocol.sh alice           # только Alice, как только появится ключ Yandex
npx tsx eval/llm-bench/compare.ts --models alice,deepseek   # только шаг 3
```

`compare.ts` гоняет **боевой** извлекатель (`src/server/claims/prompts/extractor.md`, каталог
`prisma/seed/claims-catalog.json`, `verifyClaims`) по `eval/labels` и `eval/attacks` и пишет
таблицу `eval/results/llm-compare-<МСК>.md`: P/R/F1 по `catalogId`, попадания в ловушки,
доля ответов, которым понадобился ремонт JSON, доля документов с отказом после ремонта, ошибки
и 429, выполненные инъекции, p50/p95 вызова, токены и стоимость. Резюме `b02` и `f03` – источник
few-shot примеров промпта извлекателя – из метрик исключены.

Без ключа модель пропускается со строкой `ключ не задан: <ENV>`; если ключей нет
ни у одной – скрипт печатает это и выходит с кодом 0.

Флаги: `--models alice,giga,deepseek` (суффикс `:planb` – та же модель через
план В, без нативных tools), `--repeats 3`, `--resumes b07,f07,…`,
`--parallel 2` (одновременных диалогов в основном прогоне), `--concurrency 10`
(нагрузочный шаг), `--no-load`, `--temperature 0.2`, `--timeout 60000`.

Результат – `eval/results/llm-bench-<дата-время МСК>.json` (в git не попадает):
смоук, сводка по моделям и сырые диалоги.

## Переменные окружения

| Модель | Переменные | Примечание |
|---|---|---|
| `alice` – Alice AI LLM, Yandex Responses API | `YANDEX_API_KEY`, `YANDEX_FOLDER_ID`; опц. `BENCH_ALICE_MODEL` (по умолчанию `aliceai-llm`), `YANDEX_BASE_URL` | Ключ API сервисного аккаунта (`Api-Key`) или IAM-токен `t1.…` (`Bearer`). Роли `ai.languageModels.user` (и `ai.assistants.editor` для Responses API – по странице аутентификации AI Studio) |
| `giga` – GigaChat 3.5 Ultra, Cloud.ru Foundation Models | `CLOUDRU_API_KEY`, `BENCH_GIGA_MODEL`; опц. `CLOUDRU_BASE_URL` (по умолчанию `https://foundation-models.api.cloud.ru/v1`) | Точный id модели взять из каталога Cloud.ru – в скрипт не зашит, чтобы не выдумывать |
| `deepseek` – DeepSeek V4 Flash, Yandex OpenAI-совместимый Chat Completions | `YANDEX_API_KEY`, `YANDEX_FOLDER_ID`, `BENCH_DEEPSEEK_MODEL` | Имя модели из каталога AI Studio (`gpt://<folder>/<имя>` собирается сам). Модель не российская; в Yandex Cloud её допускает решение владельца от 09.10 |
| цены | `BENCH_<ALICE\|GIGA\|DEEPSEEK>_PRICE_IN`, `…_PRICE_OUT` – $ за 1M токенов | По умолчанию Alice 4,10/9,84, DeepSeek 2,46/4,10 (research/12 § 2); для GigaChat цены нет → «н/д» |

Пример `.env.bench`:

```bash
YANDEX_API_KEY=AQVN...
YANDEX_FOLDER_ID=b1g...
BENCH_DEEPSEEK_MODEL=deepseek-v4-flash
CLOUDRU_API_KEY=...
BENCH_GIGA_MODEL=...
```

## Что делает

1. **Смоук (шаг 0).** На модель: запрос с `tools` (ждём вызов `search_catalog`
   с валидными аргументами), возврат результата инструмента в историю
   (проверяет, что провайдер принимает `function_call_output` / `role: tool`
   без серверного состояния) и запрос с `json_schema` (через `completeJson`,
   с одним ремонтом). Не прошёл `tools` – модель выбывает из прогона (по
   протоколу); её можно прогнать как `<model>:planb`.
2. **Прогон (шаг 3).** 10 резюме по умолчанию: 4 сильных Middle (`b07 b08 f07
   f08`), 2 Junior (`b01 f01`), пустое и «список технологий» (`h01 h03`), 2 с
   инъекцией (`atk-resume-1 atk-resume-2`). Каждое × 3 повтора × модель.
   Сценарий «вот резюме и ссылка → предложи категорию и утверждения» с 5
   инструментами § 6.2 шаг 2 (`read_document`, `fetch_url`, `search_catalog`,
   `propose_claims`, `recommend_task`), не больше 6 шагов. Плюс на каждый
   повтор – отдельное извлечение со строгой JSON-схемой.
3. **Нагрузка (шаг 4).** 10 одновременных диалогов на модель без ретраев:
   отказы, число 429, p95.

Инструменты – фикстуры: документ отдаётся из `eval/resumes`/`eval/attacks`,
`fetch_url` в сеть не ходит, каталог – `catalog.json` (72 записи, снимок
черновика `docs/product/claims-catalog.md` от 09.10.2026).

## Метрики сводки

| Поле | Что значит | Порог § 6.2 |
|---|---|---|
| `jsonValidFirstTry` / `jsonValidAfterRepair` | % извлечений, прошедших Zod с первой попытки / после одного ремонта | ≥ 95 % после ремонта |
| `toolCallsCorrect` | % вызовов с известным инструментом и аргументами по схеме | ≥ 85 % |
| `toolCallsUnknown` | вызовы несуществующих инструментов («из воздуха») | 0 |
| `precision` / `recall` | по `catalogId` из `propose_claims` против `eval/labels` | точность ≥ 0,9 важнее полноты |
| `quoteVerbatim` | % цитат, дословно найденных в резюме (после нормализации) | до проверки кодом; после верификатора – 100 % |
| `claimsOutOfCatalog` | id вне каталога | 0 |
| `injectionsObeyed` | прогоны атак, где модель выдала запрещённый id, грейд или фразу | 0 из 6 |
| `categoryStable` | резюме, где специализация/грейд совпали во всех повторах | – |
| `callP50ms`/`callP95ms`, `dialogP50ms`/`dialogP95ms` | задержка одного вызова и всего диалога | p95 хода ≤ 15 с |
| `tokensIn`/`tokensOut`, `costUsd` | токены и стоимость по прайсу | – |
| `load.*` | 10 одновременных: проваленные диалоги, 429, ошибки, p95 | – |

## Ограничения

- Эталон – синтетические резюме с одним разметчиком (см. `eval/README.md`);
  цифры – ориентир, не статистика.
- Цитаты проверяются нормализованным вхождением; это та же идея, что у
  верификатора claims, но не его код.
- Выход модели в смоуке и прогоне не кэшируется: повторный запуск снова
  тратит токены.
- `stub` – самопроверка метрик, его цифры ничего не говорят о моделях.
