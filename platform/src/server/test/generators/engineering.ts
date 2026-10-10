// Генераторы заданий направления engineering (ADR-0003, дополнение 10.10; ADR-0002 — формат теста).
// Подкатегории (research/25 § 3.4): data-eng, devops, qa-automation, sre — по 8 семейств
// (4 Junior + 4 Middle), тест — на подкатегорию (ADR-0003, дополнение 10.10 15:50; поле subcategoryId).
// Ключ ответа считает код генератора, не LLM (R-T-02); несущественные параметры (имена, числа,
// порядок, позиции строк) — от seed (R-T-01), сложность задаётся семейством. a, b — ПРЕДЛОЖЕНИЕ
// (экспертные, по образцу backend/frontend), калибруются персонами по подкатегориям
// (eval/test/personas.ts --spec engineering) и затем разметкой (docs/test-calibration.md).
//
// Поведение Kubernetes (откат, пробы, планирование по requests) и Docker (кэш слоёв) сверено с
// документацией (kubernetes.io, docs.docker.com) 10.10, как и rolling update (округление maxSurge/
// maxUnavailable), правила when/allow_failure GitLab CI и stacked parametrize в pytest. Без сверки,
// по знанию агента: приведение типов и partition pruning PostgreSQL, unittest.mock (call_count при
// исключении из side_effect) — помечено в docs/validation-results.md.
import { createRng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';

const NAMES = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дарья', 'Егор', 'Жанна', 'Захар', 'Инна', 'Кирилл', 'Лев', 'Мария'];
const SERVICES = ['billing', 'catalog', 'checkout', 'profile', 'search', 'delivery', 'notify', 'auth'];
const DATASETS = [
  { table: 'orders', ru: 'заказы', key: 'order_id' },
  { table: 'payments', ru: 'платежи', key: 'payment_id' },
  { table: 'shipments', ru: 'отгрузки', key: 'shipment_id' },
  { table: 'clicks', ru: 'клики', key: 'click_id' },
];

function table(name: string, cols: string[], rows: (string | number)[][]): string {
  const w = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells: (string | number)[]) => cells.map((c, i) => String(c).padEnd(w[i]!)).join(' | ');
  return [`${name}`, line(cols), w.map((x) => '-'.repeat(x)).join('-+-'), ...rows.map(line)].join('\n');
}

/** Минуты от полуночи → «ЧЧ:ММ». */
function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Номера (с 1) через запятую в каноническом виде list-ключа. */
function listKey(nums: number[]): string {
  return [...nums].sort((x, y) => x - y).join(',');
}

// ===========================================================================
// Junior
// ===========================================================================

// --- data-eng: дедупликация --------------------------------------------------

export const dedupCount: TaskGenerator = {
  id: 'eng.dedup-count',
  taskId: 'task:dedup-count',
  title: 'Дубли после повторной доставки',
  specialization: 'engineering',
  subcategoryId: 'engineering.data-eng',
  grade: 'junior',
  catalogIds: ['eng.data-quality'],
  format: 'number',
  a: 1.1,
  b: -0.9,
  paramSpace: 5e6,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ds = rng.pick(DATASETS);
    const nEvents = rng.int(4, 6);
    const base = rng.int(10, 89) * 100;
    // Каждое событие доставлено 1–3 раза; повтор — тот же event_id, позже loaded_at, иногда исправленная сумма.
    type Row = { id: number; user: string; amount: number; loaded: number };
    const rows: Row[] = [];
    let t = rng.int(8 * 60, 10 * 60);
    const users = rng.sample(NAMES, nEvents);
    const copies = Array.from({ length: nEvents }, () => 1);
    for (const i of rng.sample(Array.from({ length: nEvents }, (_, k) => k), rng.int(2, 3))) copies[i] = rng.int(2, 3);
    for (let i = 0; i < nEvents; i++) {
      let amount = rng.int(1, 9) * 100;
      for (let c = 0; c < copies[i]!; c++) {
        if (c > 0 && rng.int(0, 2) === 0) amount += rng.int(1, 3) * 50;
        rows.push({ id: base + i, user: users[i]!, amount, loaded: 0 });
      }
    }
    // Порядок загрузки: копии одного события идут по возрастанию времени, вперемешку с другими.
    const order = rng.shuffle(rows.map((_, k) => k));
    const seen = new Map<number, number>();
    const ordered: Row[] = [];
    for (const k of order) {
      const r = rows[k]!;
      // Берём очередную (по счёту) копию этого события, чтобы исправления шли позже исходной.
      const nth = seen.get(r.id) ?? 0;
      seen.set(r.id, nth + 1);
      const copy = rows.filter((x) => x.id === r.id)[nth]!;
      t += rng.int(1, 7);
      ordered.push({ ...copy, loaded: t });
    }
    const kind = rng.int(0, 2);
    const col = ds.key;
    let sql: string;
    let answer: number;
    let explanation: string;
    if (kind === 0) {
      sql = `SELECT COUNT(DISTINCT ${col}) FROM raw_${ds.table};`;
      answer = new Set(ordered.map((r) => r.id)).size;
      explanation = `COUNT(DISTINCT ${col}) считает разные идентификаторы: повторы одной доставки схлопываются.`;
    } else if (kind === 1) {
      sql = `SELECT COUNT(*) FROM (\n  SELECT DISTINCT * FROM raw_${ds.table}\n) t;`;
      answer = ordered.length;
      explanation = 'DISTINCT * сравнивает строки целиком, а loaded_at у повторов разный — ни одна строка не схлопнется.';
    } else {
      sql = [
        'SELECT SUM(amount) FROM (',
        `  SELECT amount, ROW_NUMBER() OVER (PARTITION BY ${col} ORDER BY loaded_at DESC) AS rn`,
        `  FROM raw_${ds.table}`,
        ') t WHERE rn = 1;',
      ].join('\n');
      const last = new Map<number, Row>();
      for (const r of ordered) last.set(r.id, r);
      answer = [...last.values()].reduce((s, r) => s + r.amount, 0);
      explanation = `ROW_NUMBER по ${col} с сортировкой loaded_at DESC оставляет последнюю доставку каждого события; суммируются суммы именно последних копий.`;
    }
    const code = [
      table(`raw_${ds.table}`, [col, 'user_name', 'amount', 'loaded_at'], ordered.map((r) => [r.id, r.user, r.amount, hhmm(r.loaded)])),
      '',
      sql,
    ].join('\n');
    return {
      prompt: `Источник «${ds.ru}» доставляет события «как минимум один раз»: при сбое то же событие (тот же ${col}) приходит повторно, иногда с исправленной суммой. Сырые строки лежат в таблице ниже. Что вернёт запрос?`,
      code,
      answerHint: 'число',
      answerKey: String(answer),
      explanation,
      params: { kind, nEvents, nRows: ordered.length, dataset: ds.table },
    };
  },
};

// --- data-eng: схема и типы --------------------------------------------------

export const schemaTypes: TaskGenerator = {
  id: 'eng.schema-types',
  taskId: 'task:schema-types',
  title: 'Какие строки не загрузятся',
  specialization: 'engineering',
  subcategoryId: 'engineering.data-eng',
  grade: 'junior',
  catalogIds: ['eng.data-types', 'eng.etl-pipeline'],
  format: 'list',
  a: 1.2,
  b: -0.5,
  paramSpace: 1e6,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ds = rng.pick(DATASETS);
    const n = rng.int(6, 7);
    type Cell = { id: string; day: string; qty: string; price: string };
    const valid = (): Cell => ({
      id: String(rng.int(100, 999)),
      day: `2026-0${rng.int(1, 9)}-${String(rng.int(1, 28)).padStart(2, '0')}`,
      qty: String(rng.int(1, 40)),
      price: `${rng.int(1, 999)}.${rng.pick(['00', '50', '90', '99'])}`,
    });
    const rows = Array.from({ length: n }, valid);
    // Дефекты, из-за которых строка не загрузится (один на строку), и «подозрительные, но валидные».
    const defects: { apply: (c: Cell) => void; why: string }[] = [
      { apply: (c) => (c.id = ''), why: 'пустой id → NULL в колонке NOT NULL' },
      { apply: (c) => (c.day = '2026-02-29'), why: '29 февраля 2026 не существует (год не високосный)' },
      { apply: (c) => (c.day = `2026-13-${String(rng.int(1, 28)).padStart(2, '0')}`), why: '13-го месяца нет' },
      { apply: (c) => (c.qty = `${rng.int(1, 9)}.5`), why: 'дробное значение не приводится к INTEGER' },
      { apply: (c) => (c.qty = `${rng.int(1, 40)}шт`), why: 'текст в INTEGER' },
      { apply: (c) => (c.price = `${rng.int(1, 9)} ${rng.int(100, 999)}.00`), why: 'пробел-разделитель тысяч — не NUMERIC' },
    ];
    const benign: { apply: (c: Cell) => void; why: string }[] = [
      { apply: (c) => (c.qty = ''), why: 'пустое qty → NULL, колонка допускает NULL' },
      { apply: (c) => (c.day = '2024-02-29'), why: '2024 — високосный, дата корректна' },
      { apply: (c) => (c.price = String(rng.int(1, 999))), why: 'целое число — корректный NUMERIC' },
    ];
    const idx = rng.shuffle(Array.from({ length: n }, (_, k) => k));
    const nBad = rng.int(2, 3);
    const bad = idx.slice(0, nBad);
    const ok = idx.slice(nBad, nBad + rng.int(1, 2));
    const notes: string[] = [];
    for (const k of bad) {
      const d = rng.pick(defects);
      d.apply(rows[k]!);
      notes.push(`строка ${k + 1}: ${d.why}`);
    }
    for (const k of ok) rng.pick(benign).apply(rows[k]!);
    const ddl = [
      `CREATE TABLE stage_${ds.table} (`,
      '  id     INTEGER NOT NULL,',
      '  day    DATE,',
      '  qty    INTEGER,',
      '  price  NUMERIC(10,2)',
      ');',
    ].join('\n');
    const csv = ['id,day,qty,price', ...rows.map((r) => `${r.id},${r.day},${r.qty},${r.price}`)].join('\n');
    return {
      prompt: `Загрузчик читает CSV и вставляет строки в stage_${ds.table} по одной (INSERT с приведением типов PostgreSQL). Пустое поле передаётся как NULL. Строка с ошибкой отклоняется, остальные загружаются. Номера каких строк данных (без заголовка, с 1) будут отклонены?`,
      code: `${ddl}\n\n${csv}`,
      answerHint: 'номера через запятую',
      answerKey: listKey(bad.map((k) => k + 1)),
      explanation: `Отклоняются: ${notes.sort().join('; ')}. Пустое qty, 29.02.2024 и целая цена — допустимые значения.`,
      params: { n, bad: listKey(bad.map((k) => k + 1)), dataset: ds.table },
    };
  },
};

// --- devops: кэш слоёв Dockerfile ---------------------------------------------

export const dockerCache: TaskGenerator = {
  id: 'eng.docker-cache',
  taskId: 'task:docker-cache',
  title: 'С какой строки пересоберётся образ',
  specialization: 'engineering',
  subcategoryId: 'engineering.devops',
  grade: 'junior',
  catalogIds: ['eng.dockerfile'],
  format: 'line',
  a: 1.2,
  b: -0.7,
  paramSpace: 3e2,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const lang = rng.pick([
      { from: 'node:20-alpine', manifest: 'package.json package-lock.json', manifestFile: 'package-lock.json', install: 'npm ci', build: 'npm run build', cmd: '["node", "dist/server.js"]', src: 'src/routes/orders.ts' },
      { from: 'python:3.12-slim', manifest: 'requirements.txt', manifestFile: 'requirements.txt', install: 'pip install --no-cache-dir -r requirements.txt', build: 'python -m compileall app', cmd: '["python", "-m", "app"]', src: 'app/handlers/orders.py' },
    ] as const);
    const goodOrder = rng.int(0, 1) === 1;
    const lines: string[] = [];
    lines.push(`FROM ${lang.from}`);
    if (rng.int(0, 1)) lines.push(`LABEL service="${rng.pick(SERVICES)}"`);
    lines.push('WORKDIR /app');
    if (rng.int(0, 1)) lines.push('ENV TZ=Europe/Moscow');
    let manifestLine = 0;
    if (goodOrder) {
      lines.push(`COPY ${lang.manifest} ./`);
      manifestLine = lines.length;
      lines.push(`RUN ${lang.install}`);
      lines.push('COPY . .');
    } else {
      lines.push('COPY . .');
      manifestLine = lines.length;
      lines.push(`RUN ${lang.install}`);
    }
    const copyAllLine = lines.indexOf('COPY . .') + 1;
    lines.push(`RUN ${lang.build}`);
    lines.push(`CMD ${lang.cmd}`);
    const changed = rng.pick(['src', 'manifest'] as const);
    const file = changed === 'src' ? lang.src : lang.manifestFile;
    // Первая инструкция, чьи входные файлы изменились; всё, что ниже, тоже не из кэша.
    const answer = changed === 'src' ? copyAllLine : manifestLine;
    return {
      prompt: `Образ уже собирался, кэш слоёв на месте. Разработчик изменил только файл ${file} и запустил docker build снова (.dockerignore исключает лишь node_modules и .git). Какая строка Dockerfile первой выполнится заново, не из кэша?`,
      code: lines.join('\n'),
      answerHint: 'номер строки',
      answerKey: String(answer),
      explanation: `Кэш COPY проверяется по содержимому копируемых файлов: ${file} впервые попадает в образ в строке ${answer}, её кэш инвалидируется, и все инструкции ниже выполняются заново.${goodOrder ? '' : ' Из-за COPY . . до установки зависимостей любое изменение кода переустанавливает зависимости.'}`,
      params: { lang: lang.from, goodOrder, changed, lines: lines.length },
    };
  },
};

// --- devops: секреты --------------------------------------------------------

export const secretsLeak: TaskGenerator = {
  id: 'eng.secrets-leak',
  taskId: 'task:secrets-leak',
  title: 'Где утекает секрет',
  specialization: 'engineering',
  subcategoryId: 'engineering.devops',
  grade: 'junior',
  catalogIds: ['eng.secrets', 'eng.ci-cd'],
  format: 'line',
  a: 1.1,
  b: -1.1,
  paramSpace: 5e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const svc = rng.pick(SERVICES);
    const pass = `${rng.pick(['Qw', 'Zx', 'Pa', 'Mn'])}${rng.int(1000, 9999)}${rng.pick(['!', '%', '_'])}${rng.pick(['kL', 'tR', 'vB'])}`;
    const carrier = rng.pick(['dockerfile', 'compose', 'ci'] as const);
    let safe: string[];
    let leaks: { line: string; why: string }[];
    let where: string;
    if (carrier === 'dockerfile') {
      where = 'Dockerfile (образ публикуется во внутренний реестр, доступный всем командам)';
      safe = [
        'FROM node:20-alpine',
        'WORKDIR /app',
        'COPY package.json package-lock.json ./',
        'RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN npm ci',
        'COPY . .',
        'ENV NODE_ENV=production',
        'ENV PORT=8080',
        'USER node',
        'CMD ["node", "dist/server.js"]',
      ];
      leaks = [
        { line: `ENV DATABASE_URL=postgres://${svc}:${pass}@db:5432/${svc}`, why: 'пароль БД записан в ENV и остаётся в метаданных образа — его видит любой, кто может скачать образ' },
        { line: 'COPY .env /app/.env', why: '.env с секретами копируется в слой образа' },
      ];
    } else if (carrier === 'compose') {
      where = 'docker-compose.yml (лежит в репозитории)';
      safe = [
        'services:',
        `  ${svc}:`,
        `    image: registry.local/${svc}:1.4.2`,
        '    env_file: .env.production',
        '    environment:',
        '      - LOG_LEVEL=info',
        '      - DB_PASSWORD=${DB_PASSWORD}',
        '    ports:',
        '      - "8080:8080"',
      ];
      leaks = [
        { line: `      - PAYMENT_API_KEY=sk_live_${rng.int(100000, 999999)}${rng.pick(['aX', 'qZ', 'mW'])}`, why: 'боевой ключ записан литералом в файл из репозитория' },
        { line: `      - JWT_SECRET=${pass}`, why: 'секрет подписи JWT записан литералом в файл из репозитория' },
      ];
    } else {
      where = 'пайплайн CI (.gitlab-ci.yml, лежит в репозитории)';
      safe = [
        'deploy:',
        '  stage: deploy',
        '  image: docker:27',
        '  script:',
        '    - echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"',
        `    - docker build -t "$CI_REGISTRY/${svc}:$CI_COMMIT_SHORT_SHA" .`,
        `    - docker push "$CI_REGISTRY/${svc}:$CI_COMMIT_SHORT_SHA"`,
        '  only:',
        '    - main',
      ];
      leaks = [
        { line: `    - curl -X POST -H "Authorization: Bearer ${pass}${rng.int(10, 99)}" https://deploy.local/hooks/${svc}`, why: 'токен деплоя записан литералом в файл пайплайна из репозитория' },
        { line: `    - psql "postgres://deploy:${pass}@db.prod.local/${svc}" -f migrate.sql`, why: 'пароль БД записан литералом в файл пайплайна из репозитория' },
      ];
    }
    const leak = rng.pick(leaks);
    // Секрет вставляется после первых строк (не в заголовок), позиция — от seed.
    // Позиция вставки: Dockerfile — после WORKDIR, compose — внутри environment, CI — внутри script.
    const pos = carrier === 'compose' ? rng.int(6, 7) : carrier === 'ci' ? rng.int(4, 7) : rng.int(3, 8);
    const lines = [...safe.slice(0, pos), leak.line, ...safe.slice(pos)];
    return {
      prompt: `Файл: ${where}. Ровно в одной строке секрет оказывается открытым текстом там, где его могут прочитать посторонние. Укажите номер этой строки.`,
      code: lines.join('\n'),
      answerHint: 'номер строки',
      answerKey: String(pos + 1),
      explanation: `Строка ${pos + 1}: ${leak.why}. Остальные строки берут секреты из переменных окружения CI, файла вне репозитория или секрет-монтирования BuildKit.`,
      params: { carrier, pos: pos + 1, leak: leak.line.split('=')[0]!.trim().slice(0, 30) },
    };
  },
};

// --- qa: пирамида тестов ----------------------------------------------------

const TEST_POOL: { kind: 'unit' | 'integration' | 'e2e'; text: string }[] = [
  { kind: 'unit', text: 'вызывает calcDiscount({sum}) с подменённым репозиторием цен и сравнивает результат' },
  { kind: 'unit', text: 'проверяет, что parseDate("{bad}") бросает ошибку; ни сети, ни БД' },
  { kind: 'unit', text: 'передаёт в validateEmail сто строк из таблицы граничных случаев' },
  { kind: 'unit', text: 'рендерит функцию formatPrice({sum}) и сравнивает строку с «{sum} ₽»' },
  { kind: 'integration', text: 'поднимает PostgreSQL в Testcontainers и проверяет, что репозиторий сохраняет и читает заказ' },
  { kind: 'integration', text: 'стартует HTTP-сервер {svc} в процессе теста и шлёт POST /orders через supertest, БД — тестовая' },
  { kind: 'integration', text: 'публикует сообщение в локальный Kafka-контейнер и ждёт, что консьюмер запишет строку в БД' },
  { kind: 'e2e', text: 'Playwright открывает сайт на стенде, входит под тестовым пользователем и оформляет заказ' },
  { kind: 'e2e', text: 'Selenium проходит регистрацию в браузере на стенде со всеми сервисами и реальной БД' },
  { kind: 'e2e', text: 'Cypress кликает по корзине на развернутом фронтенде, запросы идут в настоящий бэкенд {svc}' },
];

export const testPyramid: TaskGenerator = {
  id: 'eng.test-pyramid',
  taskId: 'task:test-pyramid',
  title: 'Уровни пирамиды тестов',
  specialization: 'engineering',
  subcategoryId: 'engineering.qa-automation',
  grade: 'junior',
  catalogIds: ['eng.test-strategy'],
  format: 'list',
  a: 1.0,
  b: -1.4,
  paramSpace: 5e4,
  timeLimitSec: 120,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const svc = rng.pick(SERVICES);
    const sum = rng.int(1, 99) * 100;
    const bad = rng.pick(['31.02.2026', '2026-13-01', 'вчера']);
    const ask = rng.pick(['unit', 'integration', 'e2e'] as const);
    // По 1–3 теста каждого уровня, всего 6.
    const byKind = (k: string) => rng.shuffle(TEST_POOL.filter((t) => t.kind === k));
    // Шесть тестов: по уровням 1/2/3 в любом порядке или 2/2/2 (в пуле не меньше 3 каждого уровня).
    const counts = rng.pick([[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1], [2, 2, 2]]);
    const kinds = ['unit', 'integration', 'e2e'] as const;
    const picked = kinds.flatMap((k, i) => byKind(k).slice(0, counts[i]!));
    const tests = rng.shuffle(picked).map((t) => ({ ...t, text: t.text.replace(/\{sum\}/g, String(sum)).replace(/\{svc\}/g, svc).replace(/\{bad\}/g, bad) }));
    const ru = { unit: 'модульные (unit)', integration: 'интеграционные', e2e: 'сквозные (end-to-end)' }[ask];
    const nums = tests.flatMap((t, i) => (t.kind === ask ? [i + 1] : []));
    return {
      prompt: `Шесть тестов сервиса ${svc}. Какие из них — ${ru}? Перечислите номера.`,
      code: tests.map((t, i) => `${i + 1}. ${t.text}`).join('\n'),
      answerHint: 'номера через запятую',
      answerKey: listKey(nums),
      explanation: `Модульный тест проверяет код без внешних процессов (зависимости подменены); интеграционный — вместе с настоящей БД, брокером или HTTP-сервером; сквозной — через интерфейс пользователя на развёрнутой системе. Здесь ${ru}: ${listKey(nums)}.`,
      params: { ask, nums: listKey(nums) },
    };
  },
};

// --- qa: фикстуры и изоляция ---------------------------------------------------

export const fixtureIsolation: TaskGenerator = {
  id: 'eng.fixture-isolation',
  taskId: 'task:fixture-isolation',
  title: 'Изоляция тестов и фикстуры',
  specialization: 'engineering',
  subcategoryId: 'engineering.qa-automation',
  grade: 'junior',
  catalogIds: ['eng.test-isolation'],
  format: 'number',
  a: 1.2,
  b: -0.4,
  paramSpace: 2e4,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const name = rng.pick(['cart', 'inbox', 'queue', 'basket']);
    const variant = rng.pick(['function-new', 'module-new', 'function-global', 'yield-clear'] as const);
    const nTests = rng.int(3, 4);
    const adds = Array.from({ length: nTests }, () => rng.int(1, 3));
    const target = rng.int(2, nTests);
    const fixture: string[] = [];
    if (variant === 'function-new') fixture.push('@pytest.fixture', `def ${name}():`, '    return []');
    if (variant === 'module-new') fixture.push('@pytest.fixture(scope="module")', `def ${name}():`, '    return []');
    if (variant === 'function-global')
      fixture.push('SHARED = []', '', '@pytest.fixture', `def ${name}():`, '    return SHARED');
    if (variant === 'yield-clear')
      fixture.push('SHARED = []', '', '@pytest.fixture', `def ${name}():`, '    yield SHARED', '    SHARED.clear()');
    const tests: string[] = [];
    const letters = 'abcd';
    for (let i = 0; i < nTests; i++) {
      tests.push(`def test_${letters[i]}(${name}):`);
      for (let k = 0; k < adds[i]!; k++) tests.push(`    ${name}.append("${letters[i]}${k + 1}")`);
      if (i + 1 === target) tests.push(`    print(len(${name}))`);
      tests.push('');
    }
    tests.pop();
    const cumulative = variant === 'module-new' || variant === 'function-global';
    const answer = cumulative ? adds.slice(0, target).reduce((s, x) => s + x, 0) : adds[target - 1]!;
    const why: Record<typeof variant, string> = {
      'function-new': 'фикстура по умолчанию function-scope и создаёт новый список на каждый тест',
      'module-new': 'scope="module": один список на весь модуль, тесты видят добавления предыдущих',
      'function-global': 'фикстура вызывается на каждый тест, но возвращает один и тот же глобальный список — состояние течёт между тестами',
      'yield-clear': 'после yield фикстура очищает общий список, каждый тест начинает с пустого',
    };
    return {
      prompt: `Файл с тестами pytest запускается целиком, тесты идут в порядке объявления, без параллелизма. Какое число напечатает test_${letters[target - 1]}?`,
      code: ['import pytest', '', ...fixture, '', '', ...tests].join('\n'),
      answerHint: 'число',
      answerKey: String(answer),
      explanation: `${why[variant]}; поэтому напечатается ${answer}.`,
      params: { variant, adds: adds.join(','), target },
    };
  },
};

// --- sre: SLO, бюджет ошибок, постмортем ------------------------------------------

export const errorBudget: TaskGenerator = {
  id: 'eng.error-budget',
  taskId: 'task:error-budget',
  title: 'Бюджет ошибок по таймлайну инцидента',
  specialization: 'engineering',
  subcategoryId: 'engineering.sre',
  grade: 'junior',
  catalogIds: ['eng.slo', 'eng.incident-postmortem'],
  format: 'number',
  a: 1.1,
  b: -0.6,
  paramSpace: 1e6,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const svc = rng.pick(SERVICES);
    const slo = rng.pick([
      { pct: '99,9', frac: 0.001 },
      { pct: '99,5', frac: 0.005 },
      { pct: '99,95', frac: 0.0005 },
    ]);
    const days = rng.pick([28, 30]);
    const budget = Number((days * 24 * 60 * slo.frac).toFixed(2));
    const nInc = rng.int(1, 2);
    type Inc = { start: number; detect: number; mitigate: number; resolve: number; day: number };
    const incs: Inc[] = [];
    for (let i = 0; i < nInc; i++) {
      const start = rng.int(9 * 60, 20 * 60);
      const detect = start + rng.int(2, 15);
      const mitigate = detect + rng.int(3, 20);
      const resolve = mitigate + rng.int(30, 180);
      incs.push({ start, detect, mitigate, resolve, day: rng.int(2, days - 1) });
    }
    incs.sort((x, y) => x.day - y.day || x.start - y.start);
    if (nInc === 2 && incs[0]!.day === incs[1]!.day) incs[1]!.day = Math.min(days, incs[0]!.day + 1);
    const ask = rng.pick(['remaining', 'ttd', 'ttm'] as const);
    const k = rng.int(1, nInc);
    const impact = incs.reduce((s, x) => s + (x.mitigate - x.start), 0);
    let answer: number;
    let question: string;
    let explanation: string;
    if (ask === 'remaining') {
      answer = Number((budget - impact).toFixed(2));
      question = `Сколько минут бюджета ошибок останется в окне после ${nInc === 1 ? 'этого инцидента' : 'этих инцидентов'}? (Может быть отрицательным; дробное — через точку.)`;
      explanation = `Бюджет = ${days}·24·60·(1 − ${slo.pct} %) = ${budget} мин. Простой считается от начала влияния до его устранения (mitigated), а не до полного разрешения: ${incs.map((x) => x.mitigate - x.start).join(' + ')} = ${impact} мин. Остаток ${answer}.`;
    } else if (ask === 'ttd') {
      const x = incs[k - 1]!;
      answer = x.detect - x.start;
      question = `Каково время обнаружения (TTD) инцидента №${k}, в минутах?`;
      explanation = `TTD — от начала влияния на пользователей до обнаружения: ${hhmm(x.detect)} − ${hhmm(x.start)} = ${answer} мин.`;
    } else {
      const x = incs[k - 1]!;
      answer = x.mitigate - x.start;
      question = `Сколько минут длилось влияние на пользователей в инциденте №${k} (время до устранения влияния, от начала)?`;
      explanation = `Влияние длится от начала до устранения влияния (mitigated): ${hhmm(x.mitigate)} − ${hhmm(x.start)} = ${answer} мин; после mitigated пользователи уже не страдают, хотя причина ещё чинится.`;
    }
    const code = [
      `SLO доступности ${svc}: ${slo.pct} % в скользящем окне ${days} дней. В окне до инцидентов ошибок не было.`,
      '',
      ...incs.flatMap((x, i) => [
        `Инцидент №${i + 1}, день ${x.day}:`,
        `  ${hhmm(x.start)}  начало: ${svc} отвечает 5xx на все запросы`,
        `  ${hhmm(x.detect)}  алерт, дежурный подтвердил`,
        `  ${hhmm(x.mitigate)}  трафик переключён на резервную зону, ошибки прекратились`,
        `  ${hhmm(x.resolve)}  причина устранена, трафик возвращён`,
      ]),
    ].join('\n');
    return {
      prompt: `Фрагмент постмортема. Пока ${svc} отвечает 5xx, сервис считается полностью недоступным. ${question}`,
      code,
      answerHint: 'число минут',
      answerKey: String(answer),
      explanation,
      params: { ask, slo: slo.pct, days, nInc, k },
    };
  },
};

// --- sre: алерт по симптому ---------------------------------------------------------

const SYMPTOM_ALERTS = [
  'доля ответов 5xx на POST /checkout выше 2 % в течение 5 минут',
  'p99 времени ответа API поиска выше 1,5 с в течение 10 минут',
  'синтетическая проверка входа в личный кабинет падает 3 раза подряд',
  'бюджет ошибок SLO доступности сгорает в 14 раз быстрее нормы за последний час',
  'доля успешно доставленных уведомлений ниже 97 % за 15 минут',
];
const CAUSE_ALERTS = [
  'загрузка CPU на узле выше 80 % в течение 5 минут',
  'один под сервиса перезапустился',
  'диск базы данных заполнен на 70 %',
  'пауза сборщика мусора JVM дольше 200 мс',
  'количество горутин в сервисе выросло вдвое за час',
  'реплика кэша Redis перезапущена',
];

export const symptomAlert: TaskGenerator = {
  id: 'eng.symptom-alert',
  taskId: 'task:symptom-alert',
  title: 'Какие алерты будят дежурного',
  specialization: 'engineering',
  subcategoryId: 'engineering.sre',
  grade: 'junior',
  catalogIds: ['eng.alerting'],
  format: 'list',
  a: 1.0,
  b: -1.0,
  paramSpace: 2e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const nSym = rng.int(2, 3);
    const items = rng.shuffle([
      ...rng.sample(SYMPTOM_ALERTS, nSym).map((text) => ({ text, symptom: true })),
      ...rng.sample(CAUSE_ALERTS, 6 - nSym).map((text) => ({ text, symptom: false })),
    ]);
    const nums = items.flatMap((x, i) => (x.symptom ? [i + 1] : []));
    return {
      prompt: 'Команда переделывает дежурства: будить человека ночью (page) должны только алерты по симптомам — тому, что прямо видит пользователь. Остальное — в тикет или на дашборд. Какие правила оставить как page?',
      code: items.map((x, i) => `${i + 1}. ${x.text}`).join('\n'),
      answerHint: 'номера через запятую',
      answerKey: listKey(nums),
      explanation: `Симптомы — ошибки, задержки и недоступность глазами пользователя (в т. ч. скорость сгорания бюджета SLO): ${listKey(nums)}. Загрузка CPU, рестарт одного пода, заполнение диска, GC — причины или ранние сигналы: пользователь от них может не пострадать.`,
      params: { nums: listKey(nums) },
    };
  },
};

// ===========================================================================
// Middle
// ===========================================================================

// --- data-eng: идемпотентная загрузка -------------------------------------------------

export const idempotentLoad: TaskGenerator = {
  id: 'eng.idempotent-load',
  taskId: 'task:idempotent-load',
  title: 'Перезапуски загрузки',
  specialization: 'engineering',
  subcategoryId: 'engineering.data-eng',
  grade: 'middle',
  catalogIds: ['eng.idempotent-load', 'eng.etl-pipeline'],
  format: 'number',
  a: 1.4,
  b: 0.5,
  paramSpace: 3e5,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ds = rng.pick(DATASETS);
    const strategy = rng.pick(['append', 'replace', 'upsert'] as const);
    const d1 = rng.int(3, 9);
    const day = (d: number) => `2026-10-0${d}`;
    // Файлы: день 1 — v1 и исправленный v2 (часть строк убрана, часть добавлена); день 2 — один файл.
    const base1 = rng.int(1, 4) * 100;
    const n1 = rng.int(4, 6);
    const f1v1 = Array.from({ length: n1 }, (_, i) => base1 + i);
    const removed = rng.sample(f1v1, 1);
    const added = Array.from({ length: rng.int(1, 2) }, (_, i) => base1 + n1 + i);
    const f1v2 = [...f1v1.filter((x) => !removed.includes(x)), ...added];
    const n2 = rng.int(3, 5);
    const f2 = Array.from({ length: n2 }, (_, i) => base1 + 50 + i);
    type Run = { d: number; file: number[]; label: string; failAfter: number | null };
    const failK = rng.int(1, n2 - 1);
    const runs: Run[] = [
      { d: d1, file: f1v1, label: `${day(d1)}.csv (строк: ${f1v1.length})`, failAfter: null },
      { d: d1 + 1, file: f2, label: `${day(d1 + 1)}.csv (строк: ${f2.length})`, failAfter: failK },
      { d: d1 + 1, file: f2, label: `${day(d1 + 1)}.csv (строк: ${f2.length}), перезапуск`, failAfter: null },
      { d: d1, file: f1v2, label: `${day(d1)}.csv, исправленный источником (строк: ${f1v2.length}; убран ${ds.key} ${removed[0]}, добавлены ${added.join(', ')})`, failAfter: null },
    ];
    // Симуляция: таблица — мультимножество (ключ, день).
    let rows: { id: number; d: number }[] = [];
    for (const r of runs) {
      if (strategy === 'append') {
        const n = r.failAfter ?? r.file.length;
        rows.push(...r.file.slice(0, n).map((id) => ({ id, d: r.d })));
      } else if (strategy === 'replace') {
        if (r.failAfter !== null) continue; // транзакция откатилась
        rows = rows.filter((x) => x.d !== r.d).concat(r.file.map((id) => ({ id, d: r.d })));
      } else {
        const n = r.failAfter ?? r.file.length;
        for (const id of r.file.slice(0, n)) if (!rows.some((x) => x.id === id)) rows.push({ id, d: r.d });
      }
    }
    const sql = {
      append: [`-- без транзакции, строки вставляются по одной`, `INSERT INTO ${ds.table} (${ds.key}, day, ...) VALUES (...);  -- для каждой строки файла`],
      replace: ['BEGIN;', `DELETE FROM ${ds.table} WHERE day = :day;`, `INSERT INTO ${ds.table} (${ds.key}, day, ...) SELECT ... FROM file;`, 'COMMIT;  -- при ошибке ROLLBACK'],
      upsert: [`-- без транзакции, строки вставляются по одной; ${ds.key} — PRIMARY KEY`, `INSERT INTO ${ds.table} (${ds.key}, day, ...) VALUES (...)`, `ON CONFLICT (${ds.key}) DO NOTHING;`],
    }[strategy];
    const log = runs.map((r, i) => `${i + 1}. ${r.label}: ${r.failAfter === null ? 'успех' : `упал на строке ${r.failAfter + 1} (до ошибки обработано строк: ${r.failAfter})`}`);
    const why = {
      append: 'Вставка без ключа и транзакции не идемпотентна: упавший запуск оставил часть строк, перезапуск и повторная загрузка дня дописали дубли.',
      replace: 'DELETE + INSERT дня в одной транзакции идемпотентен: упавший запуск откатился, перезагрузка дня заменяет его строки целиком (убранная строка тоже исчезает).',
      upsert: 'ON CONFLICT DO NOTHING защищает от дублей, но не удаляет строки, убранные из исправленного файла, — она остаётся в таблице.',
    }[strategy];
    return {
      prompt: `Таблица ${ds.table} изначально пуста. Ежедневная задача грузит файл дня так:`,
      code: [...sql, '', 'Журнал запусков:', ...log].join('\n'),
      answerHint: 'число строк',
      answerKey: String(rows.length),
      explanation: `${why} Итог SELECT COUNT(*) = ${rows.length}.`,
      params: { strategy, n1, n2, failK, removed: removed[0], added: added.length },
    };
  },
};

// --- data-eng: инкрементальная выгрузка по водяному знаку ------------------------------------

export const incrementalWatermark: TaskGenerator = {
  id: 'eng.incremental-watermark',
  taskId: 'task:incremental-watermark',
  title: 'Инкрементальная выгрузка',
  specialization: 'engineering',
  subcategoryId: 'engineering.data-eng',
  grade: 'middle',
  catalogIds: ['eng.incremental-load'],
  format: 'number',
  a: 1.3,
  b: 0.8,
  paramSpace: 1e7,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ds = rng.pick(DATASETS);
    const op = rng.pick(['>', '>='] as const);
    const wmMode = rng.pick(['max', 'now'] as const);
    const runs = [10 * 60, 10 * 60 + 15, 10 * 60 + 30, 10 * 60 + 45];
    // Строки: updated_at — время изменения, commit — когда строка стала видна (длинная транзакция → позже).
    const n = rng.int(6, 8);
    type R = { id: number; upd: number; commit: number };
    const rows: R[] = [];
    for (let i = 0; i < n; i++) {
      const upd = rng.int(9 * 60 + 50, 10 * 60 + 28);
      const late = rng.int(0, 3) === 0;
      const commit = late ? upd + rng.int(5, 14) : upd;
      rows.push({ id: rng.int(10, 99) * 10 + i, upd, commit: Math.min(commit, 10 * 60 + 40) });
    }
    // Гарантируем хотя бы одну «опоздавшую» строку, коммит которой пересекает первый запуск.
    rows[0]!.upd = runs[1]! - rng.int(2, 6);
    rows[0]!.commit = runs[1]! + rng.int(2, 6);
    rows.sort((x, y) => x.upd - y.upd || x.id - y.id);
    // Симуляция трёх запусков.
    let wm = 9 * 60 + 45;
    const exported: number[] = [];
    for (const t of runs.slice(1)) {
      const visible = rows.filter((r) => r.commit <= t);
      const batch = visible.filter((r) => (op === '>' ? r.upd > wm : r.upd >= wm));
      exported.push(...batch.map((r) => r.id));
      if (wmMode === 'max') {
        if (batch.length > 0) wm = Math.max(...batch.map((r) => r.upd));
      } else wm = t;
    }
    const lost = rows.filter((r) => !exported.includes(r.id)).length;
    const ask = rng.pick(['lost', 'total'] as const);
    const answer = ask === 'lost' ? lost : exported.length;
    const code = [
      table(ds.table, [ds.key, 'updated_at', 'закоммичена в'], rows.map((r) => [r.id, hhmm(r.upd), hhmm(r.commit)])),
      '',
      `-- запуски в ${runs.slice(1).map(hhmm).join(', ')}; начальный :wm = ${hhmm(9 * 60 + 45)}`,
      `SELECT * FROM ${ds.table} WHERE updated_at ${op} :wm;`,
      wmMode === 'max' ? '-- после успешной выгрузки: :wm = MAX(updated_at) выгруженных строк (если строк нет — не меняется)' : '-- после выгрузки: :wm = время запуска (now())',
    ].join('\n');
    return {
      prompt: `Задача раз в 15 минут выгружает изменённые строки ${ds.table} в хранилище. Запрос видит только закоммиченные строки (закоммиченная в минуту запуска — видна); updated_at ставится в момент изменения, а коммит может прийти позже (длинная транзакция). ${ask === 'lost' ? 'Сколько строк так и не попадут в хранилище после трёх запусков?' : 'Сколько строк в сумме будет выгружено за три запуска (повторная выгрузка одной строки считается заново)?'}`,
      code,
      answerHint: 'число строк',
      answerKey: String(answer),
      explanation: `Выгружено по запускам: ${exported.length} строк, потеряно ${lost}. ${wmMode === 'now' ? 'Водяной знак = время запуска: строка, закоммиченная после запуска, но с updated_at раньше него, при следующем запуске уже за водяным знаком.' : 'Водяной знак = MAX(updated_at) выгруженного: опоздавшая строка теряется, если к её коммиту водяной знак ушёл дальше её updated_at.'} ${op === '>=' ? 'Условие >= повторно выгружает строки ровно на водяном знаке.' : 'Условие > не повторяет строки на границе.'}`,
      params: { op, wmMode, ask, n, lost, total: exported.length },
    };
  },
};

// --- data-eng: партиционирование -------------------------------------------------------

export const partitionPrune: TaskGenerator = {
  id: 'eng.partition-prune',
  taskId: 'task:partition-prune',
  title: 'Какие секции прочитает запрос',
  specialization: 'engineering',
  subcategoryId: 'engineering.data-eng',
  grade: 'middle',
  catalogIds: ['eng.partitioning'],
  format: 'list',
  a: 1.2,
  b: 0.7,
  paramSpace: 5e3,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ds = rng.pick(DATASETS);
    const first = rng.int(1, 5);
    const nParts = rng.int(4, 6);
    const months = Array.from({ length: nParts }, (_, i) => first + i);
    const mm = (m: number) => String(m).padStart(2, '0');
    const pname = (m: number) => `p2026_${mm(m)}`;
    const ddl = [
      `CREATE TABLE ${ds.table} (${ds.key} bigint, user_id bigint, created_at timestamp NOT NULL, amount numeric)`,
      '  PARTITION BY RANGE (created_at);',
      ...months.map((m) => `CREATE TABLE ${pname(m)} PARTITION OF ${ds.table} FOR VALUES FROM ('2026-${mm(m)}-01') TO ('2026-${mm(m + 1)}-01');`),
    ];
    const i = rng.int(1, nParts - 2);
    const m = months[i]!;
    const kind = rng.int(0, 4);
    let where: string;
    let parts: number[];
    let why: string;
    if (kind === 0) {
      where = `created_at >= '2026-${mm(m)}-01' AND created_at < '2026-${mm(m + 2)}-01'`;
      parts = [m, m + 1].filter((x) => months.includes(x));
      why = 'полуоткрытый диапазон ровно по границам секций — читаются только они';
    } else if (kind === 1) {
      where = `created_at BETWEEN '2026-${mm(m)}-01' AND '2026-${mm(m + 1)}-01'`;
      parts = [m, m + 1].filter((x) => months.includes(x));
      why = `BETWEEN включает правую границу: полночь 1-го числа следующего месяца лежит в секции ${pname(m + 1)}`;
    } else if (kind === 2) {
      where = `date_trunc('month', created_at) = '2026-${mm(m)}-01'`;
      parts = months;
      why = 'условие на выражение от ключа, а не на сам ключ: планировщик не может отсечь секции и читает все';
    } else if (kind === 3) {
      where = `created_at > '2026-${mm(m)}-15'`;
      parts = months.filter((x) => x >= m);
      why = 'открытый справа диапазон: секция месяца, где лежит граница, и все следующие';
    } else {
      where = `user_id = ${rng.int(10, 999)} AND amount > ${rng.int(1, 9) * 100}`;
      parts = months;
      why = 'в условии нет ключа секционирования — читаются все секции';
    }
    return {
      prompt: `PostgreSQL, отсечение секций (partition pruning) включено. Какие секции прочитает запрос SELECT * FROM ${ds.table} WHERE ${where}? Перечислите имена секций.`,
      code: ddl.join('\n'),
      answerHint: 'имена через запятую, например p2026_01, p2026_02',
      answerKey: parts.map(pname).sort().join(','),
      explanation: `${why}: ${parts.map(pname).join(', ')}.`,
      params: { kind, first, nParts, month: m },
    };
  },
};

// --- devops: пробы и ресурсы Kubernetes ----------------------------------------------------

export const k8sProbes: TaskGenerator = {
  id: 'eng.k8s-probes',
  taskId: 'task:k8s-probes',
  title: 'Когда сработают пробы',
  specialization: 'engineering',
  subcategoryId: 'engineering.devops',
  grade: 'middle',
  catalogIds: ['eng.k8s-probes'],
  format: 'number',
  a: 1.3,
  b: 0.4,
  paramSpace: 5e5,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const svc = rng.pick(SERVICES);
    const kind = rng.pick(['restart', 'unready'] as const);
    const live = { delay: rng.pick([5, 10, 15]), period: rng.pick([5, 10]), fail: rng.int(2, 4) };
    const ready = { delay: rng.pick([0, 5]), period: rng.pick([3, 5]), fail: rng.int(1, 3) };
    const hang = rng.int(25, 70);
    // Момент failureThreshold-й подряд неуспешной пробы: первая проба в момент ≥ hang и ещё fail−1 за ней.
    const firstFailing = (p: { delay: number; period: number }) => {
      const k = Math.max(0, Math.ceil((hang - p.delay) / p.period));
      return p.delay + k * p.period;
    };
    const tLive = firstFailing(live) + (live.fail - 1) * live.period;
    let tReady = firstFailing(ready) + (ready.fail - 1) * ready.period;
    // Вопрос про трафик однозначен, только если readiness срабатывает не позже перезапуска.
    if (kind === 'unready' && tReady > tLive) {
      ready.fail = 1;
      tReady = firstFailing(ready);
    }
    const answer = kind === 'restart' ? tLive : tReady;
    return {
      prompt: `Контейнер ${svc} стартовал в t = 0 и в t = ${hang} с завис: все проверки начиная с этого момента неуспешны. Пробы идут в моменты initialDelaySeconds + k·periodSeconds (k = 0, 1, …), длительность проверки не учитывать, действие наступает сразу после failureThreshold-й подряд неуспешной пробы. ${kind === 'restart' ? 'На какой секунде kubelet перезапустит контейнер?' : 'На какой секунде под перестанет получать трафик через Service?'}`,
      code: [
        'livenessProbe:',
        '  httpGet: { path: /healthz, port: 8080 }',
        `  initialDelaySeconds: ${live.delay}`,
        `  periodSeconds: ${live.period}`,
        `  failureThreshold: ${live.fail}`,
        'readinessProbe:',
        '  httpGet: { path: /ready, port: 8080 }',
        `  initialDelaySeconds: ${ready.delay}`,
        `  periodSeconds: ${ready.period}`,
        `  failureThreshold: ${ready.fail}`,
      ].join('\n'),
      answerHint: 'секунда',
      answerKey: String(answer),
      explanation:
        kind === 'restart'
          ? `Перезапуск делает liveness: первая неуспешная проба в t = ${firstFailing(live)}, ${live.fail}-я подряд — в t = ${tLive}. Readiness контейнер не перезапускает.`
          : `Из endpoints Service под убирает readiness: первая неуспешная проба в t = ${firstFailing(ready)}, ${ready.fail}-я подряд — в t = ${tReady}. Liveness отвечает за перезапуск, а не за трафик.`,
      params: { kind, hang, live: `${live.delay}/${live.period}/${live.fail}`, ready: `${ready.delay}/${ready.period}/${ready.fail}` },
    };
  },
};

export const k8sCapacity: TaskGenerator = {
  id: 'eng.k8s-capacity',
  taskId: 'task:k8s-capacity',
  title: 'Сколько подов поместится на узел',
  specialization: 'engineering',
  subcategoryId: 'engineering.devops',
  grade: 'middle',
  catalogIds: ['eng.k8s-resources'],
  format: 'number',
  a: 1.2,
  b: 0.3,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const svc = rng.pick(SERVICES);
    const kind = 'capacity';
    const allocCpu = rng.pick([2000, 3000, 4000]);
    const allocMem = rng.pick([4096, 6144, 8192]);
    const usedCpuReq = rng.int(2, 8) * 100;
    const usedMemReq = rng.int(4, 12) * 128;
    const reqCpu = rng.pick([100, 200, 250, 300, 500]);
    const reqMem = rng.pick([256, 384, 512, 768]);
    const limCpu = reqCpu * rng.int(2, 4);
    const limMem = reqMem * 2;
    const usageCpu = rng.int(1, Math.floor(usedCpuReq / 100)) * 50;
    const answer = Math.min(Math.floor((allocCpu - usedCpuReq) / reqCpu), Math.floor((allocMem - usedMemReq) / reqMem));
    const byCpu = Math.floor((allocCpu - usedCpuReq) / reqCpu);
    const byMem = Math.floor((allocMem - usedMemReq) / reqMem);
    return {
      prompt: `На узле нет других ограничений (taints, affinity, лимит числа подов). Сколько подов деплоймента ${svc} планировщик максимум разместит на этом узле?`,
      code: [
        `Узел: allocatable cpu ${allocCpu}m, memory ${allocMem}Mi`,
        `Уже запущенные поды: requests cpu ${usedCpuReq}m, memory ${usedMemReq}Mi; фактически потребляют cpu ${usageCpu}m`,
        '',
        `${svc}, один контейнер:`,
        '  resources:',
        `    requests: { cpu: ${reqCpu}m, memory: ${reqMem}Mi }`,
        `    limits:   { cpu: ${limCpu}m, memory: ${limMem}Mi }`,
      ].join('\n'),
      answerHint: 'число подов',
      answerKey: String(answer),
      explanation: `Планировщик складывает requests, а не limits и не фактическое потребление: по CPU (${allocCpu} − ${usedCpuReq}) / ${reqCpu} = ${byCpu}, по памяти (${allocMem} − ${usedMemReq}) / ${reqMem} = ${byMem}; берётся минимум — ${answer}.`,
      params: { kind, allocCpu, allocMem, usedCpuReq, usedMemReq, reqCpu, reqMem },
    };
  },
};

// --- devops: откат деплоя ---------------------------------------------------------------

export const deployRollback: TaskGenerator = {
  id: 'eng.deploy-rollback',
  taskId: 'task:deploy-rollback',
  title: 'Что работает после отката',
  specialization: 'engineering',
  subcategoryId: 'engineering.devops',
  grade: 'middle',
  catalogIds: ['eng.deploy-rollback'],
  format: 'text',
  a: 1.3,
  b: 0.6,
  paramSpace: 5e4,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const svc = rng.pick(SERVICES);
    const major = rng.int(1, 3);
    let minor = rng.int(0, 6);
    const nDeploys = rng.int(3, 4);
    const tags: string[] = [];
    for (let i = 0; i < nDeploys; i++) {
      tags.push(`${major}.${minor}.${rng.int(0, 3)}`);
      minor += rng.int(1, 2);
    }
    // Ревизии: номер → тег. Откат создаёт новую ревизию с шаблоном целевой; старый номер исчезает.
    const revs = new Map<number, string>(tags.map((t, i) => [i + 1, t]));
    const cmds: string[] = [`kubectl create deployment ${svc} --image=registry.local/${svc}:${tags[0]}`];
    for (const t of tags.slice(1)) cmds.push(`kubectl set image deployment/${svc} app=registry.local/${svc}:${t}`);
    const history = [`$ kubectl rollout history deployment/${svc}`, 'REVISION  CHANGE-CAUSE', ...[...revs.entries()].map(([n, t]) => `${n}         image ${svc}:${t}`)];
    const undo = (to?: number) => {
      const nums = [...revs.keys()].sort((x, y) => x - y);
      const target = to ?? nums[nums.length - 2]!;
      const tag = revs.get(target)!;
      revs.delete(target);
      revs.set(Math.max(...nums) + 1, tag);
    };
    const ops: string[] = [];
    const first = rng.int(0, 1) === 0 ? undefined : rng.int(1, nDeploys - 2);
    undo(first);
    ops.push(`kubectl rollout undo deployment/${svc}${first ? ` --to-revision=${first}` : ''}`);
    const more = rng.int(0, 2);
    for (let i = 0; i < more; i++) {
      undo();
      ops.push(`kubectl rollout undo deployment/${svc}`);
    }
    const nums = [...revs.keys()].sort((x, y) => x - y);
    const current = revs.get(nums[nums.length - 1]!)!;
    return {
      prompt: `Деплоймент ${svc} обновляли командами ниже, каждое развёртывание успешно. Образ с каким тегом будет работать после последней команды? (Ответ — тег, например 1.2.3.)`,
      code: [...cmds, ...history, ...ops].join('\n'),
      answerHint: 'тег образа',
      answerKey: `${current}|${svc}:${current}|registry.local/${svc}:${current}`,
      explanation: `rollout undo без --to-revision возвращает предыдущую ревизию, а сам откат становится новой ревизией (номер старой исчезает). Поэтому два undo подряд не уходят «на два шага назад», а переключают между двумя последними версиями. Итог: ${current}.`,
      params: { nDeploys, first: first ?? 0, more, tags: tags.join(',') },
    };
  },
};

// --- qa: флаки --------------------------------------------------------------------------

export const flakyLine: TaskGenerator = {
  id: 'eng.flaky-line',
  taskId: 'task:flaky-line',
  title: 'Найди причину флаки-теста',
  specialization: 'engineering',
  subcategoryId: 'engineering.qa-automation',
  grade: 'middle',
  catalogIds: ['eng.flaky-tests', 'eng.test-isolation'],
  format: 'line',
  a: 1.2,
  b: 0.6,
  paramSpace: 5e4,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ent = rng.pick(['order', 'invoice', 'booking', 'ticket']);
    const name = rng.pick(NAMES);
    // Шаги теста: у каждого безопасная и флаки-форма (одна строка). Флаки ровно один.
    type Step = { safe: string; flaky: string; why: string };
    const steps: Step[] = [
      {
        safe: "  const email = `user-${randomUUID()}@test.ru`;",
        flaky: "  const email = `user${Math.floor(Math.random() * 100)}@test.ru`;",
        why: 'email из 100 вариантов при параллельных тестах на общей БД иногда совпадает — уникальный индекс падает',
      },
      {
        safe: `  await waitFor(async () => expect(await getStatus(${ent}.id)).toBe('done'), { timeout: 5000 });`,
        flaky: `  await sleep(300); expect(await getStatus(${ent}.id)).toBe('done');`,
        why: 'фиксированная пауза вместо ожидания условия: фоновая обработка иногда дольше 300 мс',
      },
      {
        safe: `  expect((await db.query('SELECT name FROM items WHERE ${ent}_id = $1 ORDER BY name', [${ent}.id])).rows.map((r) => r.name)).toEqual(['A', 'B']);`,
        flaky: `  expect((await db.query('SELECT name FROM items WHERE ${ent}_id = $1', [${ent}.id])).rows.map((r) => r.name)).toEqual(['A', 'B']);`,
        why: 'без ORDER BY порядок строк не гарантирован, сравнение с упорядоченным массивом иногда падает',
      },
      {
        safe: `  expect(${ent}.createdAt.toISOString()).toBe(clock.now().toISOString());`,
        flaky: `  expect(${ent}.createdAt.toISOString()).toBe(new Date().toISOString());`,
        why: 'сравнение с текущим временем: между созданием и проверкой проходят миллисекунды, иногда разные',
      },
    ];
    const order = rng.shuffle([0, 1, 2, 3]);
    const flakyIdx = rng.pick(order);
    const lines = [
      "import { randomUUID } from 'node:crypto';",
      "import { db, clock, waitFor, sleep, api, getStatus } from './helpers';",
      '',
      `test('${name} оформляет ${ent}', async () => {`,
      '  clock.freeze();',
    ];
    let flakyLine = 0;
    const setup = [`  const ${ent} = await api.create${ent[0]!.toUpperCase()}${ent.slice(1)}({ email, items: ['B', 'A'] });`];
    // Шаг с email должен идти до создания сущности.
    const emailFirst = [0, ...order.filter((x) => x !== 0)];
    for (const s of emailFirst) {
      const st = steps[s]!;
      lines.push(s === flakyIdx ? st.flaky : st.safe);
      if (s === flakyIdx) flakyLine = lines.length;
      if (s === 0) lines.push(...setup);
    }
    lines.push('});');
    return {
      prompt: `Тест иногда падает на CI (тесты идут параллельно на общей тестовой БД), локально обычно проходит. clock.freeze() замораживает часы приложения и clock.now() (но не new Date() в самом тесте); createdAt проставляет приложение. Укажите номер строки, из-за которой тест нестабилен.`,
      code: lines.join('\n'),
      answerHint: 'номер строки',
      answerKey: String(flakyLine),
      explanation: `Строка ${flakyLine}: ${steps[flakyIdx]!.why}. Остальные шаги детерминированы (UUID, ожидание условия, ORDER BY, замороженные часы).`,
      params: { flakyIdx, order: emailFirst.join(','), ent },
    };
  },
};

// --- qa: контрактные тесты --------------------------------------------------------------

export const contractTest: TaskGenerator = {
  id: 'eng.contract-test',
  taskId: 'task:contract-test',
  title: 'Что ломает контракт',
  specialization: 'engineering',
  subcategoryId: 'engineering.qa-automation',
  grade: 'middle',
  catalogIds: ['eng.contract-tests'],
  format: 'list',
  a: 1.2,
  b: 0.5,
  paramSpace: 1e5,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const consumer = rng.pick(SERVICES);
    const ds = rng.pick(DATASETS);
    const unused = rng.sample(['comment', 'source', 'legacy_code', 'region'], 2);
    const changes: { text: string; breaks: boolean }[] = [
      { text: `добавить в ответ новое поле currency`, breaks: false },
      { text: `удалить поле ${unused[0]}`, breaks: false },
      { text: `поменять тип поля ${unused[1]} с string на object`, breaks: false },
      { text: 'добавить необязательный query-параметр ?expand=items', breaks: false },
      { text: 'удалить поле created_at', breaks: true },
      { text: 'переименовать поле amount в total_amount', breaks: true },
      { text: 'отдавать amount строкой ("1500.00") вместо числа', breaks: true },
      { text: 'разрешить status быть null для черновиков, которые тоже попадают в этот ответ', breaks: true },
      { text: 'сделать query-параметр ?region обязательным (без него — 400)', breaks: true },
    ];
    const nBreak = rng.int(1, 3);
    const picked = rng.shuffle([...rng.sample(changes.filter((c) => c.breaks), nBreak), ...rng.sample(changes.filter((c) => !c.breaks), 6 - nBreak)]);
    const nums = picked.flatMap((c, i) => (c.breaks ? [i + 1] : []));
    const contract = [
      `// контракт потребителя ${consumer} (consumer-driven, проверяется на стороне провайдера)`,
      `GET /${ds.table}/42  → 200`,
      '{',
      '  "id": integer,',
      '  "status": string,',
      '  "amount": number,',
      '  "created_at": string (ISO 8601)',
      '}',
      `// провайдер сейчас отдаёт ещё ${unused.join(', ')}; потребитель их не читает и лишние поля игнорирует`,
    ];
    return {
      prompt: `Команда провайдера API «${ds.ru}» предлагает изменения. Какие из них провалят контрактный тест потребителя ${consumer}? Перечислите номера.`,
      code: [...contract, '', ...picked.map((c, i) => `${i + 1}. ${c.text}`)].join('\n'),
      answerHint: 'номера через запятую',
      answerKey: listKey(nums),
      explanation: `Ломает то, что меняет используемые потребителем поля (удаление, переименование, смена типа, null вместо строки) или требования к его запросу (новый обязательный параметр): ${listKey(nums)}. Новые поля, необязательные параметры и поля, которые потребитель не читает, контракт не нарушают.`,
      params: { nums: listKey(nums), nBreak },
    };
  },
};

// --- sre: ретраи и усиление нагрузки --------------------------------------------------------

export const retryAmplification: TaskGenerator = {
  id: 'eng.retry-amplification',
  taskId: 'task:retry-amplification',
  title: 'Шторм ретраев',
  specialization: 'engineering',
  subcategoryId: 'engineering.sre',
  grade: 'middle',
  catalogIds: ['eng.retries-resilience'],
  format: 'number',
  a: 1.3,
  b: 0.3,
  paramSpace: 5e3,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const chain = ['мобильное приложение', 'api-gateway', rng.pick(['checkout', 'billing', 'profile']), rng.pick(['orders-core', 'ledger', 'accounts'])];
    const nHops = rng.int(2, 3);
    const hops = chain.slice(0, nHops + 1).concat(['PostgreSQL']);
    // Каждое звено, кроме последнего, делает до attempts[i] попыток вызвать следующее.
    const attempts = Array.from({ length: hops.length - 1 }, () => rng.int(1, 4));
    // Минимум два звена с ретраями — иначе нечего перемножать.
    if (attempts.filter((x) => x > 1).length < 2) {
      attempts[0] = Math.max(2, attempts[0]!);
      attempts[attempts.length - 1] = Math.max(3, attempts[attempts.length - 1]!);
    }
    const ask = rng.pick(['db', 'total'] as const);
    const reach: number[] = [1];
    for (const a of attempts) reach.push(reach[reach.length - 1]! * a);
    const db = reach[reach.length - 1]!;
    const total = reach.slice(1).reduce((s, x) => s + x, 0);
    const answer = ask === 'db' ? db : total;
    const code = hops.slice(0, -1).map((h, i) => `${h} → ${hops[i + 1]}: до ${attempts[i]} ${attempts[i] === 1 ? 'попытки (без ретраев)' : 'попыток'} при ошибке или таймауте`);
    return {
      prompt: `БД перегружена: каждый запрос к ней заканчивается таймаутом, и каждое звено цепочки после исчерпания попыток отвечает вызывающему ошибкой. ${ask === 'db' ? 'Сколько запросов получит PostgreSQL из-за одного нажатия пользователя?' : `Сколько запросов в сумме получат все звенья после приложения (${hops.slice(1).join(', ')}) из-за одного нажатия пользователя?`}`,
      code: code.join('\n'),
      answerHint: 'число запросов',
      answerKey: String(answer),
      explanation: `Ретраи на каждом уровне перемножаются: до звеньев доходит ${reach.slice(1).join(', ')} запросов; ${ask === 'db' ? `в БД — ${db}` : `в сумме ${total}`}. Поэтому ретраи делают на одном уровне, с бэкоффом, джиттером и бюджетом ретраев.`,
      params: { attempts: attempts.join(','), ask, nHops },
    };
  },
};

// ===========================================================================
// Добор до 8 семейств на подкатегорию (ADR-0003, дополнение 10.10 15:50)
// ===========================================================================

// --- data-eng: NULL в агрегатах (Junior) -----------------------------------------------

export const nullAggregates: TaskGenerator = {
  id: 'eng.null-aggregates',
  taskId: 'task:null-aggregates',
  title: 'NULL в агрегатах',
  specialization: 'engineering',
  subcategoryId: 'engineering.data-eng',
  grade: 'junior',
  catalogIds: ['eng.data-quality'],
  format: 'number',
  a: 1.1,
  b: -0.8,
  paramSpace: 1e6,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ds = rng.pick(DATASETS);
    const n = rng.int(6, 8);
    const nNull = rng.int(2, 3);
    const nullIdx = new Set(rng.sample(Array.from({ length: n }, (_, i) => i), nNull));
    const kind = rng.int(0, 3);
    // Значения бонуса в сотнях; для AVG последний ненулевой подбирается так, чтобы среднее было целым.
    const vals: (number | null)[] = Array.from({ length: n }, (_, i) => (nullIdx.has(i) ? null : rng.int(1, 9)));
    if (kind === 2) {
      const nn = vals.flatMap((v, i) => (v === null ? [] : [i]));
      const last = nn[nn.length - 1]!;
      const rest = nn.slice(0, -1).reduce((acc, i) => acc + vals[i]!, 0);
      const options = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((v) => (rest + v) % nn.length === 0);
      vals[last] = rng.pick(options);
    }
    const bonus = vals.map((v) => (v === null ? null : v * 100));
    const rows = bonus.map((b, i) => [100 + i, rng.pick(NAMES), b === null ? 'NULL' : b]);
    const nonNull = bonus.filter((b): b is number => b !== null);
    const pivot = rng.pick(nonNull);
    let sql: string;
    let answer: number;
    let why: string;
    if (kind === 0) {
      sql = `SELECT COUNT(bonus) FROM ${ds.table};`;
      answer = nonNull.length;
      why = 'COUNT(колонка) не считает NULL, в отличие от COUNT(*)';
    } else if (kind === 1) {
      sql = `SELECT COUNT(*) FROM ${ds.table} WHERE bonus <> ${pivot};`;
      answer = nonNull.filter((b) => b !== pivot).length;
      why = `сравнение NULL <> ${pivot} даёт NULL, а не TRUE: строки с NULL в выборку не попадают`;
    } else if (kind === 2) {
      sql = `SELECT AVG(bonus) FROM ${ds.table};`;
      answer = nonNull.reduce((acc, b) => acc + b, 0) / nonNull.length;
      why = 'AVG игнорирует NULL: делится сумма ненулевых значений на их количество, а не на число строк';
    } else {
      sql = `SELECT COUNT(DISTINCT bonus) FROM ${ds.table};`;
      answer = new Set(nonNull).size;
      why = 'COUNT(DISTINCT) считает разные ненулевые значения; NULL не считается значением';
    }
    return {
      prompt: `Колонка bonus допускает NULL (бонус не начислен). Что вернёт запрос?`,
      code: [table(ds.table, [ds.key, 'manager', 'bonus'], rows), '', sql].join('\n'),
      answerHint: 'число',
      answerKey: String(answer),
      explanation: `${why}: ${answer}.`,
      params: { kind, n, nNull, dataset: ds.table },
    };
  },
};

// --- data-eng: размножение строк при JOIN (Junior) ----------------------------------------

export const joinFanout: TaskGenerator = {
  id: 'eng.join-fanout',
  taskId: 'task:join-fanout',
  title: 'JOIN с дублем в справочнике',
  specialization: 'engineering',
  subcategoryId: 'engineering.data-eng',
  grade: 'junior',
  catalogIds: ['eng.data-quality', 'eng.etl-pipeline'],
  format: 'number',
  a: 1.2,
  b: -0.5,
  paramSpace: 1e7,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const nCust = rng.int(3, 4);
    const cities = ['Казань', 'Самара', 'Тверь', 'Омск', 'Пермь'];
    const names = rng.sample(NAMES, nCust);
    const customers = Array.from({ length: nCust }, (_, i) => ({ id: i + 1, name: names[i]!, city: rng.pick(cities) }));
    // Дубль: один клиент записан в справочник дважды (переехал, старую строку не закрыли).
    const dup = rng.pick(customers);
    const dupCity = rng.pick(cities.filter((c) => c !== dup.city));
    const dim = rng.shuffle([...customers.map((c) => ({ ...c })), { ...dup, city: dupCity }]);
    const nOrders = rng.int(5, 7);
    const ghost = nCust + 1; // клиента нет в справочнике
    const orders = Array.from({ length: nOrders }, (_, i) => ({ id: 500 + i, cust: i === 0 ? dup.id : i === 1 ? ghost : rng.int(1, nCust), amount: rng.int(1, 9) * 100 }));
    const shuffled = rng.shuffle(orders);
    const kind = rng.int(0, 2);
    const mult = (cust: number) => dim.filter((d) => d.id === cust).length;
    let sql: string;
    let answer: number;
    if (kind === 0) {
      sql = 'SELECT SUM(o.amount)\nFROM orders o JOIN customers c ON c.customer_id = o.customer_id;';
      answer = shuffled.reduce((acc, o) => acc + o.amount * mult(o.cust), 0);
    } else if (kind === 1) {
      sql = 'SELECT COUNT(*)\nFROM orders o JOIN customers c ON c.customer_id = o.customer_id;';
      answer = shuffled.reduce((acc, o) => acc + mult(o.cust), 0);
    } else {
      sql = 'SELECT COUNT(*)\nFROM orders o LEFT JOIN customers c ON c.customer_id = o.customer_id;';
      answer = shuffled.reduce((acc, o) => acc + Math.max(1, mult(o.cust)), 0);
    }
    return {
      prompt: 'Аналитик строит витрину выручки. Что вернёт запрос?',
      code: [
        table('customers', ['customer_id', 'name', 'city'], dim.map((d) => [d.id, d.name, d.city])),
        '',
        table('orders', ['order_id', 'customer_id', 'amount'], shuffled.map((o) => [o.id, o.cust, o.amount])),
        '',
        sql,
      ].join('\n'),
      answerHint: 'число',
      answerKey: String(answer),
      explanation: `Клиент ${dup.id} записан в справочник дважды — его заказы после JOIN размножаются; заказа клиента ${ghost} в справочнике нет — ${kind === 2 ? 'LEFT JOIN его сохраняет' : 'INNER JOIN его отбрасывает'}. Итог: ${answer}.`,
      params: { kind, nCust, nOrders, dup: dup.id },
    };
  },
};

// --- data-eng: SCD2 и отчёт на дату факта (Middle) --------------------------------------------

export const scd2AsOf: TaskGenerator = {
  id: 'eng.scd2-as-of',
  taskId: 'task:scd2-as-of',
  title: 'История измерения (SCD2)',
  specialization: 'engineering',
  subcategoryId: 'engineering.data-eng',
  grade: 'middle',
  catalogIds: ['eng.dwh-modeling'],
  format: 'number',
  a: 1.3,
  b: 0.6,
  paramSpace: 1e7,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const cities = rng.sample(['Казань', 'Самара', 'Тверь', 'Омск', 'Пермь'], 3);
    const who = rng.pick(NAMES);
    // Версии клиента: город и дата начала действия (valid_from включительно, valid_to — исключительно).
    const d1 = rng.int(3, 9);
    const d2 = d1 + rng.int(5, 9);
    const versions = [
      { from: 1, to: d1, city: cities[0]! },
      { from: d1, to: d2, city: cities[1]! },
      { from: d2, to: null as number | null, city: cities[2]! },
    ];
    const day = (d: number) => `2026-09-${String(d).padStart(2, '0')}`;
    // Заказы: обязательно один ровно в день смены версии.
    const days = [d1, ...Array.from({ length: rng.int(4, 5) }, () => rng.int(1, 28))];
    const orders = rng.shuffle(days).map((d, i) => ({ id: 700 + i, d, amount: rng.int(1, 9) * 100 }));
    const cityAt = (d: number) => versions.find((v) => v.from <= d && (v.to === null || d < v.to))!.city;
    const target = rng.pick(cities.filter((c) => orders.some((o) => cityAt(o.d) === c)));
    const answer = orders.filter((o) => cityAt(o.d) === target).reduce((acc, o) => acc + o.amount, 0);
    const naive = target === cities[2] ? orders.reduce((acc, o) => acc + o.amount, 0) : 0;
    return {
      prompt: `Измерение клиентов хранится как SCD2: valid_from включительно, valid_to не включительно, NULL — текущая версия. Отчёт относит каждый заказ к городу клиента на дату заказа. Какую сумму заказов отчёт отнесёт к городу «${target}»?`,
      code: [
        table('dim_customer', ['customer_id', 'name', 'city', 'valid_from', 'valid_to'], versions.map((v) => [42, who, v.city, day(v.from), v.to === null ? 'NULL' : day(v.to)])),
        '',
        table('orders', ['order_id', 'customer_id', 'order_date', 'amount'], orders.map((o) => [o.id, 42, day(o.d), o.amount])),
      ].join('\n'),
      answerHint: 'сумма',
      answerKey: String(answer),
      explanation: `Заказ в день смены (${day(d1)}) уже относится к новой версии (valid_from включительно). Сумма по «${target}» — ${answer}${naive ? `; по текущему городу без истории вышло бы ${naive}` : ''}.`,
      params: { d1, d2, target, n: orders.length },
    };
  },
};

// --- devops: порты в docker compose (Junior) --------------------------------------------------

export const portMapping: TaskGenerator = {
  id: 'eng.port-mapping',
  taskId: 'task:port-mapping',
  title: 'Порты в docker compose',
  specialization: 'engineering',
  subcategoryId: 'engineering.devops',
  grade: 'junior',
  catalogIds: ['eng.dockerfile'],
  format: 'number',
  a: 1.1,
  b: -0.8,
  paramSpace: 1e6,
  timeLimitSec: 120,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const webHost = rng.pick([8080, 8081, 3000, 8000, 9000]);
    const webCont = rng.pick([80, 3000, 5173]);
    const apiCont = rng.pick([8000, 8080, 5000, 4000]);
    const apiHost = rng.pick([18000, 18080, 15000, 9090].filter((p) => p !== apiCont));
    const dbPort = 5432;
    const ask = rng.pick(['browser-web', 'web-to-api', 'host-to-api', 'api-to-db'] as const);
    const code = [
      'services:',
      '  web:',
      '    build: ./web',
      '    ports:',
      `      - "${webHost}:${webCont}"`,
      '  api:',
      '    build: ./api',
      '    ports:',
      `      - "${apiHost}:${apiCont}"`,
      '  db:',
      '    image: postgres:16',
      '    # ports не опубликованы',
    ].join('\n');
    const q = {
      'browser-web': ['Разработчик открывает фронтенд в браузере на своей машине: http://localhost:<порт>. Какой порт?', webHost, `слева в "${webHost}:${webCont}" — порт хоста`],
      'web-to-api': ['Сервер web из своего контейнера ходит в API по адресу http://api:<порт>. Какой порт?', apiCont, `внутри сети compose обращаются по имени сервиса и порту контейнера (${apiCont}), проброс на хост не участвует`],
      'host-to-api': ['Разработчик вызывает API curl-ом со своей машины: http://localhost:<порт>. Какой порт?', apiHost, `с хоста доступен опубликованный порт — левая часть "${apiHost}:${apiCont}"`],
      'api-to-db': ['Сервис api подключается к базе: postgres://db:<порт>/app. Какой порт?', dbPort, 'внутри сети compose база доступна по имени сервиса и своему порту 5432, публикация на хост для этого не нужна'],
    }[ask];
    return {
      prompt: `Все сервисы — в одном docker-compose.yml, в общей сети по умолчанию. ${q[0]}`,
      code,
      answerHint: 'номер порта',
      answerKey: String(q[1]),
      explanation: `Ответ ${q[1]}: ${q[2]}.`,
      params: { ask, webHost, webCont, apiHost, apiCont },
    };
  },
};

// --- devops: стадии CI (Junior) ---------------------------------------------------------------

export const ciStages: TaskGenerator = {
  id: 'eng.ci-stages',
  taskId: 'task:ci-stages',
  title: 'Какие задачи CI запустятся',
  specialization: 'engineering',
  subcategoryId: 'engineering.devops',
  grade: 'junior',
  catalogIds: ['eng.ci-cd'],
  format: 'list',
  a: 1.2,
  b: -0.5,
  paramSpace: 2e4,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const svc = rng.pick(SERVICES);
    type Job = { name: string; stage: 'build' | 'test' | 'deploy'; when: 'on_success' | 'on_failure' | 'always'; allow: boolean };
    const nm = (a: string, b: string) => (rng.int(0, 1) === 0 ? a : b);
    const lintAllow = rng.int(0, 2) > 0;
    const e2eAllow = rng.int(0, 2) === 0;
    const jobs: Job[] = [
      { name: nm('compile', 'build-image'), stage: 'build', when: 'on_success', allow: false },
      { name: nm('unit', 'unit-tests'), stage: 'test', when: 'on_success', allow: false },
      { name: nm('lint', 'codestyle'), stage: 'test', when: 'on_success', allow: lintAllow },
      { name: nm('e2e', 'api-tests'), stage: 'test', when: 'on_success', allow: e2eAllow },
      { name: nm('deploy', 'release'), stage: 'deploy', when: 'on_success', allow: false },
      { name: nm('notify', 'alert-chat'), stage: 'deploy', when: 'on_failure', allow: false },
      { name: nm('cleanup', 'teardown'), stage: 'deploy', when: 'always', allow: false },
    ];
    const failing = rng.pick(jobs.slice(0, 4)).name;
    const order = ['build', 'test', 'deploy'];
    // Симуляция по правилам GitLab: on_success — нет неразрешённых падений в прошлых стадиях; on_failure — есть; always — всегда.
    const ran: string[] = [];
    let failedBefore = false;
    for (const st of order) {
      let failedHere = false;
      for (const j of jobs.filter((x) => x.stage === st)) {
        const run = j.when === 'always' || (j.when === 'on_success' ? !failedBefore : failedBefore);
        if (!run) continue;
        ran.push(j.name);
        if (j.name === failing && !j.allow) failedHere = true;
      }
      failedBefore = failedBefore || failedHere;
    }
    const answer = ran.filter((n) => n !== failing).sort();
    const yaml = ['stages: [build, test, deploy]', ''];
    for (const j of jobs) {
      yaml.push(`${j.name}:`, `  stage: ${j.stage}`, `  script: ./ci/${j.name}.sh ${svc}`);
      if (j.allow) yaml.push('  allow_failure: true');
      if (j.when !== 'on_success') yaml.push(`  when: ${j.when}`);
    }
    return {
      prompt: `GitLab CI, пайплайн из файла ниже. Задача ${failing} упала, все остальные, если запускаются, проходят. Какие задачи, кроме ${failing}, будут выполнены? Перечислите имена.`,
      code: yaml.join('\n'),
      answerHint: 'имена через запятую',
      answerKey: answer.join(','),
      explanation: `Задачи одной стадии идут параллельно и запускаются независимо от соседа; on_success в следующих стадиях ждёт отсутствия падений (allow_failure считается успехом), on_failure — наоборот, always — всегда. Выполнятся: ${answer.join(', ')}.`,
      params: { failing, lintAllow, e2eAllow },
    };
  },
};

// --- devops: rolling update (Middle) -----------------------------------------------------------

export const rollingUpdate: TaskGenerator = {
  id: 'eng.rolling-update',
  taskId: 'task:rolling-update',
  title: 'Rolling update: сколько подов',
  specialization: 'engineering',
  subcategoryId: 'engineering.devops',
  grade: 'middle',
  catalogIds: ['eng.deploy-rollback'],
  format: 'number',
  a: 1.3,
  b: 0.5,
  paramSpace: 5e3,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const svc = rng.pick(SERVICES);
    const replicas = rng.int(3, 12);
    const fmt = () => (rng.int(0, 1) === 0 ? { text: `${rng.pick([10, 20, 25, 30, 40, 50])}%`, pct: true } : { text: String(rng.int(1, 3)), pct: false });
    let surge = fmt();
    let unavail = fmt();
    const val = (x: { text: string; pct: boolean }, up: boolean) => {
      if (!x.pct) return Number(x.text);
      const raw = (replicas * Number(x.text.replace('%', ''))) / 100;
      return up ? Math.ceil(raw) : Math.floor(raw);
    };
    // Нельзя оба нуля (Kubernetes отклонит спецификацию).
    if (val(surge, true) === 0 && val(unavail, false) === 0) unavail = { text: '1', pct: false };
    if (val(surge, true) === 0 && val(unavail, false) === 0) surge = { text: '1', pct: false };
    const s = val(surge, true);
    const u = val(unavail, false);
    const ask = rng.pick(['max', 'min'] as const);
    const answer = ask === 'max' ? replicas + s : replicas - u;
    return {
      prompt: `Деплоймент ${svc} обновляется стратегией RollingUpdate. ${ask === 'max' ? 'Какое наибольшее число подов (старых и новых вместе) может существовать во время обновления?' : 'Какое наименьшее число доступных подов гарантируется во время обновления?'}`,
      code: [`spec:`, `  replicas: ${replicas}`, `  strategy:`, `    type: RollingUpdate`, `    rollingUpdate:`, `      maxSurge: ${surge.text}`, `      maxUnavailable: ${unavail.text}`].join('\n'),
      answerHint: 'число подов',
      answerKey: String(answer),
      explanation: `Проценты считаются от replicas: maxSurge округляется вверх (${s}), maxUnavailable — вниз (${u}). ${ask === 'max' ? `Максимум ${replicas} + ${s} = ${answer}` : `Минимум доступных ${replicas} − ${u} = ${answer}`}.`,
      params: { replicas, surge: surge.text, unavail: unavail.text, ask },
    };
  },
};

// --- qa: граничные значения (Junior) -----------------------------------------------------------

export const boundaryValues: TaskGenerator = {
  id: 'eng.boundary-values',
  taskId: 'task:boundary-values',
  title: 'Граничные значения',
  specialization: 'engineering',
  subcategoryId: 'engineering.qa-automation',
  grade: 'junior',
  catalogIds: ['eng.test-design'],
  format: 'list',
  a: 1.1,
  b: -0.9,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const lo = rng.int(1, 30);
    const hi = lo + rng.int(10, 60);
    const loIncl = rng.int(0, 1) === 1;
    const hiIncl = rng.int(0, 1) === 1;
    const field = rng.pick(['возраст участника', 'количество товара в заказе', 'число гостей в брони', 'срок займа в днях']);
    const ok = (v: number) => (loIncl ? v >= lo : v > lo) && (hiIncl ? v <= hi : v < hi);
    const pool = [lo - 1, lo, lo + 1, hi - 1, hi, hi + 1, Math.floor((lo + hi) / 2)];
    const values = rng.shuffle([...new Set(pool)]).slice(0, 6);
    const rejected = values.flatMap((v, i) => (ok(v) ? [] : [i + 1]));
    const spec = `${field}: целое число ${loIncl ? 'не меньше' : 'больше'} ${lo} и ${hiIncl ? 'не больше' : 'меньше'} ${hi}`;
    return {
      prompt: `Требование: «${spec}». Тестировщик проверяет значения ниже. Какие из них валидатор, реализованный строго по требованию, должен отклонить? Перечислите номера.`,
      code: values.map((v, i) => `${i + 1}. ${v}`).join('\n'),
      answerHint: 'номера через запятую',
      answerKey: rejected.length ? listKey(rejected) : 'нет',
      explanation: `Допустимо ${loIncl ? '[' : '('}${lo}; ${hi}${hiIncl ? ']' : ')'}: отклоняются ${rejected.length ? rejected.map((i) => values[i - 1]).join(', ') : 'ни одно значение'}.`,
      params: { lo, hi, loIncl, hiIncl },
    };
  },
};

// --- qa: параметризация pytest (Junior) -----------------------------------------------------------

export const parametrizeCount: TaskGenerator = {
  id: 'eng.parametrize-count',
  taskId: 'task:parametrize-count',
  title: 'Сколько тестов выполнится',
  specialization: 'engineering',
  subcategoryId: 'engineering.qa-automation',
  grade: 'junior',
  catalogIds: ['eng.test-design'],
  format: 'number',
  a: 1.2,
  b: -0.3,
  paramSpace: 1e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const fn = rng.pick(['calc_price', 'validate_promo', 'convert_currency', 'split_bill']);
    const nA = rng.int(2, 4);
    const nB = rng.int(2, 3);
    const stacked = rng.int(0, 2) > 0;
    const skipInA = rng.int(0, 1) === 1;
    const aVals = Array.from({ length: nA }, (_, i) => (i + 1) * rng.int(2, 9));
    const bVals = rng.sample(['"RUB"', '"USD"', '"EUR"', '"KZT"'], nB);
    const skipIdx = rng.int(0, nA - 1);
    const aList = aVals.map((v, i) => (skipInA && i === skipIdx ? `pytest.param(${v}, marks=pytest.mark.skip)` : String(v)));
    const lines = ['import pytest', '', `@pytest.mark.parametrize("amount", [${aList.join(', ')}])`];
    if (stacked) lines.push(`@pytest.mark.parametrize("currency", [${bVals.join(', ')}])`);
    lines.push(`def test_${fn}(amount${stacked ? ', currency' : ''}):`, `    assert ${fn}(amount${stacked ? ', currency' : ''}) is not None`);
    const total = nA * (stacked ? nB : 1);
    const skipped = skipInA ? (stacked ? nB : 1) : 0;
    const answer = total - skipped;
    return {
      prompt: 'Сколько тестов pytest выполнит (без учёта пропущенных) при запуске этого файла?',
      code: lines.join('\n'),
      answerHint: 'число тестов',
      answerKey: String(answer),
      explanation: `${stacked ? `Два декоратора parametrize дают декартово произведение: ${nA} × ${nB} = ${total}` : `Один декоратор: ${total} наборов`}${skipped ? `; пропуск значения ${aVals[skipIdx]} убирает ${skipped}` : ''}. Выполнится ${answer}.`,
      params: { nA, nB, stacked, skipInA },
    };
  },
};

// --- qa: моки и число вызовов (Middle) ----------------------------------------------------------

export const mockCalls: TaskGenerator = {
  id: 'eng.mock-calls',
  taskId: 'task:mock-calls',
  title: 'Сколько раз вызван мок',
  specialization: 'engineering',
  subcategoryId: 'engineering.qa-automation',
  grade: 'middle',
  catalogIds: ['eng.test-isolation'],
  format: 'number',
  a: 1.3,
  b: 0.5,
  paramSpace: 1e4,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const attempts = rng.int(2, 4);
    // side_effect по вызовам: T — TimeoutError (ретраится), C — ConnectionError (не ловится), OK — ответ.
    const len = attempts + rng.int(0, 1);
    const effects: ('T' | 'C' | 'OK')[] = Array.from({ length: len }, () => rng.pick(['T', 'T', 'C', 'OK'] as const));
    let calls = 0;
    let outcome = 'исчерпаны попытки';
    for (let i = 0; i < attempts; i++) {
      calls++;
      const e = effects[i]!;
      if (e === 'OK') {
        outcome = 'успех';
        break;
      }
      if (e === 'C') {
        outcome = 'ConnectionError не перехвачен';
        break;
      }
    }
    const py = (e: string) => (e === 'T' ? 'TimeoutError()' : e === 'C' ? 'ConnectionError()' : '{"ok": True}');
    const code = [
      `def fetch(client, url, attempts=${attempts}):`,
      '    for _ in range(attempts):',
      '        try:',
      '            return client.get(url)',
      '        except TimeoutError:',
      '            continue',
      '    raise TimeoutError("all attempts failed")',
      '',
      '',
      'from unittest.mock import Mock',
      '',
      'def test_fetch():',
      '    client = Mock()',
      `    client.get.side_effect = [${effects.map(py).join(', ')}]`,
      '    try:',
      '        fetch(client, "/orders")',
      '    except Exception:',
      '        pass',
      '    print(client.get.call_count)',
    ].join('\n');
    return {
      prompt: 'unittest.mock: элементы side_effect по очереди возвращаются или, если это исключение, выбрасываются на каждом вызове. Что напечатает тест?',
      code,
      answerHint: 'число',
      answerKey: String(calls),
      explanation: `Вызов считается и тогда, когда мок выбрасывает исключение. TimeoutError ретраится, ConnectionError улетает сразу, ответ завершает цикл; итог — ${outcome}, вызовов ${calls}.`,
      params: { attempts, effects: effects.join(','), calls },
    };
  },
};

// --- qa: покрытие ветвей (Middle) --------------------------------------------------------------

export const branchCoverage: TaskGenerator = {
  id: 'eng.branch-coverage',
  taskId: 'task:branch-coverage',
  title: 'Непокрытые ветви',
  specialization: 'engineering',
  subcategoryId: 'engineering.qa-automation',
  grade: 'middle',
  catalogIds: ['eng.test-design'],
  format: 'number',
  a: 1.2,
  b: 0.6,
  paramSpace: 1e6,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const t1 = rng.int(10, 50) * 100;
    const t2 = rng.int(1, 5);
    const conds = [
      { code: `total >= ${t1}`, f: (x: { total: number; items: number; promo: boolean }) => x.total >= t1 },
      { code: `items > ${t2}`, f: (x: { total: number; items: number; promo: boolean }) => x.items > t2 },
      { code: 'promo', f: (x: { total: number; items: number; promo: boolean }) => x.promo },
    ];
    const nTests = rng.int(2, 4);
    const tests = Array.from({ length: nTests }, () => ({ total: rng.int(1, 80) * 100, items: rng.int(1, 8), promo: rng.int(0, 1) === 1 }));
    const covered = new Set<string>();
    for (const t of tests) conds.forEach((c, i) => covered.add(`${i}:${c.f(t)}`));
    const answer = 6 - covered.size;
    const code = [
      'def shipping(total, items, promo):',
      '    cost = 300',
      `    if ${conds[0]!.code}:`,
      '        cost = 0',
      `    if ${conds[1]!.code}:`,
      '        cost += 100',
      `    if ${conds[2]!.code}:`,
      '        cost -= 50',
      '    return cost',
      '',
      ...tests.map((t, i) => `def test_${i + 1}(): assert shipping(${t.total}, ${t.items}, ${t.promo ? 'True' : 'False'}) is not None`),
    ].join('\n');
    return {
      prompt: 'Покрытие по ветвям: у каждого if две ветви — условие истинно и ложно (всего 6). Сколько ветвей тесты ниже НЕ покрывают?',
      code,
      answerHint: 'число ветвей',
      answerKey: String(answer),
      explanation: `Покрыты ветви: ${[...covered].sort().join(', ')} (номер if : значение условия). Не покрыто ${answer}.`,
      params: { nTests, t1, t2 },
    };
  },
};

// --- sre: перцентили задержки (Junior) ---------------------------------------------------------

export const latencyPercentile: TaskGenerator = {
  id: 'eng.latency-percentile',
  taskId: 'task:latency-percentile',
  title: 'Перцентиль задержки',
  specialization: 'engineering',
  subcategoryId: 'engineering.sre',
  grade: 'junior',
  catalogIds: ['eng.observability'],
  format: 'number',
  a: 1.1,
  b: -0.6,
  paramSpace: 1e9,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = 20;
    const vals = Array.from({ length: n }, () => rng.int(8, 60) * 5);
    // Хвост: пара медленных запросов.
    vals[rng.int(0, n - 1)] = rng.int(80, 300) * 10;
    vals[rng.int(0, n - 1)] = rng.int(80, 300) * 10;
    const p = rng.pick([50, 90, 95]);
    const sorted = [...vals].sort((x, y) => x - y);
    const rank = Math.ceil((p / 100) * n);
    const answer = sorted[rank - 1]!;
    return {
      prompt: `Время ответа ${n} запросов, мс. Перцентиль считаем методом ближайшего ранга: p-й перцентиль — значение с номером ⌈p/100 · N⌉ в отсортированном по возрастанию списке. Чему равен p${p}?`,
      code: vals.join(', '),
      answerHint: 'миллисекунды',
      answerKey: String(answer),
      explanation: `Ранг ⌈${p}/100 · ${n}⌉ = ${rank}; ${rank}-е значение по возрастанию — ${answer} мс. Среднее здесь не подходит: его тянут вверх редкие медленные запросы.`,
      params: { p, rank },
    };
  },
};

// --- sre: подсчёт по логу (Junior) --------------------------------------------------------------

export const logCount: TaskGenerator = {
  id: 'eng.log-count',
  taskId: 'task:log-count',
  title: 'Ошибки по журналу доступа',
  specialization: 'engineering',
  subcategoryId: 'engineering.sre',
  grade: 'junior',
  catalogIds: ['eng.observability', 'eng.incident-postmortem'],
  format: 'number',
  a: 1.0,
  b: -1.2,
  paramSpace: 1e9,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const paths = ['/api/orders', '/api/cart', '/api/login', '/health'];
    const target = rng.pick(paths.slice(0, 3));
    const n = rng.int(10, 13);
    let t = 10 * 3600 + rng.int(0, 120);
    const lines: { t: number; method: string; path: string; status: number; ms: number }[] = [];
    for (let i = 0; i < n; i++) {
      t += rng.int(5, 50);
      const path = rng.int(0, 2) === 0 ? target : rng.pick(paths);
      const status = rng.pick([200, 200, 200, 201, 204, 400, 404, 499, 500, 502, 503, 504]);
      lines.push({ t, method: rng.pick(['GET', 'POST']), path, status, ms: rng.int(5, 900) });
    }
    const from = lines[rng.int(1, 3)]!.t;
    const to = lines[rng.int(n - 4, n - 2)]!.t;
    const ts = (x: number) => `${String(Math.floor(x / 3600)).padStart(2, '0')}:${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
    const answer = lines.filter((l) => l.path === target && l.status >= 500 && l.t >= from && l.t <= to).length;
    return {
      prompt: `Журнал доступа сервиса. Сколько ответов с ошибкой сервера (5xx) получил путь ${target} с ${ts(from)} по ${ts(to)} включительно?`,
      code: lines.map((l) => `${ts(l.t)} ${l.method.padEnd(4)} ${l.path.padEnd(12)} ${l.status} ${l.ms}ms`).join('\n'),
      answerHint: 'число',
      answerKey: String(answer),
      explanation: `Считаются только статусы 500–599 по ${target} в окне; 4xx (включая 499 — клиент закрыл соединение) — ошибки клиента. Итог: ${answer}.`,
      params: { target, n, answer },
    };
  },
};

// --- sre: скорость сгорания бюджета (Middle) --------------------------------------------------------

export const burnRate: TaskGenerator = {
  id: 'eng.burn-rate',
  taskId: 'task:burn-rate',
  title: 'Скорость сгорания бюджета ошибок',
  specialization: 'engineering',
  subcategoryId: 'engineering.sre',
  grade: 'middle',
  catalogIds: ['eng.alerting', 'eng.slo'],
  format: 'number',
  a: 1.3,
  b: 0.6,
  paramSpace: 1e8,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const svc = rng.pick(SERVICES);
    // 12 интервалов по 5 минут, по 1000 запросов; SLO 99,9 % → норма 1 ошибка на 1000.
    const errors = Array.from({ length: 12 }, () => rng.int(0, 3));
    const spikeAt = rng.int(4, 9);
    for (let i = spikeAt; i < 12; i++) errors[i] = rng.int(8, 40);
    const ask = rng.pick(['hour', 'first'] as const);
    let answer: number;
    let explanation: string;
    if (ask === 'hour') {
      // Подгоняем сумму к кратной 12, чтобы скорость была целой.
      const total = errors.reduce((a, b) => a + b, 0);
      errors[11]! += (12 - (total % 12)) % 12;
      const sum = errors.reduce((a, b) => a + b, 0);
      answer = sum / 12;
      explanation = `За час ${sum} ошибок на 12000 запросов = ${(sum / 120).toFixed(2)} %; бюджет 0,1 %, скорость сгорания ${sum} / 12 = ${answer}.`;
    } else {
      // Правило: 5-минутная скорость ≥ 14,4 и средняя скорость с начала таблицы (окно «час») ≥ 6.
      let first = 0;
      let cum = 0;
      for (let i = 0; i < 12; i++) {
        cum += errors[i]!;
        const short = errors[i]!; // ошибок на 1000 = скорость в долях бюджета 0,1 %
        const long = cum / (i + 1);
        if (short >= 14.4 && long >= 6 && first === 0) first = i + 1;
      }
      answer = first;
      explanation = first
        ? `Короткое окно (≥ 14,4) срабатывает раньше, но правило ждёт и длинное окно (≥ 6): оба выполнены впервые в интервале ${first}.`
        : 'Длинное окно так и не дошло до 6 — правило не сработало (0).';
    }
    return {
      prompt: `SLO доступности ${svc}: 99,9 %. В каждом 5-минутном интервале — 1000 запросов, в таблице — ошибки. Скорость сгорания = доля ошибок / 0,1 %. ${ask === 'hour' ? 'Чему равна скорость сгорания за весь час?' : 'Алерт: скорость в текущем интервале ≥ 14,4 И средняя скорость с начала часа по текущий интервал включительно ≥ 6. В каком по номеру интервале алерт сработает впервые? (0 — не сработает.)'}`,
      code: ['интервал | ошибок', ...errors.map((e, i) => `${String(i + 1).padStart(8)} | ${e}`)].join('\n'),
      answerHint: 'число',
      answerKey: String(answer),
      explanation,
      params: { ask, spikeAt, answer },
    };
  },
};

// --- sre: закон Литтла (Middle) ----------------------------------------------------------------

export const littlesLaw: TaskGenerator = {
  id: 'eng.littles-law',
  taskId: 'task:littles-law',
  title: 'Сколько обработчиков нужно',
  specialization: 'engineering',
  subcategoryId: 'engineering.sre',
  grade: 'middle',
  catalogIds: ['eng.capacity-planning'],
  format: 'number',
  a: 1.2,
  b: 0.4,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const svc = rng.pick(SERVICES);
    const lambda = rng.int(4, 40) * 10; // запросов в секунду
    const w = rng.pick([20, 40, 50, 80, 120, 150, 200, 250]); // мс на запрос, один запрос на обработчик
    const ask = rng.pick(['workers', 'backlog'] as const);
    const need = Math.ceil((lambda * w) / 1000);
    if (ask === 'workers') {
      return {
        prompt: `Очередь сервиса ${svc}: приходит ${lambda} задач в секунду, обработчик держит одну задачу ${w} мс и берёт следующую. Сколько обработчиков минимум нужно, чтобы очередь не росла бесконечно (пропускная способность ≥ потоку)?`,
        answerHint: 'число обработчиков',
        answerKey: String(need),
        explanation: `По закону Литтла в работе одновременно λ·W = ${lambda} · ${w / 1000} = ${((lambda * w) / 1000).toFixed(2)} задач; округление вверх — ${need}.`,
        params: { lambda, w, ask },
      };
    }
    const workers = Math.max(1, need - rng.int(1, 3));
    const minutes = rng.int(1, 10);
    const capacity = (workers * 1000) / w;
    const backlog = Math.round((lambda - capacity) * minutes * 60);
    return {
      prompt: `Очередь сервиса ${svc}: приходит ${lambda} задач в секунду, обработчик держит одну задачу ${w} мс, обработчиков ${workers}. Очередь была пуста. На сколько задач она вырастет за ${minutes} мин?`,
      answerHint: 'число задач',
      answerKey: String(backlog),
      explanation: `Пропускная способность ${workers} · 1000 / ${w} = ${capacity.toFixed(2)} задач/с, приток ${lambda}; рост (${lambda} − ${capacity.toFixed(2)}) · ${minutes * 60} с ≈ ${backlog}.`,
      params: { lambda, w, workers, minutes, ask },
    };
  },
};

// --- sre: автоматический выключатель (Middle) --------------------------------------------------------

export const circuitBreaker: TaskGenerator = {
  id: 'eng.circuit-breaker',
  taskId: 'task:circuit-breaker',
  title: 'Circuit breaker',
  specialization: 'engineering',
  subcategoryId: 'engineering.sre',
  grade: 'middle',
  catalogIds: ['eng.retries-resilience'],
  format: 'number',
  a: 1.3,
  b: 0.7,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const svc = rng.pick(SERVICES);
    const threshold = rng.int(2, 4);
    const openSec = rng.pick([5, 10, 15]);
    const T = rng.int(25, 40);
    const downFrom = rng.int(2, 8);
    const downTo = downFrom + rng.int(6, 20);
    // Клиент вызывает раз в секунду, t = 0..T−1. Зависимость отвечает ошибкой при downFrom ≤ t < downTo.
    let state: 'closed' | 'open' = 'closed';
    let fails = 0;
    let openedAt = 0;
    let reached = 0;
    let rejected = 0;
    for (let t = 0; t < T; t++) {
      const down = t >= downFrom && t < downTo;
      if (state === 'open') {
        if (t < openedAt + openSec) {
          rejected++;
          continue;
        }
        // half-open: пробный вызов
        reached++;
        if (down) openedAt = t;
        else {
          state = 'closed';
          fails = 0;
        }
        continue;
      }
      reached++;
      if (down) {
        fails++;
        if (fails >= threshold) {
          state = 'open';
          openedAt = t;
        }
      } else fails = 0;
    }
    const ask = rng.pick(['reached', 'rejected'] as const);
    const answer = ask === 'reached' ? reached : rejected;
    return {
      prompt: `Клиент вызывает ${svc} раз в секунду, t = 0, 1, …, ${T - 1}. Зависимость отвечает ошибкой при ${downFrom} ≤ t < ${downTo}, иначе успешно. ${ask === 'reached' ? 'Сколько вызовов дойдёт до зависимости?' : 'Сколько вызовов выключатель отклонит, не обращаясь к зависимости?'}`,
      code: [
        `circuit breaker:`,
        `  closed: после ${threshold} ошибок подряд — open (успех обнуляет счётчик)`,
        `  open: ${openSec} с отклоняет все вызовы сразу (с момента открытия t₀ до t₀ + ${openSec} не включительно)`,
        '  затем half-open: следующий вызов пробный — успех → closed, ошибка → снова open на тот же срок',
      ].join('\n'),
      answerHint: 'число вызовов',
      answerKey: String(answer),
      explanation: `Пошагово: до зависимости дошло ${reached}, отклонено ${rejected} из ${T}. Пока выключатель открыт, упавшую зависимость не добивают запросами.`,
      params: { threshold, openSec, T, downFrom, downTo, ask },
    };
  },
};

export const ENGINEERING_GENERATORS: TaskGenerator[] = [
  // data-eng: 4 Junior + 4 Middle
  dedupCount,
  schemaTypes,
  nullAggregates,
  joinFanout,
  idempotentLoad,
  incrementalWatermark,
  partitionPrune,
  scd2AsOf,
  // devops
  dockerCache,
  secretsLeak,
  portMapping,
  ciStages,
  k8sProbes,
  k8sCapacity,
  deployRollback,
  rollingUpdate,
  // qa-automation
  testPyramid,
  fixtureIsolation,
  boundaryValues,
  parametrizeCount,
  flakyLine,
  contractTest,
  mockCalls,
  branchCoverage,
  // sre
  errorBudget,
  symptomAlert,
  latencyPercentile,
  logCount,
  retryAmplification,
  burnRate,
  littlesLaw,
  circuitBreaker,
];
