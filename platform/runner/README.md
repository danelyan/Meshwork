# runner — автопроверка проектов кандидатов

Внутренний сервис ступени 2 ([ADR 0003](../../docs/decisions/0003-three-stage-assessment.md)): прогоняет
скрытые тесты шаблона проекта по репозиторию кандидата и отдаёт `tests: [{name, passed, ms}]`.
Балл, рубрику и отчёт работодателю считает lane project; runner только запускает тесты.

## API

Все маршруты, кроме `/health`, — с заголовком `Authorization: Bearer <RUNNER_TOKEN>`. Схемы — в
[`src/contract.ts`](src/contract.ts), клиент app — [`src/server/runner/client.ts`](../src/server/runner/client.ts)
(`submitRun`, `getRun`).

| Запрос | Ответ |
| --- | --- |
| `GET /health` | `{ok, mode: local\|container, configured, queued, running, jobs, uploads}` |
| `POST /uploads`, тело — `.tar.gz` (`application/gzip`), ≤ 50 МБ | `201 {uploadId, bytes, sha256}`; загрузка живёт 15 мин |
| `POST /run {repoTarballUrl: "upload:<uploadId>", commitSha, testsBundleRef, image: "node20"\|"python312", timeoutSec?}` | `202 {jobId}` |
| `GET /run/{jobId}` | `{status: queued\|running\|done\|failed, reason?, tests, summary, logTail, durationMs, exitCode, …}` |

- **Репозиторий скачивает app**, не runner: у runner нет интернета. `submitRun({source: {kind: 'github', repoUrl}, …})`
  берёт `https://api.github.com/repos/<o>/<r>/tarball/<sha>` (редирект на `codeload.github.com`), каждый хоп —
  через SSRF-фильтр сборщика (`collector/ssrf.ts`, пиннинг адреса из `collector/url.ts`), ≤ 50 МБ, 30 с, и
  передаёт архив в `POST /uploads`. Поле `repoUrl` в `POST /run` отклоняется с `422 repo_url_not_supported`.
  Приватный репозиторий без доступа `GITHUB_TOKEN` даёт 404.
- `testsBundleRef` — `<templateId>` (скрытые тесты) или `<templateId>:visible`. `image` должен совпадать с
  `image` шаблона.
- `timeoutSec` — 5…300, по умолчанию `timeLimitSec` шаблона.
- `done` — тесты отработали (часть может быть красной). `failed` + `reason`: `timeout`, `bad_archive`
  (симлинк, жёсткая ссылка, путь за пределы каталога, битый архив, лимиты), `commit_mismatch` (GitHub пишет SHA
  коммита в pax-заголовок архива — он не совпал с `commitSha`), `no_report` (тесты не дали отчёта: процесс упал
  до отчёта), `bundle_not_found`, `internal`.
- Набор тестов, который не загрузился (синтаксическая ошибка или нет модуля у кандидата), приходит одним
  красным тестом `<файл>: набор не загрузился`.
- Ошибки: `400 validation`, `401`, `404 job_not_found | upload_not_found | bundle_not_found`,
  `413 payload_too_large`, `422`, `429 queue_full` (очередь > 20), `503 runner_not_configured`.
- `logTail` (≤ 4000 знаков) и `tests[].error` пишет код кандидата и они раскрывают скрытые тесты:
  кандидату не показывать, в LLM подавать как данные, не инструкции.
- Очередь и результаты — в памяти, одно задание за раз. Рестарт runner их теряет: `GET /run/{id}` → 404,
  клиент решает сам (пометить сабмит `failed`, предложить повтор).

## Как идёт задание

1. Архив распаковывается своим разборщиком tar ([`src/tar.ts`](src/tar.ts)) в `repo/`: распаковка ≤ 150 МБ,
   ≤ 5000 файлов, файл ≤ 20 МБ; `node_modules/` и `.git/` пропускаются — зависимости кандидату не ставятся.
2. Пути из `platformOwned` шаблона и `.platform-tests/` в копии кандидата удаляются; набор тестов
   платформы копируется в `repo/.platform-tests/` (видимый — в `.platform-tests/visible/`, на той же
   глубине, что `tests/visible/` у кандидата). Запускается **только** он.
3. node20: `vitest run --root repo --config <наш vitest.job.config.mjs> --configLoader native` — конфиги
   кандидата (`vitest.config`, `vite.config`, `postcss.config`) не читаются, `package.json`-скрипты не
   выполняются; пакеты — предустановленный набор [`sandbox/node`](sandbox/node/package.json)
   (vitest, supertest, Testing Library, jsdom, react, express) через `node_modules` рядом с `repo/`.
   python312: `pytest -c <наш pytest.job.ini> --confcutdir .platform-tests -p no:cacheprovider`,
   автозагрузка плагинов выключена, `conftest.py` кандидата выше каталога тестов не грузится;
   пакеты — [`sandbox/python/requirements.txt`](sandbox/python/requirements.txt) (pytest, fastapi, httpx).
4. Отчёт (vitest JSON / JUnit XML) разбирается в `tests`, каталог задания удаляется.

## Изоляция и её границы

Осознанный компромисс хакатона: **граница доверия — контейнер runner + лимиты процесса**, без gVisor,
Firecracker и docker-in-docker.

Что есть (контейнер, `docker-compose.yml`):

- Сеть: runner подключён только к `runner-net` с `internal: true` — выхода в интернет нет, из соседей виден
  только app (её публичный API). База, Mailpit, Caddy в этой сети отсутствуют.
- Нет `docker.sock`, корневая ФС только на чтение, запись — только tmpfs `/work` (512 МБ, `noexec`).
- Контейнер: `cap_drop: ALL` + `SETUID, SETGID, KILL, CHOWN, DAC_OVERRIDE, FOWNER`, `no-new-privileges`,
  1,5 ГБ памяти, 0,8 CPU, 512 процессов. В окружении runner — только `RUNNER_TOKEN`, не весь `.env`.
- Задание: отдельный uid 2000 без capabilities (сервис — root внутри контейнера, иначе не сменить uid);
  пишет только в свои `tmp/` и `out/`, код и тесты платформы — только чтение; не видит окружение и
  токен сервиса (`/proc/1/environ` чужого uid закрыт); пустое окружение, кроме нашего фиксированного набора.
- Лимиты процесса (`ulimit` в обёртке `sh`): CPU-время = таймаут + 5 с, файл ≤ 64 МБ, 512 дескрипторов,
  256 процессов/потоков uid; node — куча V8 768 МБ (`--max-old-space-size`), python — `RLIMIT_AS` 768 МБ;
  `oom_score_adj=1000` — при нехватке памяти ядро убивает задание, а не сервис.
- Таймаут: SIGKILL всей группе процессов, затем — всем процессам uid 2000 (выход из группы через
  `setsid` не спасает). Одно задание за раз.

Что кандидат всё же может:

- Нагрузить CPU и память в пределах лимитов до таймаута (≤ 300 с) и тем задержать очередь.
- Обращаться по HTTP к app по внутренней сети (как любой пользователь из интернета) и к самому runner на
  localhost — без токена runner отвечает 401.
- **Подделать результат изнутри процесса тестов.** Код кандидата исполняется в том же процессе, что и
  vitest/pytest: он может подменить `expect`, завершить процесс, дописать отчёт. Поэтому балл runner —
  «воспроизводимый сигнал», а не доказательство: его страхуют статанализ, LLM-рубрика и защита проекта
  (ступень 3). Явную подделку обычно видно в `logTail` и коде.
- Прочитать скрытые тесты своего задания (они лежат рядом) и вывести их в журнал — отсюда запрет показывать
  `logTail` кандидату. Скрытые тесты других шаблонов заданию недоступны (`/opt/runner/templates` — 0700).
- Использовать уязвимость ядра для выхода из контейнера: общее ядро с хостом — это и есть граница
  компромисса.

Локальный режим (`RUNNER_LOCAL=1`, без Docker, для разработки и тестов):

- Задание — под текущим пользователем (без смены uid и без лимита процессов).
- На macOS сеть наружу (кроме localhost) и запись вне `tmp/`/`out/` режет `sandbox-exec`; проверено тестами.
- На Linux без Docker сеть и запись **не** режутся — только для разработки.

## Запуск

```bash
# локально (из platform/), один раз: пакеты для заданий
(cd runner/sandbox/node && npm ci --ignore-scripts)
RUNNER_LOCAL=1 RUNNER_TOKEN=$(openssl rand -hex 32) npx tsx runner/src/main.ts   # :8090
npm run test:runner        # интеграция в локальном режиме (~15 с)

# python312 локально (тест пропускается без venv)
python3 -m venv runner/sandbox/python/.venv && runner/sandbox/python/.venv/bin/pip install -r runner/sandbox/python/requirements.txt

# контейнер
docker compose up -d --build runner
```

Переменные: `RUNNER_TOKEN` (≥ 32 символов, тот же в app), `RUNNER_PORT` (8090), `RUNNER_LOCAL`,
`RUNNER_WORK_DIR`, `RUNNER_TEMPLATES_DIR`, `RUNNER_JOB_MEM_MB` (768), `RUNNER_MAX_QUEUE` (20) — полный список в
[`src/config.ts`](src/config.ts). В app: `RUNNER_URL` (в compose — `http://runner:8090`), `RUNNER_TOKEN`.

Шаблоны и их формат — [`../project-templates/README.md`](../project-templates/README.md).
