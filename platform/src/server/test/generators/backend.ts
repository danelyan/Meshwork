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
    type Ins = { sql: string; fails: boolean; why: string };
    const dup = rng.int(0, 1);
    const candidates: Ins[] = [
      { sql: `INSERT INTO users (email, name, age) VALUES ('${emails[0]}', '${names[0]}', ${minAge + rng.int(0, 10)});`, fails: false, why: 'все ограничения соблюдены' },
      { sql: `INSERT INTO users (email, name, age) VALUES ('${emails[dup]}', '${names[1]}', ${minAge + 2});`, fails: dup === 0, why: dup === 0 ? 'повтор email нарушает UNIQUE' : 'email уникален' },
      { sql: `INSERT INTO users (email, age) VALUES ('${emails[2]}', ${minAge + 1});`, fails: true, why: 'name NOT NULL без DEFAULT' },
      { sql: `INSERT INTO users (email, name, age) VALUES ('${emails[3]}', '${names[3]}', ${minAge - rng.int(1, 3)});`, fails: true, why: `CHECK (age >= ${minAge}) нарушен` },
      { sql: `INSERT INTO users (email, name) VALUES ('${emails[1]}x', '${names[2]}');`, fails: false, why: 'age может быть NULL: CHECK с NULL не считается нарушением' },
    ];
    const order = rng.shuffle(candidates);
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
    const failing = order.map((c, i) => (c.fails ? i + 1 : 0)).filter(Boolean);
    return {
      prompt: 'PostgreSQL, таблица пустая, выражения выполняются по порядку, каждое в своей транзакции. Перечислите номера INSERT, которые завершатся ошибкой.',
      code,
      answerHint: 'номера через запятую',
      answerKey: failing.join(','),
      explanation: order.map((c, i) => `${i + 1}: ${c.why}`).join('; ') + '.',
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
];
