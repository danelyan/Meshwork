// Генераторы заданий Backend (E-03, ADR-0002). Ключ ответа считает код генератора,
// не LLM (R-T-02). Несущественные параметры (имена, числа, порядок) — от seed; параметры,
// задающие сложность, — зафиксированы в семействе. a, b — ПРЕДЛОЖЕНИЕ (экспертные).
import { createRng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';

const NAMES = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дарья', 'Егор', 'Жанна', 'Захар', 'Инна', 'Кирилл', 'Лев', 'Мария'];
const CITIES = ['Казань', 'Самара', 'Тверь', 'Омск', 'Пермь'];
const ENTITIES = [
  { one: 'order', many: 'orders', ru: 'заказ' },
  { one: 'payment', many: 'payments', ru: 'платёж' },
  { one: 'booking', many: 'bookings', ru: 'бронь' },
  { one: 'ticket', many: 'tickets', ru: 'заявка' },
];

function table(name: string, cols: string[], rows: (string | number)[][]): string {
  const w = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells: (string | number)[]) => cells.map((c, i) => String(c).padEnd(w[i]!)).join(' | ');
  return [`${name}`, line(cols), w.map((x) => '-'.repeat(x)).join('-+-'), ...rows.map(line)].join('\n');
}

// ---------------------------------------------------------------------------
// Junior
// ---------------------------------------------------------------------------

export const sqlRowcount: TaskGenerator = {
  id: 'be.sql-rowcount',
  taskId: 'task:sql-rowcount',
  title: 'Сколько строк вернёт запрос',
  specialization: 'backend',
  subcategoryId: 'backend.data-model',
  grade: 'junior',
  catalogIds: ['common.sql-queries'],
  format: 'number',
  a: 1.2,
  b: -1.3,
  paramSpace: 5e8,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ent = rng.pick(ENTITIES);
    const nUsers = rng.int(4, 6);
    const users = rng.sample(NAMES, nUsers).map((name, i) => ({ id: i + 1, name, city: rng.pick(CITIES) }));
    const nOrders = rng.int(5, 8);
    // Часть пользователей без записей — чтобы LEFT JOIN и NULL были содержательны.
    const withOrders = rng.sample(users, Math.max(2, nUsers - rng.int(1, 2)));
    const orders = Array.from({ length: nOrders }, (_, i) => ({
      id: 100 + i,
      user_id: rng.pick(withOrders).id,
      amount: rng.int(1, 12) * 100,
    }));
    const threshold = rng.int(3, 9) * 100;
    const kind = rng.int(0, 3);
    let sql: string;
    let count: number;
    let explanation: string;
    if (kind === 0) {
      sql = `SELECT COUNT(*) AS n FROM ${ent.many} WHERE amount > ${threshold};`;
      count = 1;
      explanation = 'COUNT(*) без GROUP BY всегда возвращает ровно одну строку, даже если подходящих записей нет.';
    } else if (kind === 1) {
      sql = `SELECT u.name, o.amount\nFROM users u JOIN ${ent.many} o ON o.user_id = u.id\nWHERE o.amount >= ${threshold};`;
      count = orders.filter((o) => o.amount >= threshold).length;
      explanation = `JOIN даёт строку на каждую запись ${ent.many} с подходящей суммой; пользователь повторяется столько раз, сколько у него записей.`;
    } else if (kind === 2) {
      sql = `SELECT u.name\nFROM users u LEFT JOIN ${ent.many} o ON o.user_id = u.id\nWHERE o.id IS NULL;`;
      const has = new Set(orders.map((o) => o.user_id));
      count = users.filter((u) => !has.has(u.id)).length;
      explanation = 'LEFT JOIN сохраняет пользователей без записей, а условие IS NULL оставляет только их.';
    } else {
      sql = `SELECT user_id, COUNT(*)\nFROM ${ent.many}\nGROUP BY user_id\nHAVING COUNT(*) >= 2;`;
      const c = new Map<number, number>();
      for (const o of orders) c.set(o.user_id, (c.get(o.user_id) ?? 0) + 1);
      count = [...c.values()].filter((n) => n >= 2).length;
      explanation = 'GROUP BY даёт по строке на пользователя с записями; HAVING оставляет группы, где записей две и больше.';
    }
    const code = [
      table('users', ['id', 'name', 'city'], users.map((u) => [u.id, u.name, u.city])),
      '',
      table(ent.many, ['id', 'user_id', 'amount'], orders.map((o) => [o.id, o.user_id, o.amount])),
      '',
      sql,
    ].join('\n');
    return {
      prompt: 'Даны две таблицы и запрос. Сколько строк вернёт запрос?',
      code,
      answerHint: 'число строк',
      answerKey: String(count),
      explanation,
      params: { kind, nUsers, nOrders, threshold },
    };
  },
};

const HTTP_CASES: { text: string; key: string; why: string }[] = [
  { text: 'GET существующего {ent}а - ответ с телом', key: '200', why: '200 OK: ресурс найден и возвращён.' },
  { text: 'POST создал новый {ent} и вернул его представление', key: '201', why: '201 Created: ресурс создан, в ответе Location/представление.' },
  { text: 'DELETE удалил {ent}, тело ответа пустое', key: '204', why: '204 No Content: успех без тела.' },
  { text: 'GET {ent}а с несуществующим id', key: '404', why: '404 Not Found: такого ресурса нет.' },
  { text: 'запрос без токена к защищённому {ent}у', key: '401', why: '401 Unauthorized: клиент не аутентифицирован.' },
  { text: 'токен верный, но {ent} чужой и прав на него нет', key: '403', why: '403 Forbidden: аутентифицирован, но доступ запрещён.' },
  { text: 'тело POST не проходит валидацию (нет обязательного поля)', key: '400|422', why: '400 Bad Request (или 422 Unprocessable Content) - ошибка в запросе клиента.' },
  { text: 'PUT с устаревшей версией (If-Match не совпал)', key: '412|409', why: '412 Precondition Failed при If-Match; 409 Conflict тоже встречается для конфликта версий.' },
  { text: 'PATCH к коллекции, которая поддерживает только GET и POST', key: '405', why: '405 Method Not Allowed: метод не поддерживается ресурсом.' },
  { text: 'клиент превысил лимит запросов в минуту', key: '429', why: '429 Too Many Requests.' },
  { text: 'GET с If-None-Match, ETag совпал, {ent} не менялся', key: '304', why: '304 Not Modified: кэш клиента актуален.' },
  { text: 'сервер временно недоступен на время деплоя, просит повторить позже', key: '503', why: '503 Service Unavailable (+ Retry-After).' },
];

export const httpSemantics: TaskGenerator = {
  id: 'be.http-semantics',
  taskId: 'task:http-semantics',
  title: 'Верный код ответа',
  specialization: 'backend',
  subcategoryId: 'backend.web-api',
  grade: 'junior',
  catalogIds: ['be.rest-design', 'common.http'],
  format: 'number',
  a: 1.0,
  b: -1.5,
  paramSpace: 48,
  timeLimitSec: 90,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ent = rng.pick(ENTITIES);
    const c = rng.pick(HTTP_CASES);
    const text = c.text.replace(/\{ent\}/g, ent.one);
    return {
      prompt: `REST API сервиса «${ent.many}». Ситуация: ${text}. Какой HTTP-статус должен вернуть сервер?`,
      answerHint: 'трёхзначный код',
      answerKey: c.key,
      explanation: c.why,
      params: { case: c.key, entity: ent.one },
    };
  },
};

export const findBugIdor: TaskGenerator = {
  id: 'be.find-bug-idor',
  taskId: 'task:find-bug-idor',
  title: 'Найди IDOR',
  specialization: 'backend',
  subcategoryId: 'backend.web-api',
  grade: 'junior',
  catalogIds: ['be.authz', 'be.authn-impl', 'common.security-basics'],
  format: 'line',
  a: 1.3,
  b: -0.6,
  paramSpace: 3e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ent = rng.pick(ENTITIES);
    const ops = rng.shuffle(['get', 'cancel', 'rename'] as const);
    const bugOp = rng.pick(ops);
    const lines: string[] = ['const router = Router();', ''];
    let bugLine = 0;
    for (const op of ops) {
      const method = op === 'get' ? 'get' : 'post';
      const path = op === 'get' ? `/${ent.many}/:id` : `/${ent.many}/:id/${op}`;
      lines.push(`router.${method}('${path}', requireAuth, async (req, res) => {`);
      const where = op === bugOp ? `{ id: req.params.id }` : `{ id: req.params.id, ownerId: req.user.id }`;
      lines.push(`  const ${ent.one} = await db.${ent.many}.findFirst({ where: ${where} });`);
      if (op === bugOp) bugLine = lines.length;
      lines.push(`  if (!${ent.one}) return res.status(404).end();`);
      if (op === 'get') lines.push(`  res.json(${ent.one});`);
      if (op === 'cancel') lines.push(`  await db.${ent.many}.update({ where: { id: ${ent.one}.id }, data: { status: 'cancelled' } });`, `  res.status(204).end();`);
      if (op === 'rename') lines.push(`  await db.${ent.many}.update({ where: { id: ${ent.one}.id }, data: { title: req.body.title } });`, `  res.json({ ok: true });`);
      lines.push('});', '');
    }
    lines.pop();
    return {
      prompt: `Три обработчика API. requireAuth кладёт пользователя в req.user. В одном из обработчиков любой вошедший пользователь может работать с чужим объектом «${ent.ru}» (IDOR). Укажите номер строки, где запрос к базе не ограничен владельцем.`,
      code: lines.join('\n'),
      answerHint: 'номер строки',
      answerKey: String(bugLine),
      explanation: `В строке ${bugLine} поиск идёт только по id из URL без ownerId: вошедший пользователь подставит чужой id. В остальных обработчиках условие включает ownerId: req.user.id.`,
      params: { entity: ent.one, bugOp, order: ops.join(',') },
    };
  },
};

export const nPlusOne: TaskGenerator = {
  id: 'be.n-plus-one',
  taskId: 'task:n-plus-one',
  title: 'Сколько запросов выполнит код',
  specialization: 'backend',
  subcategoryId: 'backend.highload',
  grade: 'junior',
  catalogIds: ['be.orm', 'common.sql-queries'],
  format: 'number',
  a: 1.1,
  b: -0.7,
  paramSpace: 2e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ent = rng.pick(ENTITIES);
    const n = rng.int(3, 12);
    const itemsPer = rng.int(1, 4);
    const nested = rng.int(0, 1) === 1;
    const lines = [
      `const ${ent.many} = await db.${ent.many}.findMany({ where: { userId } }); // вернул ${n} записей`,
      `for (const ${ent.one} of ${ent.many}) {`,
      `  const items = await db.items.findMany({ where: { ${ent.one}Id: ${ent.one}.id } }); // по ${itemsPer} позиции в каждой записи`,
    ];
    let total = 1 + n;
    if (nested) {
      lines.push(`  for (const item of items) {`, `    item.product = await db.products.findUnique({ where: { id: item.productId } });`, `  }`);
      total += n * itemsPer;
    }
    lines.push(`  ${ent.one}.items = items;`, '}');
    return {
      prompt: 'ORM выполняет каждый вызов findMany/findUnique отдельным SQL-запросом. Сколько всего SQL-запросов выполнит этот код?',
      code: lines.join('\n'),
      answerHint: 'число запросов',
      answerKey: String(total),
      explanation: nested
        ? `1 запрос за списком + ${n} за позициями + ${n}·${itemsPer} = ${n * itemsPer} за товарами: всего ${total}. Это N+1 (и ещё раз N+1 внутри); лечится include/JOIN или одним запросом по списку id.`
        : `1 запрос за списком + по одному на каждую из ${n} записей: ${total}. Классический N+1; лечится include/JOIN или одним запросом по списку id.`,
      params: { n, itemsPer, nested, entity: ent.one },
    };
  },
};

export const shellOutput: TaskGenerator = {
  id: 'be.shell-output',
  taskId: 'task:shell-output',
  title: 'Что выведет конвейер',
  specialization: 'backend',
  subcategoryId: 'backend.highload',
  grade: 'junior',
  catalogIds: ['be.linux-shell', 'common.debugging'],
  format: 'number',
  a: 1.0,
  b: -0.5,
  paramSpace: 1e7,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const levels = ['INFO', 'WARN', 'ERROR'];
    const services = ['api', 'worker', 'auth'];
    const n = rng.int(7, 10);
    const rows = Array.from({ length: n }, () => `${rng.pick(levels)} ${rng.pick(services)} ${rng.int(100, 999)}ms`);
    const kind = rng.int(0, 2);
    const lvl = rng.pick(levels);
    const svc = rng.pick(services);
    let cmd: string;
    let answer: number;
    let why: string;
    if (kind === 0) {
      cmd = `grep -c ${lvl} app.log`;
      answer = rows.filter((r) => r.includes(lvl)).length;
      why = `grep -c печатает число строк, где встречается «${lvl}».`;
    } else if (kind === 1) {
      cmd = `grep ${lvl} app.log | grep -v ${svc} | wc -l`;
      answer = rows.filter((r) => r.includes(lvl) && !r.includes(` ${svc} `)).length;
      why = `Первый grep оставляет строки с «${lvl}», grep -v убирает строки с «${svc}», wc -l считает оставшиеся.`;
    } else {
      cmd = `awk '{print $1}' app.log | sort | uniq | wc -l`;
      answer = new Set(rows.map((r) => r.split(' ')[0])).size;
      why = 'awk берёт первое поле (уровень), sort | uniq оставляет уникальные значения, wc -l их считает.';
    }
    return {
      prompt: 'Файл app.log содержит строки ниже (по одной записи на строку). Какое число выведет команда?',
      code: `${rows.join('\n')}\n\n$ ${cmd}`,
      answerHint: 'число',
      answerKey: String(answer),
      explanation: why,
      params: { kind, n, lvl, svc },
    };
  },
};

export const schemaConstraint: TaskGenerator = {
  id: 'be.schema-constraint',
  taskId: 'task:schema-constraint',
  title: 'Какие INSERT не пройдут',
  specialization: 'backend',
  subcategoryId: 'backend.data-model',
  grade: 'junior',
  catalogIds: ['be.sql-schema', 'be.api-validation'],
  format: 'list',
  a: 1.2,
  b: -0.4,
  paramSpace: 1e6,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const minAge = rng.pick([16, 18, 21]);
    const names = rng.sample(NAMES, 4);
    const emails = names.map((n, i) => `u${i + 1}@example.com`);
    // `bad` - ошибка независимо от остальных строк; `email` - значение UNIQUE-колонки.
    type Ins = { sql: string; bad: boolean; email: string; why: string };
    const dup = rng.int(0, 1);
    const candidates: Ins[] = [
      { sql: `INSERT INTO users (email, name, age) VALUES ('${emails[0]}', '${names[0]}', ${minAge + rng.int(0, 10)});`, bad: false, email: emails[0]!, why: 'все ограничения соблюдены' },
      { sql: `INSERT INTO users (email, name, age) VALUES ('${emails[dup]}', '${names[1]}', ${minAge + 2});`, bad: false, email: emails[dup]!, why: 'все ограничения соблюдены' },
      { sql: `INSERT INTO users (email, age) VALUES ('${emails[2]}', ${minAge + 1});`, bad: true, email: emails[2]!, why: 'name NOT NULL без DEFAULT' },
      { sql: `INSERT INTO users (email, name, age) VALUES ('${emails[3]}', '${names[3]}', ${minAge - rng.int(1, 3)});`, bad: true, email: emails[3]!, why: `CHECK (age >= ${minAge}) нарушен` },
      { sql: `INSERT INTO users (email, name) VALUES ('${emails[1]}x', '${names[2]}');`, bad: false, email: `${emails[1]}x`, why: 'age может быть NULL: CHECK с NULL не считается нарушением' },
    ];
    const order = rng.shuffle(candidates);
    // Выполнение сверху вниз: упавший INSERT email не занимает, повтор падает у того, что идёт позже.
    const taken = new Set<string>();
    const outcome = order.map((c) => {
      if (c.bad) return { fails: true, why: c.why };
      if (taken.has(c.email)) return { fails: true, why: 'email уже вставлен выше: нарушен UNIQUE' };
      taken.add(c.email);
      return { fails: false, why: c.why };
    });
    const code = [
      'CREATE TABLE users (',
      '  id    serial PRIMARY KEY,',
      '  email text NOT NULL UNIQUE,',
      '  name  text NOT NULL,',
      `  age   int CHECK (age >= ${minAge})`,
      ');',
      '',
      ...order.map((c, i) => `-- ${i + 1}\n${c.sql}`),
    ].join('\n');
    const failing = outcome.map((o, i) => (o.fails ? i + 1 : 0)).filter(Boolean);
    return {
      prompt: 'PostgreSQL, таблица пустая, выражения выполняются по порядку, каждое в своей транзакции. Перечислите номера INSERT, которые завершатся ошибкой.',
      code,
      answerHint: 'номера через запятую',
      answerKey: failing.join(','),
      explanation: outcome.map((o, i) => `${i + 1}: ${o.why}`).join('; ') + '.',
      params: { minAge, dup },
    };
  },
};

// ---------------------------------------------------------------------------
// Middle
// ---------------------------------------------------------------------------

export const paymentRetry: TaskGenerator = {
  id: 'be.payment-retry',
  taskId: 'task:payment-retry',
  title: 'Один платёж, два запроса',
  specialization: 'backend',
  subcategoryId: 'backend.integrations',
  grade: 'middle',
  catalogIds: ['be.idempotency', 'be.retries-timeouts'],
  format: 'number',
  a: 1.4,
  b: 0.5,
  paramSpace: 2e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const idempotent = rng.int(0, 1) === 1;
    const n = rng.int(4, 6);
    type Ev = { key: string; outcome: 'ok' | 'lost_response' | 'not_sent' };
    const events: Ev[] = [];
    let keyNo = 0;
    let prevKey = '';
    for (let i = 0; i < n; i++) {
      const retry = i > 0 && rng.next() < 0.5;
      const key = retry ? prevKey : `K${++keyNo}`;
      prevKey = key;
      const outcome = rng.pick(['ok', 'lost_response', 'not_sent', 'lost_response'] as const);
      events.push({ key, outcome });
    }
    const reached = events.filter((e) => e.outcome !== 'not_sent');
    const charges = idempotent ? new Set(reached.map((e) => e.key)).size : reached.length;
    const describe = (e: Ev, i: number) =>
      `${i + 1}. POST /charges, Idempotency-Key: ${e.key} - ${
        e.outcome === 'ok' ? 'ответ 201 получен' : e.outcome === 'lost_response' ? 'сервер обработал, но ответ потерян (таймаут у клиента)' : 'соединение не установилось, запрос до сервера не дошёл'
      }`;
    return {
      prompt: `Клиент списывает ${rng.int(5, 90) * 100} ₽ и повторяет запрос по таймауту. Сервер ${
        idempotent ? 'хранит ключ идемпотентности и на повтор с тем же ключом возвращает первый результат' : 'НЕ проверяет ключ идемпотентности (заголовок игнорирует)'
      }. Сколько списаний окажется на счёте после всех запросов?`,
      code: events.map(describe).join('\n'),
      answerHint: 'число списаний',
      answerKey: String(charges),
      explanation: idempotent
        ? `До сервера дошло ${reached.length} запросов с ${charges} разными ключами; повторы с тем же ключом сервер отдал из сохранённого результата. Запросы, не дошедшие до сервера, ничего не списывают.`
        : `Сервер игнорирует ключ, поэтому каждый дошедший запрос - отдельное списание: ${reached.length}. Потерянный ответ не отменяет обработку; не дошедший запрос не списывает.`,
      params: { idempotent, n, outcomes: events.map((e) => `${e.key}:${e.outcome}`).join(',') },
    };
  },
};

export const isolationAnomaly: TaskGenerator = {
  id: 'be.isolation-anomaly',
  taskId: 'task:isolation-anomaly',
  title: 'Что прочитает транзакция',
  specialization: 'backend',
  subcategoryId: 'backend.data-model',
  grade: 'middle',
  catalogIds: ['be.transactions', 'be.concurrency'],
  format: 'number',
  a: 1.3,
  b: 0.8,
  paramSpace: 5e4,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const level = rng.pick(['READ COMMITTED', 'REPEATABLE READ'] as const);
    const start = rng.int(10, 90) * 10;
    const delta = rng.int(1, 9) * 10;
    const commitBeforeSecondRead = rng.int(0, 1) === 1;
    const after = start - delta;
    const t2 = [
      `T2: BEGIN;`,
      `T2: UPDATE accounts SET balance = balance - ${delta} WHERE id = 7;`,
      commitBeforeSecondRead ? 'T2: COMMIT;' : '',
    ].filter(Boolean);
    const schedule = [
      `T1: BEGIN ISOLATION LEVEL ${level};`,
      `T1: SELECT balance FROM accounts WHERE id = 7;   -- видит ${start}`,
      ...t2,
      `T1: SELECT balance FROM accounts WHERE id = 7;   -- ?`,
      ...(commitBeforeSecondRead ? [] : ['T2: COMMIT;']),
      'T1: COMMIT;',
    ];
    const value = level === 'READ COMMITTED' && commitBeforeSecondRead ? after : start;
    const why =
      level === 'READ COMMITTED'
        ? commitBeforeSecondRead
          ? `READ COMMITTED: каждый SELECT видит всё, что закоммичено к его началу; T2 уже закоммитила, второй SELECT видит ${after}.`
          : `READ COMMITTED не читает незакоммиченных изменений (в PostgreSQL грязного чтения нет): T2 ещё не закоммитила, T1 видит ${start}.`
        : `REPEATABLE READ: T1 работает со снимком на момент первого запроса в транзакции и видит ${start} вне зависимости от коммита T2.`;
    return {
      prompt: `PostgreSQL. Две транзакции выполняются построчно сверху вниз. Начальный balance = ${start}. Какое значение вернёт второй SELECT в T1?`,
      code: schedule.join('\n'),
      answerHint: 'число',
      answerKey: String(value),
      explanation: why,
      params: { level, start, delta, commitBeforeSecondRead },
    };
  },
};

export const cacheConsistency: TaskGenerator = {
  id: 'be.cache-consistency',
  taskId: 'task:cache-consistency',
  title: 'Устаревший кэш',
  specialization: 'backend',
  subcategoryId: 'backend.highload',
  grade: 'middle',
  catalogIds: ['be.cache', 'be.concurrency'],
  format: 'number',
  a: 1.3,
  b: 0.6,
  paramSpace: 3e6,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ttl = rng.pick([30, 60, 120]);
    const invalidate = rng.int(0, 3) === 0;
    const start = rng.int(10, 50) * 10;
    // Нужно рассуждение: без инвалидации хотим «протухший» ответ (≠ последняя цена в БД) в большинстве экземпляров.
    const wantStale = !invalidate && rng.int(0, 3) > 0;
    let db = start;
    let lastRead = start;
    let steps: string[] = [];
    let nSteps = 5;
    for (let attempt = 0; attempt < 300; attempt++) {
      db = start;
      let cache: { v: number; exp: number } | null = null;
      steps = [];
      let t = 0;
      nSteps = rng.int(5, 7);
      let reads = 0;
      let writes = 0;
      let readBeforeWrite = false;
      for (let i = 0; i < nSteps; i++) {
        t += rng.pick([5, 10, 20, 45, 70]);
        const op = i === nSteps - 1 ? 'read' : i === 0 ? 'read' : rng.pick(['read', 'write', 'read'] as const);
        if (op === 'write') {
          writes++;
          db = db + rng.int(1, 9) * 10;
          steps.push(`t=${t}с: сервис обновляет цену в БД → ${db}${invalidate ? ' и удаляет ключ из кэша' : ''}`);
          if (invalidate) cache = null;
        } else {
          if (writes === 0) readBeforeWrite = true;
          reads++;
          if (cache && cache.exp > t) lastRead = cache.v;
          else {
            lastRead = db;
            cache = { v: db, exp: t + ttl };
          }
          steps.push(`t=${t}с: клиент читает цену${i === nSteps - 1 ? ' → ?' : ''}`);
        }
      }
      if (writes >= 1 && reads >= 2 && readBeforeWrite && (!wantStale || lastRead !== db)) break;
    }
    steps.unshift(`t=0с: в БД цена = ${start}, кэш пуст`);
    return {
      prompt: `Cache-aside: чтение сначала смотрит в кэш; при промахе берёт из БД и кладёт в кэш с TTL ${ttl} с. Запись ${
        invalidate ? 'обновляет БД и удаляет ключ из кэша' : 'обновляет только БД, кэш не трогает'
      }. В t=0 цена в БД = ${start}, кэш пуст. Какое значение получит клиент при последнем чтении?`,
      code: steps.join('\n'),
      answerHint: 'число',
      answerKey: String(lastRead),
      explanation: invalidate
        ? 'После удаления ключа следующее чтение идёт в БД и кладёт свежее значение; иначе значение живёт до истечения TTL с момента записи в кэш.'
        : 'Без инвалидации клиент читает из кэша старое значение, пока не истечёт TTL с момента, когда значение попало в кэш; новая цена видна только после промаха.',
      params: { ttl, invalidate, nSteps, start },
    };
  },
};

export const deliverySemantics: TaskGenerator = {
  id: 'be.delivery-semantics',
  taskId: 'task:delivery-semantics',
  title: 'Сообщение пришло дважды',
  specialization: 'backend',
  subcategoryId: 'backend.integrations',
  grade: 'middle',
  catalogIds: ['be.message-queue', 'be.idempotency'],
  format: 'number',
  a: 1.3,
  b: 0.4,
  paramSpace: 2e4,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = rng.int(3, 5);
    const crashAt = rng.int(1, n);
    const crashWhen = rng.pick(['after_handle_before_ack', 'before_handle', 'after_ack'] as const);
    const target = rng.int(1, n);
    const ids = Array.from({ length: n }, (_, i) => `M${i + 1}`);
    const log: string[] = [];
    const handled = new Map<string, number>();
    const bump = (id: string) => handled.set(id, (handled.get(id) ?? 0) + 1);
    for (let i = 0; i < n; i++) {
      const id = ids[i]!;
      if (i + 1 === crashAt) {
        if (crashWhen === 'before_handle') {
          log.push(`получил ${id} → процесс упал до обработки`);
        } else if (crashWhen === 'after_handle_before_ack') {
          bump(id);
          log.push(`получил ${id} → обработал (запись в БД) → процесс упал до ack`);
        } else {
          bump(id);
          log.push(`получил ${id} → обработал → ack → процесс упал`);
        }
        log.push('консьюмер перезапущен; брокер заново доставляет все сообщения без ack');
        for (let j = i; j < n; j++) {
          const jd = ids[j]!;
          if (j === i && crashWhen === 'after_ack') continue;
          bump(jd);
          log.push(`получил ${jd} → обработал → ack`);
        }
        break;
      }
      bump(id);
      log.push(`получил ${id} → обработал → ack`);
    }
    return {
      prompt: `Очередь с семантикой at-least-once: сообщение удаляется только после ack, prefetch = 1. Обработчик не идемпотентен. Сколько раз запись для сообщения ${ids[target - 1]} окажется в БД?`,
      code: log.map((l, i) => `${i + 1}. ${l}`).join('\n'),
      answerHint: 'число',
      answerKey: String(handled.get(ids[target - 1]!) ?? 0),
      explanation:
        crashWhen === 'after_handle_before_ack'
          ? 'Обработка прошла, ack не дошёл - брокер доставляет сообщение повторно, и неидемпотентный обработчик пишет его второй раз. Защита: ключ идемпотентности или дедупликация по id сообщения.'
          : crashWhen === 'before_handle'
            ? 'Падение до обработки - сообщение просто доставлено заново, записей одна.'
            : 'После ack брокер сообщение уже не повторяет; повторно приходят только неподтверждённые.',
      params: { n, crashAt, crashWhen, target },
    };
  },
};

export const indexChoice: TaskGenerator = {
  id: 'be.index-choice',
  taskId: 'task:index-choice',
  title: 'Какие запросы используют индекс',
  specialization: 'backend',
  subcategoryId: 'backend.highload',
  grade: 'middle',
  catalogIds: ['be.sql-indexes', 'be.sql-schema'],
  format: 'list',
  a: 1.2,
  b: 0.7,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const cols = rng.shuffle(['tenant_id', 'status', 'created_at']);
    const [c1, c2, c3] = cols as [string, string, string];
    const vals = { tenant_id: String(rng.int(1, 99)), status: `'${rng.pick(['paid', 'new', 'shipped'])}'`, created_at: `'2026-0${rng.int(1, 9)}-01'` } as Record<string, string>;
    const ent = rng.pick(ENTITIES);
    type Q = { sql: string; uses: boolean; why: string };
    const pool: Q[] = [
      { sql: `WHERE ${c1} = ${vals[c1]}`, uses: true, why: 'первый столбец индекса' },
      { sql: `WHERE ${c1} = ${vals[c1]} AND ${c2} = ${vals[c2]}`, uses: true, why: 'префикс (1, 2)' },
      { sql: `WHERE ${c2} = ${vals[c2]}`, uses: false, why: 'нет первого столбца индекса' },
      { sql: `WHERE ${c2} = ${vals[c2]} AND ${c3} = ${vals[c3]}`, uses: false, why: 'нет первого столбца' },
      { sql: `WHERE ${c1} = ${vals[c1]} AND ${c3} = ${vals[c3]}`, uses: true, why: 'по первому столбцу, третий фильтруется в индексе/после' },
      { sql: `WHERE upper(${c1}::text) = '${vals[c1]!.replace(/'/g, '')}'`, uses: false, why: 'функция над столбцом - обычный индекс не применим' },
      { sql: `WHERE ${c3} = ${vals[c3]}`, uses: false, why: 'только третий столбец' },
      { sql: `WHERE ${c3} = ${vals[c3]} AND ${c1} = ${vals[c1]}`, uses: true, why: 'порядок условий в WHERE не важен: есть первый столбец' },
    ];
    const qs = rng.sample(pool, 5);
    const code = [`CREATE INDEX ${ent.many}_idx ON ${ent.many} (${c1}, ${c2}, ${c3});`, '', ...qs.map((q, i) => `-- ${i + 1}\nSELECT * FROM ${ent.many} ${q.sql};`)].join('\n');
    const uses = qs.map((q, i) => (q.uses ? i + 1 : 0)).filter(Boolean);
    return {
      prompt: 'B-tree составной индекс. Таблица большая, статистика актуальна, условия селективные. Перечислите номера запросов, для которых планировщик может использовать этот индекс (правило левого префикса).',
      code,
      answerHint: 'номера через запятую',
      answerKey: uses.join(','),
      explanation: qs.map((q, i) => `${i + 1}: ${q.why}`).join('; ') + '.',
      params: { cols: cols.join(','), picked: qs.map((q) => q.sql).join(' | ') },
    };
  },
};

export const retryPolicy: TaskGenerator = {
  id: 'be.retry-policy',
  taskId: 'task:retry-policy',
  title: 'Сколько попыток сделает клиент',
  specialization: 'backend',
  subcategoryId: 'backend.integrations',
  grade: 'middle',
  catalogIds: ['be.retries-timeouts', 'be.external-integration'],
  format: 'number',
  a: 1.1,
  b: 0.3,
  paramSpace: 5e4,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const base = rng.pick([100, 200, 500]);
    const cap = rng.pick([1000, 2000, 4000]);
    const maxAttempts = rng.int(3, 6);
    const timeout = rng.pick([500, 1000]);
    const recoverAt = rng.int(1, 8) * 500;
    let t = 0;
    let attempts = 0;
    let success = false;
    while (attempts < maxAttempts) {
      attempts++;
      if (t >= recoverAt) {
        success = true;
        break;
      }
      t += timeout;
      if (attempts < maxAttempts) t += Math.min(cap, base * 2 ** (attempts - 1));
    }
    const ask = rng.int(0, 1) === 0 ? 'attempts' : 'time';
    const answer = ask === 'attempts' ? attempts : success ? t : t;
    return {
      prompt: `Клиент вызывает внешний API с таймаутом ${timeout} мс и экспоненциальным backoff: задержка перед k-й повторной попыткой = min(${cap}, ${base}·2^(k−1)) мс, без джиттера, максимум ${maxAttempts} попыток. Сервис не отвечает (каждый запрос упирается в таймаут) до t = ${recoverAt} мс, с этого момента отвечает мгновенно. Первая попытка в t = 0. ${
        ask === 'attempts' ? 'Сколько попыток сделает клиент (включая успешную, если она будет)?' : success ? 'В какой момент времени t (мс) клиент получит успешный ответ?' : 'В какой момент времени t (мс) клиент сдастся (последний таймаут истёк)?'
      }`,
      answerHint: ask === 'attempts' ? 'число попыток' : 'миллисекунды',
      answerKey: String(answer),
      explanation: `Попытки: ${Array.from({ length: attempts }, (_, k) => {
        let tt = 0;
        for (let j = 1; j <= k; j++) tt += timeout + Math.min(cap, base * 2 ** (j - 1));
        return `${k + 1}-я в t=${tt}`;
      }).join(', ')}; ${success ? `сервис ожил в ${recoverAt}, попытка ${attempts} успешна` : `все ${maxAttempts} попыток ушли в таймаут, итог в t=${t}`}.`,
      params: { base, cap, maxAttempts, timeout, recoverAt, ask },
    };
  },
};

// ===========================================================================
// Подкатегории backend (ADR-0003, дополнение 10.10 15:50): отдельный тест на подкатегорию,
// по 8 семейств (4 Junior + 4 Middle). Семейства ниже — расширение под это требование.
// a, b — ПРЕДЛОЖЕНИЕ (экспертные), калибруются персонами (eval/test/personas.ts --subcategory).
// ===========================================================================

// ---------------------------------------------------------------------------
// backend.web-api
// ---------------------------------------------------------------------------

export const paginationOffset: TaskGenerator = {
  id: 'be.pagination-offset',
  taskId: 'task:pagination-offset',
  title: 'Сколько записей вернёт страница',
  specialization: 'backend',
  subcategoryId: 'backend.web-api',
  grade: 'junior',
  catalogIds: ['be.rest-design', 'common.http'],
  format: 'number',
  a: 1.1,
  b: -1.2,
  paramSpace: 3e4,
  timeLimitSec: 120,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ent = rng.pick(ENTITIES);
    const total = rng.int(23, 97);
    const limit = rng.pick([5, 10, 15, 20]);
    const pages = Math.ceil(total / limit);
    const kind = rng.int(0, 2);
    let prompt: string;
    let answer: number;
    let explanation: string;
    if (kind === 0) {
      const offset = rng.int(0, total + limit);
      answer = Math.max(0, Math.min(limit, total - offset));
      prompt = `В таблице «${ent.many}» ровно ${total} записей. Запрос GET /${ent.many}?limit=${limit}&offset=${offset} выполняется как SELECT * FROM ${ent.many} ORDER BY id LIMIT ${limit} OFFSET ${offset}. Сколько записей вернёт запрос?`;
      explanation = `OFFSET пропускает ${offset} записей, остаётся max(0, ${total} − ${offset}); LIMIT берёт не больше ${limit}. Итого ${answer}.`;
    } else if (kind === 1) {
      const page = rng.int(1, pages + 1);
      const offset = (page - 1) * limit;
      answer = Math.max(0, Math.min(limit, total - offset));
      prompt = `В таблице «${ent.many}» ровно ${total} записей. API пагинации нумерует страницы с 1: GET /${ent.many}?page=${page}&per_page=${limit} возвращает записи с позиции (page − 1)·per_page. Сколько записей вернёт запрос?`;
      explanation = `Пропускаем (${page} − 1)·${limit} = ${offset} записей; на странице остаётся min(${limit}, max(0, ${total} − ${offset})) = ${answer}.`;
    } else {
      answer = pages;
      prompt = `В таблице «${ent.many}» ровно ${total} записей, размер страницы per_page = ${limit}. Сколько страниц (включая неполную последнюю) нужно, чтобы выдать все записи?`;
      explanation = `Страниц ceil(${total} / ${limit}) = ${pages}: последняя неполная считается.`;
    }
    return { prompt, answerHint: 'число', answerKey: String(answer), explanation, params: { kind, total, limit } };
  },
};

export const validationRules: TaskGenerator = {
  id: 'be.validation-rules',
  taskId: 'task:validation-rules',
  title: 'Какие запросы отклонит валидация',
  specialization: 'backend',
  subcategoryId: 'backend.web-api',
  grade: 'junior',
  catalogIds: ['be.api-validation', 'be.rest-design'],
  format: 'list',
  a: 1.2,
  b: -0.5,
  paramSpace: 2e6,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const nameMin = rng.pick([2, 3]);
    const nameMax = rng.pick([10, 12]);
    const ageMin = rng.pick([16, 18]);
    const ageMax = rng.pick([60, 65]);
    const names = ['Anna', 'Boris', 'Vera', 'Gleb', 'Daria', 'Egor'];
    const nm = () => rng.pick(names);
    const mail = (n: string) => `${n.toLowerCase()}${rng.int(1, 99)}@example.com`;
    type Body = { bad: boolean; json: string; why: string };
    const build: Record<string, () => Body> = {
      ok: () => {
        const n = nm();
        return { bad: false, json: JSON.stringify({ name: n, email: mail(n), age: rng.int(ageMin, ageMax) }), why: 'все правила соблюдены' };
      },
      okNoAge: () => {
        const n = nm();
        return { bad: false, json: JSON.stringify({ name: n, email: mail(n) }), why: 'age необязателен' };
      },
      okExtra: () => {
        const n = nm();
        return { bad: false, json: JSON.stringify({ name: n, email: mail(n), age: rng.int(ageMin, ageMax), nick: 'x' }), why: 'лишние поля игнорируются' };
      },
      noName: () => ({ bad: true, json: JSON.stringify({ email: mail('user'), age: rng.int(ageMin, ageMax) }), why: 'нет обязательного name' }),
      shortName: () => ({ bad: true, json: JSON.stringify({ name: 'A'.repeat(nameMin - 1), email: mail('user') }), why: `name короче ${nameMin} символов` }),
      longName: () => ({ bad: true, json: JSON.stringify({ name: 'B'.repeat(nameMax + 1), email: mail('user') }), why: `name длиннее ${nameMax} символов` }),
      ageLow: () => ({ bad: true, json: JSON.stringify({ name: nm(), email: mail('user'), age: ageMin - 1 }), why: `age меньше ${ageMin}` }),
      ageHigh: () => ({ bad: true, json: JSON.stringify({ name: nm(), email: mail('user'), age: ageMax + 1 }), why: `age больше ${ageMax}` }),
      ageString: () => ({ bad: true, json: JSON.stringify({ name: nm(), email: mail('user'), age: String(rng.int(ageMin, ageMax)) }), why: 'age - строка, а нужно целое число' }),
      badEmail: () => ({ bad: true, json: JSON.stringify({ name: nm(), email: `${nm().toLowerCase()}.example.com` }), why: 'в email нет @' }),
      noEmail: () => ({ bad: true, json: JSON.stringify({ name: nm() }), why: 'нет обязательного email' }),
    };
    const okKeys = ['ok', 'okNoAge', 'okExtra'];
    const badKeys = ['noName', 'shortName', 'longName', 'ageLow', 'ageHigh', 'ageString', 'badEmail', 'noEmail'];
    const nOk = rng.int(2, 3);
    const keys = rng.shuffle([...rng.sample(okKeys, nOk), ...rng.sample(badKeys, 6 - nOk)]);
    const bodies = keys.map((k) => build[k]!());
    const failing = bodies.map((b, i) => (b.bad ? i + 1 : 0)).filter(Boolean);
    return {
      prompt: `Эндпоинт POST /users валидирует тело запроса и при нарушении любого правила отвечает 400. Правила: name - обязательная строка, длина от ${nameMin} до ${nameMax} символов; email - обязательная строка, в которой есть символ @; age - необязательное целое число от ${ageMin} до ${ageMax}; лишние поля игнорируются. Укажите номера запросов, на которые сервер ответит 400.`,
      code: bodies.map((b, i) => `${i + 1}. ${b.json}`).join('\n'),
      answerHint: 'номера через запятую',
      answerKey: failing.join(','),
      explanation: bodies.map((b, i) => `${i + 1}: ${b.why}`).join('; ') + '.',
      params: { keys: keys.join(','), nameMin, nameMax, ageMin, ageMax },
    };
  },
};

export const cursorPagination: TaskGenerator = {
  id: 'be.cursor-pagination',
  taskId: 'task:cursor-pagination',
  title: 'Лента при изменении данных',
  specialization: 'backend',
  subcategoryId: 'backend.web-api',
  grade: 'middle',
  catalogIds: ['be.rest-design', 'be.api-contract'],
  format: 'number',
  a: 1.2,
  b: 0.4,
  paramSpace: 1e4,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const limit = rng.pick([5, 10]);
    const total = rng.int(3 * limit, 6 * limit);
    const k = rng.int(2, 4);
    const mode = rng.pick(['offset', 'offset', 'offset', 'cursor'] as const);
    const change = rng.pick(['insert', 'delete'] as const);
    const lastSeen = total - limit + 1;
    const lines = [
      `-- страница 1: записи с id ${total} ... ${lastSeen} (limit = ${limit})`,
      change === 'insert'
        ? `-- затем в ленту добавляются ${k} новые записи (id ${total + 1} ... ${total + k})`
        : `-- затем удаляются ${k} записи из только что полученных (id ${total} ... ${total - k + 1})`,
      mode === 'offset'
        ? `-- страница 2: SELECT * FROM feed ORDER BY id DESC LIMIT ${limit} OFFSET ${limit}`
        : `-- страница 2: SELECT * FROM feed WHERE id < ${lastSeen} ORDER BY id DESC LIMIT ${limit}`,
    ];
    const answer = mode === 'cursor' ? 0 : k;
    const ask =
      change === 'insert'
        ? 'Сколько записей со страницы 2 клиент уже видел на странице 1?'
        : `Сколько записей, которые шли бы сразу за страницей 1 (id ${lastSeen - 1} и ниже) и попали бы на страницу 2 без удалений, клиент в итоге не увидит на странице 2 и последующих?`;
    return {
      prompt: `Лента отсортирована по id по убыванию (новые записи получают больший id), клиент листает страницы по очереди. ${ask}`,
      code: lines.join('\n'),
      answerHint: 'число',
      answerKey: String(answer),
      explanation:
        mode === 'cursor'
          ? 'Курсорная пагинация привязана к id последней увиденной записи, а не к позиции: вставки и удаления выше курсора ничего не сдвигают.'
          : change === 'insert'
            ? `OFFSET считает позиции: ${k} новые записи сдвинули ленту вниз, и последние ${k} записи страницы 1 снова оказались в начале страницы 2.`
            : `OFFSET считает позиции: после удаления ${k} записей лента сдвинулась вверх, и ${k} записи, которые шли бы следом за страницей 1, оказались на пропущенных позициях.`,
      params: { limit, total, k, mode, change },
    };
  },
};

export const proxyRetry: TaskGenerator = {
  id: 'be.proxy-retry',
  taskId: 'task:proxy-retry',
  title: 'Повтор потерянных запросов',
  specialization: 'backend',
  subcategoryId: 'backend.web-api',
  grade: 'middle',
  catalogIds: ['be.idempotency', 'be.rest-design'],
  format: 'number',
  a: 1.3,
  b: 0.5,
  paramSpace: 5e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const start = rng.int(10, 50) * 100;
    const hold = rng.int(1, 5) * 50;
    // Операции: тип → (применение, текст). hold снимается один раз: повтор DELETE получает 404.
    type Op = { text: string; apply: (s: { bal: number; hold: boolean }) => void; dedup: boolean };
    const mk = {
      set: (): Op => {
        const v = rng.int(5, 30) * 100;
        return { text: `PUT /account {"balance": ${v}}`, dedup: false, apply: (s) => void (s.bal = v) };
      },
      deposit: (): Op => {
        const v = rng.int(1, 9) * 100;
        return { text: `POST /deposits {"amount": ${v}}`, dedup: false, apply: (s) => void (s.bal += v) };
      },
      depositKey: (): Op => {
        const v = rng.int(1, 9) * 100;
        return { text: `POST /deposits {"amount": ${v}}, Idempotency-Key: K${rng.int(100, 999)}`, dedup: true, apply: (s) => void (s.bal += v) };
      },
      withdraw: (): Op => {
        const v = rng.int(1, 5) * 50;
        return { text: `POST /withdrawals {"amount": ${v}}`, dedup: false, apply: (s) => void (s.bal -= v) };
      },
      patch: (): Op => {
        const v = rng.int(1, 6) * 50;
        return { text: `PATCH /account {"add": ${v}}`, dedup: false, apply: (s) => void (s.bal += v) };
      },
      release: (): Op => ({
        text: 'DELETE /holds/7',
        dedup: false,
        apply: (s) => {
          if (s.hold) {
            s.hold = false;
            s.bal += hold;
          }
        },
      }),
    };
    const kinds = rng.shuffle(['set', 'deposit', 'depositKey', 'withdraw', 'patch', 'release'] as const).slice(0, rng.int(5, 6));
    const ops = kinds.map((kd) => mk[kd]());
    const lost = new Set(rng.sample(ops.map((_, i) => i), 3));
    const s = { bal: start, hold: true };
    ops.forEach((o, i) => {
      o.apply(s);
      if (lost.has(i) && !o.dedup) o.apply(s);
    });
    const code = ops.map((o, i) => `${i + 1}. ${o.text} - ${lost.has(i) ? 'ответ потерян, прокси повторил запрос' : 'ответ получен'}`).join('\n');
    return {
      prompt: `Прокси повторяет запрос один раз, если не получил ответ; сервер при этом успел обработать оригинал, так что повтор обрабатывается как второй запрос. Запросы идут по порядку. Начальный balance = ${start}; на счёте есть удержание (hold) №7 на ${hold}: оно не входит в balance, DELETE /holds/7 снимает его и возвращает сумму на balance (повторный DELETE получает 404 и ничего не меняет). Сервер дедуплицирует запросы только с Idempotency-Key. Чему равен balance после всех запросов?`,
      code,
      answerHint: 'число',
      answerKey: String(s.bal),
      explanation:
        'Повтор безвреден для PUT с абсолютным значением, DELETE (hold снимается один раз) и POST с Idempotency-Key. Относительные изменения (deposit, withdraw, PATCH add без ключа) применяются повторно.',
      params: { start, hold, kinds: kinds.join(','), lost: [...lost].sort().join(',') },
    };
  },
};

export const optimisticLock: TaskGenerator = {
  id: 'be.optimistic-lock',
  taskId: 'task:optimistic-lock',
  title: 'Конфликт версий (If-Match)',
  specialization: 'backend',
  subcategoryId: 'backend.web-api',
  grade: 'middle',
  catalogIds: ['be.rest-design', 'be.concurrency'],
  format: 'number',
  a: 1.2,
  b: 0.7,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const clients = ['A', 'B', 'C'].slice(0, rng.int(2, 3));
    type Ev = { c: string; op: 'GET' | 'PUT' };
    const events: Ev[] = rng.shuffle(clients).map((c) => ({ c, op: 'GET' as const }));
    const extra = rng.int(6, 8);
    for (let i = 0; i < extra; i++) events.push({ c: rng.pick(clients), op: rng.next() < 0.35 ? 'GET' : 'PUT' });
    let version = 1;
    const seen: Record<string, number> = {};
    let conflicts = 0;
    for (const e of events) {
      if (e.op === 'GET') seen[e.c] = version;
      else if (seen[e.c] === version) {
        version++;
        seen[e.c] = version;
      } else conflicts++;
    }
    const askConflicts = rng.int(0, 1) === 0;
    return {
      prompt: `Документ хранится с version = 1. PUT /doc применяется, только если заголовок If-Match равен текущей version (иначе ответ 412); при успехе version увеличивается на 1 и клиент запоминает новую. GET возвращает текущую version, клиент её запоминает. В If-Match клиент всегда передаёт последнюю запомненную им version; после 412 он ничего не перечитывает. События идут строго по порядку. ${
        askConflicts ? 'Сколько ответов 412 получат клиенты?' : 'Чему равна version документа после всех событий?'
      }`,
      code: events.map((e, i) => `${i + 1}. ${e.c}: ${e.op}`).join('\n'),
      answerHint: askConflicts ? 'число ответов 412' : 'version',
      answerKey: String(askConflicts ? conflicts : version),
      explanation: 'Успешный PUT меняет version, и другие клиенты с прежней version при своём PUT получают 412, пока не сделают GET. Клиент после 412 свою version не обновляет, поэтому повторные PUT тоже падают.',
      params: { clients: clients.length, askConflicts },
    };
  },
};

export const rateLimitWindow: TaskGenerator = {
  id: 'be.rate-limit-window',
  taskId: 'task:rate-limit-window',
  title: 'Сколько запросов получат 429',
  specialization: 'backend',
  subcategoryId: 'backend.web-api',
  grade: 'middle',
  catalogIds: ['be.rate-limit', 'common.http'],
  format: 'number',
  a: 1.2,
  b: 0.6,
  paramSpace: 5e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const w = rng.pick([10, 20]);
    const lim = rng.pick([3, 4]);
    const mode = rng.pick(['fixed', 'sliding'] as const);
    const poolT = new Set<number>();
    for (const c of [0, w, 2 * w]) for (let d = -4; d <= 4; d++) if (c + d >= 0) poolT.add(c + d);
    const times = rng.sample([...poolT], rng.int(10, 12)).sort((x, y) => x - y);
    const allowed: number[] = [];
    let rejected = 0;
    const perWindow = new Map<number, number>();
    for (const t of times) {
      let ok: boolean;
      if (mode === 'fixed') ok = (perWindow.get(Math.floor(t / w)) ?? 0) < lim;
      else ok = allowed.filter((x) => x > t - w).length < lim;
      if (ok) {
        allowed.push(t);
        perWindow.set(Math.floor(t / w), (perWindow.get(Math.floor(t / w)) ?? 0) + 1);
      } else rejected++;
    }
    const rule =
      mode === 'fixed'
        ? `Фиксированное окно: время делится на окна по ${w} с ([0; ${w}), [${w}; ${2 * w}), ...), в каждом окне пропускается не больше ${lim} запросов, остальные получают 429.`
        : `Скользящее окно: запрос пропускается, если среди уже пропущенных запросов за последние ${w} с (моменты t′ с t − ${w} < t′ ≤ t) меньше ${lim}; иначе 429.`;
    return {
      prompt: `${rule} Отклонённые запросы лимит не расходуют. Моменты запросов одного клиента (с) даны ниже. Сколько запросов получат 429?`,
      code: times.map((t) => `t = ${t}`).join('\n'),
      answerHint: 'число',
      answerKey: String(rejected),
      explanation:
        mode === 'fixed'
          ? 'Счётчик окна сбрасывается на границе окна, поэтому у границы можно получить до 2·лимит пропущенных запросов подряд.'
          : 'Скользящее окно смотрит на реальные последние w секунд, граница окна ничего не сбрасывает.',
      params: { w, lim, mode, n: times.length },
    };
  },
};

// ---------------------------------------------------------------------------
// backend.integrations
// ---------------------------------------------------------------------------

export const jsonMapping: TaskGenerator = {
  id: 'be.json-mapping',
  taskId: 'task:json-mapping',
  title: 'Маппинг ответа внешнего API',
  specialization: 'backend',
  subcategoryId: 'backend.integrations',
  grade: 'junior',
  catalogIds: ['be.external-integration', 'be.api-contract'],
  format: 'number',
  a: 1.0,
  b: -1.3,
  paramSpace: 1e6,
  timeLimitSec: 120,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const minor = rng.int(100, 990) * 100 + rng.pick([0, 50]);
    const tipPresent = rng.int(0, 1) === 1;
    const tip = rng.int(1, 9) * 100;
    const items = Array.from({ length: rng.int(2, 4) }, () => rng.int(1, 5));
    const payload: Record<string, unknown> = { id: `P-${rng.int(100, 999)}`, amount_minor: minor, currency: 'RUB', items: items.map((qty) => ({ qty })) };
    if (tipPresent) payload.tip_minor = tip;
    const kind = rng.int(0, 2);
    let rule: string;
    let ask: string;
    let answer: number;
    let why: string;
    if (kind === 0) {
      rule = 'amount = amount_minor / 100 (внешний API отдаёт сумму в копейках, наша модель хранит рубли)';
      ask = 'Чему равно поле amount во внутренней модели (в рублях)?';
      answer = minor / 100;
      why = `${minor} копеек / 100 = ${answer} руб.`;
    } else if (kind === 1) {
      rule = 'itemsCount = сумма qty по всем элементам items';
      ask = 'Чему равно поле itemsCount?';
      answer = items.reduce((x, y) => x + y, 0);
      why = `Суммируем qty: ${items.join(' + ')} = ${answer}.`;
    } else {
      rule = 'total = (amount_minor + tip_minor) / 100, где отсутствующее поле tip_minor считается равным 0';
      ask = 'Чему равно поле total (в рублях)?';
      answer = (minor + (tipPresent ? tip : 0)) / 100;
      why = tipPresent ? `(${minor} + ${tip}) / 100 = ${answer}.` : `Поля tip_minor нет, берём 0: ${minor} / 100 = ${answer}.`;
    }
    return {
      prompt: `Внешний платёжный API вернул JSON. Наш код переводит его во внутреннюю модель по правилу: ${rule}. ${ask}`,
      code: JSON.stringify(payload, null, 2),
      answerHint: 'число',
      answerKey: String(answer),
      explanation: why,
      params: { kind, minor, tipPresent },
    };
  },
};

export const timeoutBudget: TaskGenerator = {
  id: 'be.timeout-budget',
  taskId: 'task:timeout-budget',
  title: 'Сколько ждём недоступные сервисы',
  specialization: 'backend',
  subcategoryId: 'backend.integrations',
  grade: 'junior',
  catalogIds: ['be.retries-timeouts', 'be.external-integration'],
  format: 'number',
  a: 1.1,
  b: -0.9,
  paramSpace: 5e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const names = rng.sample(['рейтинг', 'антифрод', 'скидки', 'уведомления', 'геокодер'], 4);
    type S = { name: string; timeout: number; retries: number; down: boolean };
    const svcs: S[] = names.map((name) => ({ name, timeout: rng.pick([1, 2, 3, 5]), retries: rng.int(0, 2), down: false }));
    for (const s of rng.sample(svcs, rng.int(2, 3))) s.down = true;
    const pause = rng.pick([0, 1, 2]);
    let total = 0;
    const parts: string[] = [];
    for (const s of svcs) {
      if (!s.down) continue;
      const attempts = 1 + s.retries;
      const t = attempts * s.timeout + (attempts - 1) * pause;
      total += t;
      parts.push(`${s.name}: ${attempts}·${s.timeout}${pause ? ` + ${attempts - 1}·${pause}` : ''} = ${t} с`);
    }
    return {
      prompt: `Эндпоинт по очереди вызывает внешние сервисы (список ниже). Каждый вызов повторяется при таймауте указанное число раз (повторы - дополнительные попытки после первой)${pause ? `, между попытками пауза ${pause} с` : ', между попытками пауз нет'}. Ответ о недоступности приходит только по таймауту; ошибка сервиса не прерывает цепочку, эндпоинт идёт к следующему. Сервисы со статусом «недоступен» отвечают только таймаутом, доступные - мгновенно. Сколько секунд суммарно эндпоинт проведёт в ожидании?`,
      code: svcs.map((s, i) => `${i + 1}. ${s.name}: таймаут ${s.timeout} с, повторов ${s.retries}, ${s.down ? 'недоступен' : 'доступен'}`).join('\n'),
      answerHint: 'секунды',
      answerKey: String(total),
      explanation: `Считаем только недоступные: ${parts.join('; ')}. Итого ${total} с.`,
      params: { pause, svcs: svcs.map((s) => `${s.timeout}/${s.retries}/${s.down ? 1 : 0}`).join(',') },
    };
  },
};

const RETRY_YES: { text: string; why: string }[] = [
  { text: '429 Too Many Requests, заголовок Retry-After: 2', why: '429 - временное ограничение, повторять после паузы Retry-After' },
  { text: '502 Bad Gateway', why: '502 - временный сбой шлюза' },
  { text: '503 Service Unavailable', why: '503 - сервис временно недоступен' },
  { text: '504 Gateway Timeout', why: '504 - шлюз не дождался ответа, сбой временный' },
  { text: 'таймаут чтения, ответа нет', why: 'таймаут - временный сбой, GET безопасно повторить' },
  { text: 'соединение сброшено сервером (connection reset)', why: 'сетевой сбой, GET безопасно повторить' },
];
const RETRY_NO: { text: string; why: string }[] = [
  { text: '400 Bad Request', why: '400 - ошибка запроса, повтор того же запроса даст то же' },
  { text: '401 Unauthorized, токен просрочен', why: '401 - нужен новый токен, а не повтор того же запроса' },
  { text: '403 Forbidden', why: '403 - прав нет, повтор не поможет' },
  { text: '404 Not Found', why: '404 - ресурса нет, повтор не поможет' },
  { text: '422 Unprocessable Content', why: '422 - данные не проходят проверку, повтор не поможет' },
];

export const retryableStatus: TaskGenerator = {
  id: 'be.retryable-status',
  taskId: 'task:retryable-status',
  title: 'Какие ответы стоит повторить',
  specialization: 'backend',
  subcategoryId: 'backend.integrations',
  grade: 'junior',
  catalogIds: ['be.retries-timeouts', 'common.http'],
  format: 'list',
  a: 1.1,
  b: -0.7,
  paramSpace: 3e3,
  timeLimitSec: 120,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const nYes = rng.int(2, 4);
    const picked = rng.shuffle([...rng.sample(RETRY_YES, nYes).map((x) => ({ ...x, retry: true })), ...rng.sample(RETRY_NO, 6 - nYes).map((x) => ({ ...x, retry: false }))]);
    const path = rng.pick(['/rates', '/regions', '/catalog/items', '/weather']);
    return {
      prompt: `Клиент вызывает внешний API запросом GET ${path} (запрос безопасно повторять). Нужно повторять только при временных сбоях, а ошибки, которые повтор того же запроса не исправит, - возвращать вызывающему сразу. Перечислите номера ответов, после которых клиент должен сделать повторную попытку.`,
      code: picked.map((p, i) => `${i + 1}. ${p.text}`).join('\n'),
      answerHint: 'номера через запятую',
      answerKey: picked.map((p, i) => (p.retry ? i + 1 : 0)).filter(Boolean).join(','),
      explanation: picked.map((p, i) => `${i + 1}: ${p.why}`).join('; ') + '.',
      params: { nYes, path },
    };
  },
};

export const webhookDedup: TaskGenerator = {
  id: 'be.webhook-dedup',
  taskId: 'task:webhook-dedup',
  title: 'Сколько зачислит обработчик вебхука',
  specialization: 'backend',
  subcategoryId: 'backend.integrations',
  grade: 'junior',
  catalogIds: ['be.idempotency', 'be.external-integration'],
  format: 'number',
  a: 1.2,
  b: -0.4,
  paramSpace: 5e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const nEvents = rng.int(4, 5);
    type Ev = { id: string; type: string; amount: number };
    const base: Ev[] = Array.from({ length: nEvents }, (_, i) => ({
      id: `evt_${rng.int(10, 99)}${i}`,
      type: rng.int(0, 4) === 0 ? 'payment.failed' : 'payment.succeeded',
      amount: rng.int(1, 9) * 100,
    }));
    // Доставки: событие может прийти повторно (провайдер ретраит), а некоторые попытки наш сервер уронил (500).
    type Row = Ev & { status: number };
    const rows: Row[] = [];
    for (const e of base) {
      const failFirst = rng.int(0, 3) === 0;
      if (failFirst) rows.push({ ...e, status: 500 });
      rows.push({ ...e, status: 200 });
      if (rng.int(0, 2) === 0) rows.push({ ...e, status: 200 });
    }
    // Порядок доставок: полностью перемешивать нельзя (500 идёт до успешной), но события можно чередовать.
    const order = rng.shuffle(base.map((_, i) => i));
    const byEvent = new Map<number, Row[]>(base.map((_, i) => [i, rows.filter((r) => r.id === base[i]!.id)]));
    const seq: Row[] = [];
    const cursor = new Map<number, number>();
    let left = rows.length;
    while (left > 0) {
      const i = rng.pick(order);
      const c = cursor.get(i) ?? 0;
      const list = byEvent.get(i)!;
      if (c < list.length) {
        seq.push(list[c]!);
        cursor.set(i, c + 1);
        left--;
      }
    }
    const seen = new Set<string>();
    let credited = 0;
    for (const r of seq) {
      if (r.type !== 'payment.succeeded') continue;
      if (r.status === 500) continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      credited += r.amount;
    }
    const table2 = ['доставка | event_id | type | amount | наш ответ', ...seq.map((r, i) => `${i + 1} | ${r.id} | ${r.type} | ${r.amount} | ${r.status}`)].join('\n');
    return {
      prompt:
        'Платёжный провайдер присылает вебхуки и повторяет доставку, пока не получит 200. Наш обработчик: для события payment.succeeded зачисляет amount на счёт и запоминает event_id; если event_id уже запомнен, ничего не делает и отвечает 200; события других типов игнорирует и отвечает 200. Строки с ответом 500 - обработчик упал до зачисления и до запоминания event_id. Строки идут в порядке доставки. Сколько всего будет зачислено?',
      code: table2,
      answerHint: 'сумма',
      answerKey: String(credited),
      explanation: 'Зачисляется первая успешная обработка каждого payment.succeeded; повторы по тому же event_id и упавшие (500) попытки не зачисляют, а события другого типа игнорируются.',
      params: { nEvents, rows: seq.length },
    };
  },
};

export const circuitBreaker: TaskGenerator = {
  id: 'be.circuit-breaker',
  taskId: 'task:circuit-breaker',
  title: 'Сколько вызовов дойдёт до сервиса',
  specialization: 'backend',
  subcategoryId: 'backend.integrations',
  grade: 'middle',
  catalogIds: ['be.retries-timeouts', 'be.distributed-consistency'],
  format: 'number',
  a: 1.3,
  b: 0.7,
  paramSpace: 1e5,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const threshold = rng.int(2, 3);
    const cooldown = rng.pick([10, 15, 20]);
    const downFrom = rng.int(4, 12);
    const downTo = downFrom + rng.int(12, 35);
    const n = rng.int(10, 13);
    const times: number[] = [];
    let t = rng.int(0, 3);
    for (let i = 0; i < n; i++) {
      times.push(t);
      t += rng.int(2, 7);
    }
    let state: 'closed' | 'open' = 'closed';
    let fails = 0;
    let openedAt = 0;
    let sent = 0;
    const lines: string[] = [];
    for (const tt of times) {
      if (state === 'open' && tt < openedAt + cooldown) {
        lines.push(`t=${tt}`);
        continue;
      }
      // closed или пробный вызов после паузы
      sent++;
      const ok = !(tt >= downFrom && tt < downTo);
      if (ok) {
        state = 'closed';
        fails = 0;
      } else if (state === 'open') {
        openedAt = tt;
      } else {
        fails++;
        if (fails >= threshold) {
          state = 'open';
          openedAt = tt;
        }
      }
      lines.push(`t=${tt}`);
    }
    return {
      prompt: `Клиент вызывает внешний сервис через circuit breaker. Закрытое состояние: вызовы идут в сервис, а ${threshold} неудачи подряд размыкают цепь (успех сбрасывает счётчик подряд идущих неудач). Разомкнутое: вызовы сразу отклоняются локально, в сервис не идут, пока с момента размыкания не прошло ${cooldown} с; после этого следующий вызов - пробный, он уходит в сервис: успех замыкает цепь, неудача снова размыкает её с момента этого вызова. Сервис недоступен (любой вызов к нему неудачен) в промежутке t от ${downFrom} с включительно до ${downTo} с не включая, в остальное время отвечает успешно. Моменты вызовов (по порядку) ниже. Сколько вызовов дойдёт до сервиса?`,
      code: lines.join('\n'),
      answerHint: 'число',
      answerKey: String(sent),
      explanation: 'Считаем состояние по вызовам: после N подряд неудач цепь размыкается, вызовы в паузу отклоняются локально, пробный вызов после паузы идёт в сервис; если сервис ещё недоступен, пауза начинается заново.',
      params: { threshold, cooldown, downFrom, downTo, n },
    };
  },
};

// ---------------------------------------------------------------------------
// backend.highload
// ---------------------------------------------------------------------------

export const poolCapacity: TaskGenerator = {
  id: 'be.pool-capacity',
  taskId: 'task:pool-capacity',
  title: 'Пул соединений и очередь запросов',
  specialization: 'backend',
  subcategoryId: 'backend.highload',
  grade: 'junior',
  catalogIds: ['be.performance', 'be.sql-schema'],
  format: 'number',
  a: 1.0,
  b: -1.2,
  paramSpace: 1e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const pool = rng.int(2, 6);
    const n = pool * rng.int(2, 4) + rng.int(1, pool - 1);
    const d = rng.pick([20, 50, 100, 200]);
    const kind = rng.int(0, 2);
    let ask: string;
    let answer: number;
    let why: string;
    if (kind === 0) {
      answer = Math.ceil(n / pool) * d;
      ask = `Через сколько мс завершится последний из ${n} запросов?`;
      why = `Запросы идут «волнами» по ${pool}: ceil(${n}/${pool}) = ${Math.ceil(n / pool)} волн по ${d} мс = ${answer} мс.`;
    } else if (kind === 1) {
      const k = rng.int(1, n);
      answer = Math.ceil(k / pool) * d;
      ask = `Через сколько мс завершится запрос №${k} (запросы берут свободное соединение в порядке номеров)?`;
      why = `Запрос №${k} попадает в волну ceil(${k}/${pool}) = ${Math.ceil(k / pool)} и завершается в ${answer} мс.`;
    } else {
      const m = rng.int(0, Math.ceil(n / pool) - 1);
      const t = m * d + d / 2;
      const started = Math.min(n, pool * (m + 1));
      answer = n - started;
      ask = `Сколько запросов в момент t = ${t} мс ещё ждут свободного соединения (не начали выполняться)?`;
      why = `К моменту ${t} мс началось ${started} запросов (${m + 1} волн по ${pool}, но не больше ${n}), ждут ${n} − ${started} = ${answer}.`;
    }
    return {
      prompt: `Сервис держит пул из ${pool} соединений с БД. В момент t = 0 одновременно приходят ${n} запросов, каждому нужно соединение на ${d} мс (других затрат нет), освободившееся соединение мгновенно берёт следующий ждущий запрос. ${ask}`,
      answerHint: 'число',
      answerKey: String(answer),
      explanation: why,
      params: { pool, n, d, kind },
    };
  },
};

export const lruHits: TaskGenerator = {
  id: 'be.lru-hits',
  taskId: 'task:lru-hits',
  title: 'Попадания в кэш',
  specialization: 'backend',
  subcategoryId: 'backend.highload',
  grade: 'junior',
  catalogIds: ['be.cache', 'common.algo-complexity'],
  format: 'number',
  a: 1.1,
  b: -0.9,
  paramSpace: 1e6,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const cap = rng.int(2, 3);
    const policy = rng.pick(['LRU', 'FIFO'] as const);
    const alphabet = ['a', 'b', 'c', 'd', 'e'].slice(0, cap + 2);
    const n = rng.int(10, 12);
    const keys = Array.from({ length: n }, () => rng.pick(alphabet));
    let cache: string[] = []; // от самого старого к самому новому
    let hits = 0;
    for (const k of keys) {
      const i = cache.indexOf(k);
      if (i >= 0) {
        hits++;
        if (policy === 'LRU') cache = [...cache.slice(0, i), ...cache.slice(i + 1), k];
      } else {
        cache.push(k);
        if (cache.length > cap) cache.shift();
      }
    }
    return {
      prompt: `Кэш на ${cap} ключа, изначально пуст. При промахе значение загружается из БД и кладётся в кэш; если кэш переполнен, вытесняется ${
        policy === 'LRU' ? 'ключ, к которому дольше всего не обращались (LRU; попадание обновляет «свежесть» ключа)' : 'самый давно загруженный ключ (FIFO; попадание порядок не меняет)'
      }. Запросы по ключам идут по порядку. Сколько будет попаданий в кэш?`,
      code: keys.join(' '),
      answerHint: 'число попаданий',
      answerKey: String(hits),
      explanation: policy === 'LRU' ? 'Попадание перемещает ключ в конец очереди свежести, вытесняется самый «старый» по обращениям.' : 'FIFO вытесняет по времени загрузки, обращения к ключу его не продлевают.',
      params: { cap, policy, keys: keys.join('') },
    };
  },
};

export const queueBackpressure: TaskGenerator = {
  id: 'be.queue-backpressure',
  taskId: 'task:queue-backpressure',
  title: 'Переполнение очереди',
  specialization: 'backend',
  subcategoryId: 'backend.highload',
  grade: 'middle',
  catalogIds: ['be.message-queue', 'be.performance'],
  format: 'number',
  a: 1.2,
  b: 0.5,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const mu = rng.pick([20, 30, 40]);
    const cap = rng.pick([50, 100, 150]);
    const phases: { sec: number; rate: number }[] = [
      { sec: rng.int(2, 4), rate: mu - rng.int(5, 10) },
      { sec: rng.int(3, 5), rate: mu + rng.int(15, 40) },
      { sec: rng.int(2, 4), rate: mu - rng.int(5, 15) },
      { sec: rng.int(1, 3), rate: mu + rng.int(10, 30) },
    ];
    let q = 0;
    let rejected = 0;
    for (const p of phases) {
      for (let s = 0; s < p.sec; s++) {
        q -= Math.min(q, mu);
        const free = cap - q;
        const taken = Math.min(free, p.rate);
        q += taken;
        rejected += p.rate - taken;
      }
    }
    return {
      prompt: `Очередь сообщений ограничена ${cap} сообщениями, потребитель обрабатывает до ${mu} сообщений в секунду. Каждую секунду сначала потребитель забирает из очереди до ${mu} сообщений, затем приходят новые; если места нет, лишние отклоняются (продьюсер получает отказ, это и есть backpressure). Очередь в начале пуста. Фазы нагрузки идут подряд. Сколько сообщений будет отклонено за всё время?`,
      code: phases.map((p, i) => `фаза ${i + 1}: ${p.sec} с, ${p.rate} сообщений/с`).join('\n'),
      answerHint: 'число',
      answerKey: String(rejected),
      explanation: 'Считаем по секундам: очередь уменьшается на пропускную способность потребителя, затем пополняется входом до предела; всё, что не поместилось, отклонено.',
      params: { mu, cap, phases: phases.map((p) => `${p.sec}x${p.rate}`).join(',') },
    };
  },
};

export const cacheStampede: TaskGenerator = {
  id: 'be.cache-stampede',
  taskId: 'task:cache-stampede',
  title: 'Давка на пустом кэше',
  specialization: 'backend',
  subcategoryId: 'backend.highload',
  grade: 'middle',
  catalogIds: ['be.cache', 'be.concurrency'],
  format: 'number',
  a: 1.3,
  b: 0.7,
  paramSpace: 1e6,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ttl = rng.pick([500, 800, 1000]);
    const d = rng.pick([100, 150, 200]);
    const single = rng.int(0, 1) === 1;
    const times: number[] = [];
    let t = 0;
    for (let b = 0, nb = rng.int(3, 5); b < nb; b++) {
      const size = rng.int(2, 4);
      for (let i = 0; i < size; i++) {
        times.push(t);
        t += rng.int(10, 60);
      }
      t += rng.int(Math.floor(ttl / 2), ttl + 300);
    }
    // Запросы в порядке времени; загрузка, завершившаяся в момент ≤ t, видна запросу t.
    const loads: { start: number; end: number }[] = [];
    let queries = 0;
    for (const tt of times) {
      const valid = loads.some((l) => l.end <= tt && tt < l.end + ttl);
      if (valid) continue;
      const inflight = loads.some((l) => l.start <= tt && tt < l.end);
      if (single && inflight) continue;
      loads.push({ start: tt, end: tt + d });
      queries++;
    }
    return {
      prompt: `Cache-aside для «горячего» ключа: если в кэше есть значение, запрос получает его; иначе читает БД (одна загрузка занимает ${d} мс), после чего значение кладётся в кэш с TTL ${ttl} мс, отсчитываемым от момента окончания загрузки. ${
        single
          ? 'Защита от давки включена (single-flight): пока идёт загрузка этого ключа, остальные запросы с промахом ждут её результат и в БД не ходят.'
          : 'Защиты от давки нет: каждый запрос, увидевший промах, сам идёт в БД, даже если загрузка уже идёт.'
      } Кэш в t = 0 пуст. Загрузка, окончившаяся в момент t′ ≤ t, видна запросу в момент t. Моменты запросов (мс) даны ниже. Сколько запросов к БД будет выполнено?`,
      code: times.map((x) => `t=${x}`).join('\n'),
      answerHint: 'число запросов к БД',
      answerKey: String(queries),
      explanation: single
        ? 'В пачке запросов после истечения TTL в БД идёт только первый, остальные присоединяются к его загрузке.'
        : 'Пока первая загрузка не закончилась, кэш пуст, и каждый запрос в окне загрузки делает собственный запрос к БД.',
      params: { ttl, d, single, n: times.length },
    };
  },
};

// ---------------------------------------------------------------------------
// backend.data-model
// ---------------------------------------------------------------------------

export const fkActions: TaskGenerator = {
  id: 'be.fk-actions',
  taskId: 'task:fk-actions',
  title: 'Удаление родителя и внешний ключ',
  specialization: 'backend',
  subcategoryId: 'backend.data-model',
  grade: 'junior',
  catalogIds: ['be.sql-schema', 'common.sql-queries'],
  format: 'number',
  a: 1.1,
  b: -1.0,
  paramSpace: 1e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const parents = rng.int(3, 5);
    const children = rng.int(5, 9);
    const target = rng.int(1, parents);
    const owner = Array.from({ length: children }, () => rng.int(1, parents));
    owner[0] = target;
    const k = owner.filter((o) => o === target).length;
    const rule = rng.pick(['ON DELETE CASCADE', 'ON DELETE SET NULL', 'ON DELETE RESTRICT', ''] as const);
    let total: number;
    let why: string;
    if (rule === 'ON DELETE CASCADE') {
      total = parents - 1 + (children - k);
      why = `CASCADE удаляет и родителя, и ${k} его дочерних строк: ${parents - 1} + ${children - k}.`;
    } else if (rule === 'ON DELETE SET NULL') {
      total = parents - 1 + children;
      why = `SET NULL удаляет родителя и обнуляет ссылки, строки detail остаются: ${parents - 1} + ${children}.`;
    } else {
      total = parents + children;
      why = rule
        ? 'RESTRICT запрещает удаление, пока есть дочерние строки: DELETE завершается ошибкой, ничего не меняется.'
        : 'Без ON DELETE действует NO ACTION: при наличии дочерних строк DELETE падает с ошибкой, ничего не меняется.';
    }
    const code = [
      'CREATE TABLE parent (id int PRIMARY KEY);',
      `CREATE TABLE child (id int PRIMARY KEY, parent_id int REFERENCES parent(id)${rule ? ' ' + rule : ''});`,
      `-- parent: id ${Array.from({ length: parents }, (_, i) => i + 1).join(', ')}`,
      `-- child: parent_id ${owner.join(', ')}`,
      `DELETE FROM parent WHERE id = ${target};`,
    ].join('\n');
    return {
      prompt: 'PostgreSQL. Данные вставлены и закоммичены, затем выполняется последний DELETE (вне явной транзакции). Сколько строк окажется в двух таблицах вместе (parent + child) после него?',
      code,
      answerHint: 'число строк',
      answerKey: String(total),
      explanation: why,
      params: { parents, children, target, rule },
    };
  },
};

export const transactionScope: TaskGenerator = {
  id: 'be.transaction-scope',
  taskId: 'task:transaction-scope',
  title: 'Что останется после ROLLBACK',
  specialization: 'backend',
  subcategoryId: 'backend.data-model',
  grade: 'junior',
  catalogIds: ['be.transactions', 'common.sql-queries'],
  format: 'number',
  a: 1.1,
  b: -0.8,
  paramSpace: 5e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const initial = rng.int(0, 3);
    let rows = initial;
    let id = 100;
    const lines: string[] = [];
    const ins = () => `INSERT INTO events (id) VALUES (${++id});`;
    const nTx = rng.int(1, 2);
    if (rng.int(0, 1) === 1) {
      lines.push(ins());
      rows++;
    }
    for (let t = 0; t < nTx; t++) {
      lines.push('BEGIN;');
      let inTx = 0;
      const n1 = rng.int(1, 2);
      for (let i = 0; i < n1; i++) {
        lines.push(ins());
        inTx++;
      }
      if (rng.int(0, 1) === 1) {
        lines.push(`SAVEPOINT s${t + 1};`);
        const n2 = rng.int(1, 2);
        for (let i = 0; i < n2; i++) lines.push(ins());
        lines.push(`ROLLBACK TO s${t + 1};`);
        if (rng.int(0, 1) === 1) {
          lines.push(ins());
          inTx++;
        }
      }
      const commit = rng.int(0, 2) > 0;
      lines.push(commit ? 'COMMIT;' : 'ROLLBACK;');
      if (commit) rows += inTx;
    }
    if (rng.int(0, 1) === 1) {
      lines.push(ins());
      rows++;
    }
    return {
      prompt: `PostgreSQL. В таблице events сначала ${initial} строк${initial === 1 ? 'а' : initial >= 2 && initial <= 4 ? 'и' : ''}. Выражения ниже выполняются подряд одной сессией, ошибок нет, режим автокоммита включён (вне BEGIN каждое выражение коммитится сразу). Сколько строк будет в events в конце?`,
      code: lines.join('\n'),
      answerHint: 'число строк',
      answerKey: String(rows),
      explanation: 'Вне BEGIN вставка фиксируется сразу. Внутри транзакции ROLLBACK TO savepoint отменяет только вставки после него, а итоговый ROLLBACK отменяет всю транзакцию целиком.',
      params: { initial, nTx, lines: lines.length },
    };
  },
};

export const upsertConflict: TaskGenerator = {
  id: 'be.upsert-conflict',
  taskId: 'task:upsert-conflict',
  title: 'Что сделает ON CONFLICT',
  specialization: 'backend',
  subcategoryId: 'backend.data-model',
  grade: 'middle',
  catalogIds: ['be.sql-schema', 'be.idempotency'],
  format: 'number',
  a: 1.2,
  b: 0.4,
  paramSpace: 5e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const skus = rng.sample(['A1', 'B2', 'C3', 'D4'], 3);
    const stock = new Map<string, number>();
    const lines: string[] = [];
    for (const s of skus.slice(0, 2)) {
      const q = rng.int(1, 9) * 10;
      stock.set(s, q);
      lines.push(`-- в таблице: ${s} → ${q}`);
    }
    const kinds = ['nothing', 'add', 'set'] as const;
    const n = rng.int(5, 6);
    for (let i = 0; i < n; i++) {
      const sku = rng.pick(skus);
      const q = rng.int(1, 9) * 10;
      const kind = rng.pick(kinds);
      const cur = stock.get(sku);
      if (kind === 'nothing') {
        lines.push(`INSERT INTO stock (sku, qty) VALUES ('${sku}', ${q}) ON CONFLICT (sku) DO NOTHING;`);
        if (cur === undefined) stock.set(sku, q);
      } else if (kind === 'add') {
        lines.push(`INSERT INTO stock (sku, qty) VALUES ('${sku}', ${q}) ON CONFLICT (sku) DO UPDATE SET qty = stock.qty + EXCLUDED.qty;`);
        stock.set(sku, cur === undefined ? q : cur + q);
      } else {
        lines.push(`INSERT INTO stock (sku, qty) VALUES ('${sku}', ${q}) ON CONFLICT (sku) DO UPDATE SET qty = EXCLUDED.qty;`);
        stock.set(sku, q);
      }
    }
    const sum = [...stock.values()].reduce((x, y) => x + y, 0);
    return {
      prompt: 'PostgreSQL. Таблица stock(sku text PRIMARY KEY, qty int). Выражения выполняются по порядку, каждое успешно. В DO UPDATE столбец EXCLUDED.qty - значение из VALUES, stock.qty - текущее в таблице. Чему равна сумма qty по всем строкам stock после всех выражений?',
      code: lines.join('\n'),
      answerHint: 'сумма qty',
      answerKey: String(sum),
      explanation: 'DO NOTHING оставляет существующую строку как есть; DO UPDATE SET qty = stock.qty + EXCLUDED.qty прибавляет, а SET qty = EXCLUDED.qty перезаписывает; новый sku вставляется как обычный INSERT.',
      params: { n, skus: skus.join(',') },
    };
  },
};

export const deadlockCommits: TaskGenerator = {
  id: 'be.deadlock-commits',
  taskId: 'task:deadlock-commits',
  title: 'Взаимная блокировка',
  specialization: 'backend',
  subcategoryId: 'backend.data-model',
  grade: 'middle',
  catalogIds: ['be.transactions', 'be.concurrency'],
  format: 'number',
  a: 1.3,
  b: 0.5,
  paramSpace: 5e4,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    type Op = { kind: 'upd' | 'lock' | 'sel' | 'commit'; row: number };
    const lockKind = () => rng.pick(['upd', 'upd', 'lock'] as const);
    for (let attempt = 0; attempt < 200; attempt++) {
      // Строки a, b, c - разные. T1 берёт a, затем b; T2 берёт b, затем (по варианту) a / читает a / берёт c / берёт a первой.
      const [ra, rb, rc] = rng.shuffle([1, 2, 3]) as [number, number, number];
      const variant = rng.pick(['cross', 'cross', 'cross', 'plain', 'other', 'same'] as const);
      const t1: Op[] = [{ kind: lockKind(), row: ra }, { kind: lockKind(), row: rb }];
      let t2: Op[];
      if (variant === 'cross') t2 = [{ kind: lockKind(), row: rb }, { kind: lockKind(), row: ra }];
      else if (variant === 'plain') t2 = [{ kind: lockKind(), row: rb }, { kind: 'sel', row: ra }];
      else if (variant === 'other') t2 = [{ kind: lockKind(), row: rb }, { kind: lockKind(), row: rc }];
      else t2 = [{ kind: lockKind(), row: ra }, { kind: lockKind(), row: rb }];
      if (rng.int(0, 2) === 0) t1.splice(1, 0, { kind: 'sel', row: rc });
      if (rng.int(0, 2) === 0) t2.push({ kind: 'sel', row: rc });
      const txs: Op[][] = [t1, t2].map((ops) => [...ops, { kind: 'commit' as const, row: 0 }]);
      const order: number[] = rng.shuffle([...txs[0]!.map(() => 0), ...txs[1]!.map(() => 1)]);
      const sim = simulateLocks(txs, order);
      // Для варианта cross нужен чередующийся порядок, при котором цикл действительно возникает.
      if (variant === 'cross' && !sim.deadlock) continue;
      if (variant !== 'cross' && sim.deadlock) continue;
      const idx = [0, 0];
      const lines = order.map((t) => {
        const op = txs[t]![idx[t]!++]!;
        const label = `T${t + 1}`;
        if (op.kind === 'commit') return `${label}: COMMIT;`;
        if (op.kind === 'upd') return `${label}: UPDATE accounts SET balance = balance + 1 WHERE id = ${op.row};`;
        if (op.kind === 'lock') return `${label}: SELECT * FROM accounts WHERE id = ${op.row} FOR UPDATE;`;
        return `${label}: SELECT * FROM accounts WHERE id = ${op.row};`;
      });
      return {
        prompt:
          'PostgreSQL, уровень READ COMMITTED. Две транзакции уже начаты (BEGIN), шаги ниже выдаются по порядку. Если шаг блокируется (ждёт блокировку строки), его транзакция ждёт, а её следующие шаги выполнятся после снятия блокировки; шаги другой транзакции идут своим чередом. UPDATE и SELECT ... FOR UPDATE берут блокировку строки до конца транзакции; обычный SELECT блокировок не берёт и не блокируется. Взаимную блокировку PostgreSQL разрешает, откатывая одну из транзакций. Сколько транзакций завершатся успешным COMMIT?',
        code: lines.join('\n'),
        answerHint: 'число транзакций',
        answerKey: String(sim.committed),
        explanation: sim.deadlock
          ? 'Транзакции ждут друг друга по кругу (каждая держит строку, нужную другой): это deadlock, PostgreSQL откатывает одну, вторая завершается успешно.'
          : 'Цикла ожидания нет: ожидающая транзакция получает блокировку после COMMIT другой, обе завершаются успешно.',
        params: { deadlock: sim.deadlock, order: order.join(''), variant },
      };
    }
    throw new Error('deadlock-commits: не удалось подобрать экземпляр');
  },
};

/** Симуляция блокировок строк для двух транзакций. Возвращает число закоммитивших и признак deadlock. */
function simulateLocks(txs: { kind: 'upd' | 'lock' | 'sel' | 'commit'; row: number }[][], order: number[]): { committed: number; deadlock: boolean } {
  const queues: typeof txs = txs.map(() => []);
  const holder = new Map<number, number>();
  const waiting: (number | null)[] = [null, null];
  const state: ('run' | 'done' | 'aborted')[] = ['run', 'run'];
  let committed = 0;
  let deadlock = false;
  const release = (t: number) => {
    for (const [r, h] of [...holder]) if (h === t) holder.delete(r);
  };
  const advance = () => {
    let progress = true;
    while (progress) {
      progress = false;
      for (let t = 0; t < 2; t++) {
        while (state[t] === 'run' && queues[t]!.length > 0) {
          const op = queues[t]![0]!;
          if (op.kind === 'sel') {
            queues[t]!.shift();
            progress = true;
          } else if (op.kind === 'commit') {
            queues[t]!.shift();
            release(t);
            state[t] = 'done';
            committed++;
            waiting[t] = null;
            progress = true;
          } else {
            const h = holder.get(op.row);
            if (h === undefined || h === t) {
              holder.set(op.row, t);
              waiting[t] = null;
              queues[t]!.shift();
              progress = true;
            } else {
              waiting[t] = op.row;
              break;
            }
          }
        }
      }
      // Цикл ожидания: T0 ждёт строку T1 и наоборот.
      if (state[0] === 'run' && state[1] === 'run' && waiting[0] !== null && waiting[1] !== null && holder.get(waiting[0]) === 1 && holder.get(waiting[1]) === 0) {
        deadlock = true;
        state[1] = 'aborted';
        release(1);
        waiting[1] = null;
        queues[1] = [];
        progress = true;
      }
    }
  };
  const idx = [0, 0];
  for (const t of order) {
    queues[t]!.push(txs[t]![idx[t]!++]!);
    advance();
  }
  advance();
  return { committed, deadlock };
}

export const lostUpdate: TaskGenerator = {
  id: 'be.lost-update',
  taskId: 'task:lost-update',
  title: 'Потерянное обновление',
  specialization: 'backend',
  subcategoryId: 'backend.data-model',
  grade: 'middle',
  catalogIds: ['be.transactions', 'be.concurrency'],
  format: 'number',
  a: 1.3,
  b: 0.6,
  paramSpace: 5e4,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const level = rng.pick(['READ COMMITTED', 'REPEATABLE READ'] as const);
    const style = rng.pick(['client', 'atomic'] as const);
    const start = rng.int(10, 90) * 10;
    const d1 = rng.int(1, 9) * 10;
    const d2 = -rng.int(1, 9) * 10;
    const sign = (d: number) => (d >= 0 ? `+ ${d}` : `- ${-d}`);
    let result: number;
    let why: string;
    if (level === 'REPEATABLE READ') {
      result = start + d1;
      why = `REPEATABLE READ: T2 работает со снимком, а строку уже изменила и закоммитила T1, поэтому UPDATE в T2 завершается ошибкой «could not serialize access due to concurrent update»; T2 откатывается, остаётся результат T1: ${result}.`;
    } else if (style === 'client') {
      result = start + d2;
      why = `Приложение прочитало ${start} в обеих транзакциях и записало готовое значение: T2 затирает результат T1 (потерянное обновление). Итог ${start} ${sign(d2)} = ${result}.`;
    } else {
      result = start + d1 + d2;
      why = `UPDATE ... SET balance = balance ${sign(d1)} вычисляется по актуальной строке (T2 после коммита T1 видит новое значение), поэтому оба изменения применяются: ${result}.`;
    }
    const upd1 = style === 'client' ? `SET balance = ${start + d1}` : `SET balance = balance ${sign(d1)}`;
    const upd2 = style === 'client' ? `SET balance = ${start + d2}` : `SET balance = balance ${sign(d2)}`;
    const code = [
      `T1: BEGIN ISOLATION LEVEL ${level};`,
      `T2: BEGIN ISOLATION LEVEL ${level};`,
      `T1: SELECT balance FROM accounts WHERE id = 1;   -- ${start}`,
      `T2: SELECT balance FROM accounts WHERE id = 1;   -- ${start}`,
      `T1: UPDATE accounts ${upd1} WHERE id = 1;`,
      'T1: COMMIT;',
      `T2: UPDATE accounts ${upd2} WHERE id = 1;`,
      'T2: COMMIT;',
    ].join('\n');
    return {
      prompt: `PostgreSQL. Начальный balance строки id = 1 равен ${start}. Шаги выполняются построчно сверху вниз; в варианте с готовым значением приложение подставило число, посчитанное им по прочитанному balance. Если какое-то выражение завершается ошибкой, его транзакция откатывается целиком. Чему равен balance после всех шагов?`,
      code,
      answerHint: 'число',
      answerKey: String(result),
      explanation: why,
      params: { level, style, start, d1, d2 },
    };
  },
};

export const BACKEND_GENERATORS: TaskGenerator[] = [
  sqlRowcount,
  httpSemantics,
  findBugIdor,
  nPlusOne,
  shellOutput,
  schemaConstraint,
  paymentRetry,
  isolationAnomaly,
  cacheConsistency,
  deliverySemantics,
  indexChoice,
  retryPolicy,
  paginationOffset,
  validationRules,
  cursorPagination,
  proxyRetry,
  optimisticLock,
  rateLimitWindow,
  jsonMapping,
  timeoutBudget,
  retryableStatus,
  webhookDedup,
  circuitBreaker,
  poolCapacity,
  lruHits,
  queueBackpressure,
  cacheStampede,
  fkActions,
  transactionScope,
  upsertConflict,
  deadlockCommits,
  lostUpdate,
];
