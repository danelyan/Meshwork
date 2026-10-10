// Банк-2 backend.web-api: +3 Junior, +5 Middle, +4 Senior. Пробелы: тесты API, коды ошибок, CORS, согласование
// содержимого, merge-patch. Ответ считает код (R-T-02); a, b — ПРЕДЛОЖЕНИЕ (экспертные).
import { createRng } from '../rng';
import type { TaskGenerator } from '../types';
import { fam, notHalf, until } from './backend-bank2-util';

// ---------------------------------------------------------------------------
// Junior
// ---------------------------------------------------------------------------

const TEST_POOL: { req: string; status: number; keys: string[]; field: string; wrongStatus: number }[] = [
  { req: 'POST /users (корректное тело)', status: 201, keys: ['id', 'email'], field: 'id', wrongStatus: 200 },
  { req: 'GET /users/7', status: 200, keys: ['id', 'email', 'name'], field: 'name', wrongStatus: 204 },
  { req: 'GET /users/999 (нет такого)', status: 404, keys: ['error'], field: 'error', wrongStatus: 400 },
  { req: 'DELETE /users/7', status: 204, keys: [], field: 'нет тела', wrongStatus: 200 },
  { req: 'POST /users (email не указан)', status: 422, keys: ['errors'], field: 'errors', wrongStatus: 400 },
  { req: 'PUT /users/7', status: 200, keys: ['id', 'email', 'name'], field: 'email', wrongStatus: 201 },
  { req: 'GET /users?limit=2', status: 200, keys: ['items', 'total'], field: 'total', wrongStatus: 206 },
  { req: 'POST /users (email занят)', status: 409, keys: ['error'], field: 'error', wrongStatus: 422 },
];

export const apiTestAsserts: TaskGenerator = fam(
  { slug: 'api-test-asserts', title: 'Какие тесты API упадут', sub: 'web-api', grade: 'junior', catalogIds: ['be.integration-tests', 'common.http'], format: 'number', a: 1.2, b: -0.8, paramSpace: 5e4, timeLimitSec: 180 },
  (seed) => {
    const rng = createRng(seed);
    const picked = Array.from({ length: 11 }, () => rng.pick(TEST_POOL));
    const badP = rng.pick([1, 2, 3, 4, 5]); // доля «плохих» тестов на экземпляр: 1/6 ... 5/6
    let failed = 0;
    const rows: string[] = [];
    const why: string[] = [];
    picked.forEach((p, i) => {
      const mode = rng.int(0, 5) < badP ? rng.int(1, 2) : 0;
      // 0 - тест корректен; 1 - в тесте ждут неверный статус; 2 - в ответе нет проверяемого поля
      const expStatus = mode === 1 ? p.wrongStatus : p.status;
      const hasField = p.keys.length > 0;
      const gotKeys = mode === 2 && hasField ? p.keys.filter((k) => k !== p.field) : p.keys;
      const fail = expStatus !== p.status || (hasField && !gotKeys.includes(p.field));
      if (fail) {
        failed++;
        why.push(`№${i + 1}`);
      }
      rows.push(
        `${i + 1}. ${p.req}\n   тест: status === ${expStatus}${hasField ? `, в теле есть «${p.field}»` : ', тело не проверяется'}\n   сервис вернул: ${p.status}${hasField ? `, поля тела: ${gotKeys.length ? gotKeys.join(', ') : 'нет'}` : ', тело пустое'}`,
      );
    });
    return {
      prompt: 'Автотесты API сравнивают ответ сервиса с ожиданием. Тест падает, если не совпал код ответа или в теле нет проверяемого поля. Сколько из тестов ниже упадёт?',
      code: rows.join('\n'),
      answerHint: 'число упавших тестов',
      answerKey: String(failed),
      explanation: failed ? `Падают тесты ${why.join(', ')}: у них ожидаемый код не равен фактическому либо в теле нет нужного поля. Итого ${failed}.` : 'Все ожидания совпали с ответами сервиса, упавших тестов нет.',
      params: { failed },
    };
  },
);

const ERR_POOL: { s: string; code: number }[] = [
  { s: 'клиент не передал токен авторизации', code: 401 },
  { s: 'токен верный, но роли не хватает для удаления', code: 403 },
  { s: 'заказа с таким id нет', code: 404 },
  { s: 'создание пользователя конфликтует с текущим состоянием: запись с таким уникальным email уже существует', code: 409 },
  { s: 'на путь /orders отправили метод PATCH, он не поддерживается', code: 405 },
  { s: 'тело запроса больше допустимого размера', code: 413 },
  { s: 'новый заказ успешно создан', code: 201 },
  { s: 'ресурс удалён, тело ответа пустое', code: 204 },
  { s: 'клиент превысил лимит запросов', code: 429 },
  { s: 'Content-Type: text/xml, а сервер принимает только JSON', code: 415 },
  { s: 'тело запроса не разбирается как JSON (синтаксическая ошибка)', code: 400 },
  { s: 'условие If-Match не выполнено: версия ресурса уже другая', code: 412 },
];

export const apiErrorCodes: TaskGenerator = fam(
  { slug: 'api-error-codes', title: 'Коды ответа по ситуациям', sub: 'web-api', grade: 'junior', catalogIds: ['be.rest-design', 'common.http'], format: 'text', a: 1.1, b: -0.9, paramSpace: 9e4, timeLimitSec: 150 },
  (seed) => {
    const rng = createRng(seed);
    const picked = rng.sample(ERR_POOL, 5);
    return {
      prompt: 'Для каждой ситуации укажите наиболее подходящий код ответа REST API. Ответ - пять кодов через запятую в порядке ситуаций.',
      code: picked.map((p, i) => `${i + 1}. ${p.s}`).join('\n'),
      answerHint: 'пять кодов через запятую',
      answerKey: picked.map((p) => p.code).join(','),
      explanation: picked.map((p, i) => `${i + 1}: ${p.code}`).join('; ') + '. Код отражает, что именно не так: аутентификация (401), права (403), отсутствие ресурса (404), конфликт состояния (409/412), формат (400/413/415) и т.д.',
      params: { codes: picked.map((p) => p.code).join(',') },
    };
  },
);

export const apiQueryResult: TaskGenerator = fam(
  { slug: 'api-query-result', title: 'Что вернёт список с фильтром и сортировкой', sub: 'web-api', grade: 'junior', catalogIds: ['be.rest-design', 'common.http'], format: 'text', a: 1.2, b: -0.55, paramSpace: 2e5, timeLimitSec: 180 },
  (seed) => {
    const rng = createRng(seed);
    const prices = rng.sample([90, 120, 150, 200, 240, 310, 380, 450, 520, 700], 7);
    const items = prices.map((price, i) => ({ id: 10 + i, price, status: rng.pick(['active', 'archived']), name: rng.pick(['лампа', 'стул', 'стол', 'шкаф', 'полка']) + String(i) }));
    const status = rng.pick(['active', 'archived']);
    const field = rng.pick(['price', 'id']);
    const dir = rng.pick(['', '-']);
    const limit = rng.int(2, 4);
    const filtered = items.filter((x) => x.status === status);
    const sorted = [...filtered].sort((p, q) => (dir === '-' ? -1 : 1) * (p[field as 'price' | 'id'] - q[field as 'price' | 'id']));
    const res = sorted.slice(0, limit).map((x) => x.id);
    const q = `GET /items?status=${status}&sort=${dir}${field}&limit=${limit}`;
    return {
      prompt: `Сервис поддерживает параметры: status - точное совпадение, sort - поле сортировки (без префикса по возрастанию, с «-» по убыванию), limit - максимум записей. Фильтрация выполняется до сортировки, лимит - после. Какие id вернёт запрос ${q}? Перечислите id в порядке ответа через запятую; если записей нет, напишите «пусто».`,
      code: ['id | name | price | status', ...items.map((x) => `${x.id} | ${x.name} | ${x.price} | ${x.status}`)].join('\n'),
      answerHint: 'id через запятую в порядке ответа',
      answerKey: res.length ? res.join(',') : 'пусто',
      explanation: `Фильтр status=${status} оставляет ${filtered.length} записей; сортировка по ${dir === '-' ? 'убыванию' : 'возрастанию'} ${field}; берём первые ${limit}: ${res.length ? res.join(', ') : 'ничего'}.`,
      params: { status, field, dir, limit },
    };
  },
);

// ---------------------------------------------------------------------------
// Middle
// ---------------------------------------------------------------------------

export const apiTestSharedState: TaskGenerator = fam(
  { slug: 'api-test-shared-state', title: 'Тесты с общим состоянием БД', sub: 'web-api', grade: 'middle', catalogIds: ['be.integration-tests', 'common.debugging'], format: 'number', a: 1.3, b: 0.55, paramSpace: 1e5, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const n = rng.int(8, 11);
    const pc = rng.int(1, 4);
    const tests = Array.from({ length: n }, (_, i) => ({ name: `тест ${i + 1}`, inserts: rng.int(1, 3), cleanup: rng.int(0, 4) < pc, skip: rng.int(0, 5) === 0 }));
    let count = 0;
    const failed: number[] = [];
    for (const [i, t] of tests.entries()) {
      if (t.skip) continue;
      count += t.inserts;
      const ok = count === t.inserts;
      if (!ok) failed.push(i + 1);
      // Очистка - последняя строка тела теста: после упавшей проверки она не выполняется.
      if (ok && t.cleanup) count = 0;
    }
    return {
      prompt: 'Таблица users перед запуском пуста. Тесты выполняются по порядку в одном процессе, без отката между ними. Каждый тест вставляет указанное число пользователей и проверяет, что в таблице ровно столько строк, сколько он вставил. Если у теста есть cleanup, последней строкой тела теста вызывается TRUNCATE users (после упавшей проверки до этой строки выполнение не доходит). Пропущенные (skip) тесты не выполняются. Сколько тестов упадёт?',
      code: tests.map((t, i) => `${i + 1}. вставляет ${t.inserts}; ${t.cleanup ? 'cleanup в конце' : 'без cleanup'}${t.skip ? '; skip' : ''}`).join('\n'),
      answerHint: 'число упавших тестов',
      answerKey: String(failed.length),
      explanation: `Состояние накапливается: упадут тесты ${failed.length ? failed.join(', ') : '(ни один)'}. Тест без cleanup или с cleanup после упавшей проверки оставляет строки следующему.`,
      params: { n, failed: failed.length },
    };
  },
);

type Json = null | string | number | boolean | Json[] | { [k: string]: Json };

function mergePatch(target: Json, patch: Json): Json {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const base: { [k: string]: Json } = target !== null && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete base[k];
    else base[k] = mergePatch(base[k] ?? null, v);
  }
  return base;
}

function leaves(x: Json): number {
  if (x !== null && typeof x === 'object' && !Array.isArray(x)) return Object.values(x).reduce((s: number, v) => s + leaves(v), 0);
  return 1;
}

export const apiMergePatch: TaskGenerator = fam(
  { slug: 'api-merge-patch', title: 'Результат PATCH (merge-patch)', sub: 'web-api', grade: 'middle', catalogIds: ['be.rest-design', 'be.api-contract'], format: 'number', a: 1.2, b: 0.5, paramSpace: 1e6, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const doc: { [k: string]: Json } = { name: 'Анна', tags: ['a', 'b'], address: { city: rng.pick(['Омск', 'Тверь']), zip: '1000' }, prefs: { theme: 'dark', notify: { email: true, sms: false } } };
    const optional: [string, Json][] = [['phone', '+7000'], ['age', 30], ['nick', 'ann']];
    for (const [k, v] of rng.sample(optional, rng.int(1, 2))) doc[k] = v;
    const candidates: { [k: string]: Json }[] = [
      { tags: ['x'] },
      { address: { zip: null } },
      { address: { street: 'Мира' } },
      { prefs: { notify: { sms: true } } },
      { prefs: { notify: null } },
      { prefs: { theme: null, lang: 'ru' } },
      { nick: null },
      { phone: null },
      { age: 31 },
      { address: null },
      { tags: [] },
      { extra: { a: 1, b: 2 } },
    ];
    const patches = rng.sample(candidates, 3);
    let cur: Json = doc;
    for (const p of patches) cur = mergePatch(cur, p);
    const n = leaves(cur);
    return {
      prompt: 'К документу последовательно применяют три PATCH с телом по правилам JSON Merge Patch (RFC 7396): объекты сливаются рекурсивно, null удаляет ключ, массивы и скаляры заменяются целиком. Сколько листовых значений (скаляры и массивы; каждый массив считается за одно значение, пустой объект не считается) в документе после всех трёх запросов?',
      code: `документ: ${JSON.stringify(doc)}\n${patches.map((p, i) => `PATCH ${i + 1}: ${JSON.stringify(p)}`).join('\n')}`,
      answerHint: 'число листовых значений',
      answerKey: String(n),
      explanation: `Результат: ${JSON.stringify(cur)}; листьев ${n}.`,
      params: { patches: patches.map((p) => Object.keys(p)[0]).join(',') },
    };
  },
);

const FORMATS: { short: string; mime: string }[] = [
  { short: 'json', mime: 'application/json' },
  { short: 'xml', mime: 'application/xml' },
  { short: 'csv', mime: 'text/csv' },
];

export const apiAcceptHeader: TaskGenerator = fam(
  { slug: 'api-accept-header', title: 'Какой формат ответа выберет сервер', sub: 'web-api', grade: 'middle', catalogIds: ['common.http', 'be.rest-design'], format: 'text', a: 1.2, b: 0.4, paramSpace: 1e6, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const server = rng.shuffle(FORMATS).slice(0, rng.int(2, 3));
    const ranges = ['application/json', 'application/xml', 'text/csv', 'application/*', 'text/*', '*/*'];
    const reqs = Array.from({ length: 4 }, () =>
      rng.sample(ranges, rng.int(1, 3)).map((r) => ({ r, q: rng.pick([1, 1, 0.8, 0.5, 0.1, 0]) })),
    );
    const spec = (r: string) => (r === '*/*' ? 0 : r.endsWith('/*') ? 1 : 2);
    const match = (r: string, mime: string) => r === '*/*' || r === mime || (r.endsWith('/*') && mime.startsWith(r.slice(0, -1)));
    const res = reqs.map((accept) => {
      let best: { short: string; q: number } | null = null;
      for (const f of server) {
        const ms = accept.filter((a) => match(a.r, f.mime)).sort((x, y) => spec(y.r) - spec(x.r))[0];
        const q = ms ? ms.q : 0;
        if (q > 0 && (!best || q > best.q)) best = { short: f.short, q };
      }
      return best ? best.short : '406';
    });
    return {
      prompt: `Сервер умеет отдавать ответ в форматах (в порядке предпочтения сервера): ${server.map((f) => f.mime).join(', ')}. По RFC 9110: выбирается тип с наибольшим q; для типа берётся q самого конкретного подходящего диапазона (точный тип точнее «type/*», тот точнее «*/*»); q=0 означает «не хочу»; диапазон без q имеет q=1; при равных q побеждает формат, стоящий раньше в списке сервера; если ничего не подошло - 406. Что вернёт сервер на каждый из четырёх запросов? Ответ через запятую: json, xml, csv или 406.`,
      code: reqs.map((a, i) => `${i + 1}. Accept: ${a.map((x) => (x.q === 1 ? x.r : `${x.r};q=${x.q}`)).join(', ')}`).join('\n'),
      answerHint: 'четыре значения через запятую',
      answerKey: res.join(','),
      explanation: `Применяем правила выбора к каждому заголовку: ${res.join(', ')}.`,
      params: { server: server.map((f) => f.short).join('') },
    };
  },
);

export const apiMiddlewareOrder: TaskGenerator = fam(
  { slug: 'api-middleware-order', title: 'Порядок middleware и коды ответов', sub: 'web-api', grade: 'middle', catalogIds: ['be.rate-limit', 'be.authn-impl', 'be.rest-design'], format: 'text', a: 1.3, b: 0.65, paramSpace: 5e5, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const limitFirst = rng.int(0, 1) === 0;
    const limit = rng.int(2, 3);
    const n = 7;
    const reqs = Array.from({ length: n }, () => ({ ip: rng.pick(['A', 'B']), ok: rng.int(0, 2) > 0 }));
    const used: Record<string, number> = { A: 0, B: 0 };
    const res = reqs.map((r) => {
      if (limitFirst) {
        used[r.ip]!++;
        if (used[r.ip]! > limit) return 429;
        return r.ok ? 200 : 401;
      }
      if (!r.ok) return 401;
      used[r.ip]!++;
      return used[r.ip]! > limit ? 429 : 200;
    });
    return {
      prompt: `Цепочка middleware: ${limitFirst ? 'сначала ограничитель частоты, затем проверка токена, затем обработчик' : 'сначала проверка токена, затем ограничитель частоты, затем обработчик'}. Ограничитель пропускает не больше ${limit} запросов с одного IP за окно (окно не заканчивается в рамках примера) и считает каждый запрос, который до него дошёл; сверх лимита - 429. Нет валидного токена - 401. Какие коды вернёт сервис на семь запросов подряд? Ответ через запятую.`,
      code: reqs.map((r, i) => `${i + 1}. IP ${r.ip}, токен ${r.ok ? 'валиден' : 'отсутствует'}`).join('\n'),
      answerHint: 'семь кодов через запятую',
      answerKey: res.join(','),
      explanation: `Запрос, отклонённый первым в цепочке, до второго звена не доходит. ${limitFirst ? 'Ограничитель стоит первым и считает и анонимные запросы.' : 'Проверка токена стоит первой, анонимные запросы лимит не расходуют.'} Коды: ${res.join(', ')}.`,
      params: { limitFirst, limit },
    };
  },
);

export const apiCorsPreflight: TaskGenerator = fam(
  { slug: 'api-cors-preflight', title: 'Какие запросы заблокирует CORS', sub: 'web-api', grade: 'middle', catalogIds: ['common.http', 'common.security-basics'], format: 'number', a: 1.2, b: 0.6, paramSpace: 1e6, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const origins = ['https://app.example.com', 'https://admin.example.com', 'https://shop.example.net', 'https://partner.example.org'];
    const allowedOrigins = rng.sample(origins, rng.int(1, 3));
    const allowedMethods = rng.pick([['GET', 'POST'], ['GET', 'POST', 'PUT'], ['GET', 'POST', 'DELETE']]);
    const allowedHeaders = rng.pick([['Content-Type'], ['Content-Type', 'Authorization']]);
    const reqs = Array.from({ length: 12 }, () => ({
      origin: rng.pick(origins),
      method: rng.pick(['GET', 'POST', 'PUT', 'DELETE']),
      headers: rng.pick([[], ['Authorization'], ['Content-Type: application/json'], ['Content-Type: text/plain']]),
    }));
    let blocked = 0;
    for (const r of reqs) {
      const customHeader = r.headers.some((h) => h === 'Authorization' || h === 'Content-Type: application/json');
      const pre = customHeader || !['GET', 'HEAD', 'POST'].includes(r.method);
      const originOk = allowedOrigins.includes(r.origin);
      const headersOk = r.headers.every((h) => allowedHeaders.includes(h.startsWith('Content-Type') ? 'Content-Type' : h));
      const bad = !originOk || (pre && (!allowedMethods.includes(r.method) || !headersOk));
      if (bad) blocked++;
    }
    return {
      prompt: `Браузерные запросы идут из разных источников (Origin) к API. Сервер разрешает источники ${allowedOrigins.join(', ')}, методы ${allowedMethods.join(', ')} и заголовки ${allowedHeaders.join(', ')} (в preflight и в ответах). Preflight-запрос OPTIONS нужен, если метод не GET/HEAD/POST либо есть заголовок Authorization или Content-Type: application/json (text/plain - «простой» тип). Браузер блокирует запрос, если preflight не разрешил метод или заголовки, а также если Origin не входит в разрешённые (ответ нельзя прочитать). Сколько из двенадцати запросов будет заблокировано?`,
      code: reqs.map((r, i) => `${i + 1}. Origin ${r.origin}; ${r.method}; заголовки: ${r.headers.length ? r.headers.join(', ') : 'нет'}`).join('\n'),
      answerHint: 'число заблокированных запросов',
      answerKey: String(blocked),
      explanation: `Для каждого запроса проверяем источник, нужен ли preflight, и разрешены ли метод и заголовки. Заблокировано ${blocked}.`,
      params: { allowedOrigins: allowedOrigins.join(','), allowedMethods: allowedMethods.join(',') },
    };
  },
);

// ---------------------------------------------------------------------------
// Senior
// ---------------------------------------------------------------------------

export const apiFanoutTail: TaskGenerator = fam(
  { slug: 'api-fanout-tail', title: 'Хвост задержки при веере вызовов', sub: 'web-api', grade: 'senior', catalogIds: ['be.performance', 'be.external-integration'], format: 'number', a: 1.2, b: 1.1, paramSpace: 5e3, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const p = rng.pick([0.5, 1, 2, 3, 5]);
    const k = rng.pick([5, 8, 10, 15, 20, 30, 50]);
    const kind = rng.int(0, 1);
    if (kind === 0) {
      const share = until(() => (1 - Math.pow(1 - p / 100, k)) * 100, notHalf);
      const ans = Math.round(share);
      return {
        prompt: `Эндпоинт параллельно вызывает ${k} независимых сервисов и отвечает, когда получены все ответы. Каждый сервис отвечает медленнее порога SLO в ${p}% случаев независимо от остальных. Какая доля ответов эндпоинта будет медленнее порога? Округлите до целого процента.`,
        answerHint: 'процент, целое',
        answerKey: String(ans),
        explanation: `Быстро отвечает эндпоинт, если быстры все: (1 - ${p / 100})^${k}. Медленных: 1 - ${(Math.pow(1 - p / 100, k)).toFixed(4)} ≈ ${share.toFixed(1)}%, округляем до ${ans}.`,
        params: { p, k, kind },
      };
    }
    const target = rng.pick([5, 10, 20]);
    let best = 0;
    for (let i = 1; i <= 500; i++) if ((1 - Math.pow(1 - p / 100, i)) * 100 <= target) best = i;
    return {
      prompt: `Эндпоинт параллельно вызывает k независимых сервисов и ждёт все ответы. Каждый сервис медленнее порога SLO в ${p}% случаев. Эндпоинт должен быть медленнее порога не чаще чем в ${target}% случаев. Какое наибольшее k допустимо?`,
      answerHint: 'наибольшее k',
      answerKey: String(best),
      explanation: `Нужно 1 - (1 - ${p / 100})^k ≤ ${target / 100}; наибольшее такое k равно ${best}.`,
      params: { p, target, kind },
    };
  },
);

const CHANGE_KINDS: { text: string; steps: number }[] = [
  { text: 'переименовать поле', steps: 3 },
  { text: 'сменить тип поля (число на строку)', steps: 3 },
  { text: 'удалить поле из ответа', steps: 2 },
  { text: 'сделать поле обязательным в запросе', steps: 2 },
  { text: 'добавить необязательное поле', steps: 1 },
];
const CHANGE_FIELDS = ['status', 'amount', 'legacyId', 'currency', 'comment', 'phone', 'region', 'channel'];
const CHANGES: { text: string; field: string; steps: number }[] = CHANGE_FIELDS.flatMap((field) => CHANGE_KINDS.map((k) => ({ ...k, field })));

export const apiExpandContract: TaskGenerator = fam(
  { slug: 'api-expand-contract', title: 'Сколько релизов на смену контракта', sub: 'web-api', grade: 'senior', catalogIds: ['be.api-contract', 'be.rest-design'], format: 'number', a: 1.1, b: 1.15, paramSpace: 5e3, timeLimitSec: 270 },
  (seed) => {
    const rng = createRng(seed);
    const fields = rng.sample(CHANGE_FIELDS, rng.int(1, 4));
    const pool = CHANGES.filter((c) => fields.includes(c.field));
    const list = Array.from({ length: rng.int(4, 8) }, () => rng.pick(pool));
    const byField = new Map<string, number>();
    for (const c of list) byField.set(c.field, (byField.get(c.field) ?? 0) + c.steps);
    const total = Math.max(...byField.values());
    return {
      prompt: 'API нужно изменить без поломки клиентов, которые обновляются позже сервера: каждое изменение делается по схеме «расширить - перевести клиентов - сжать», каждый шаг - отдельный релиз. Число релизов на изменение: переименование или смена типа - 3, удаление поля из ответа - 2, новое обязательное поле запроса - 2, необязательное поле - 1. В один релиз можно включить по одному шагу от каждого изменения, но изменения одного и того же поля идут строго друг за другом. Какое минимальное число релизов нужно, чтобы выкатить все изменения?',
      code: list.map((c, i) => `${i + 1}. ${c.text} «${c.field}»`).join('\n'),
      answerHint: 'число релизов',
      answerKey: String(total),
      explanation: `Изменения разных полей идут параллельно, одного поля - последовательно. Суммы шагов по полям: ${[...byField].map(([f, s]) => `${f}: ${s}`).join('; ')}. Минимум - максимум из них: ${total}.`,
      params: { list: list.map((c) => `${c.field}${c.steps}`).join(',') },
    };
  },
);

export const apiSlaChain: TaskGenerator = fam(
  { slug: 'api-sla-chain', title: 'Доступность цепочки сервисов', sub: 'web-api', grade: 'senior', catalogIds: ['be.performance', 'be.distributed-consistency'], format: 'number', a: 1.1, b: 1.0, paramSpace: 1e4, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const { serial, redundant, avail, minutes } = until(
      () => {
        const serial = rng.sample([99.9, 99.5, 99.95, 99.0, 99.99], 3);
        const redundant = rng.pick([99.0, 99.5, 99.9, 98.0]);
        const avail = serial.reduce((p, a) => p * (a / 100), 1) * (1 - Math.pow(1 - redundant / 100, 2));
        return { serial, redundant, avail, minutes: (1 - avail) * 30 * 24 * 60 };
      },
      (v) => notHalf(v.minutes),
    );
    const ans = Math.round(minutes);
    return {
      prompt: `API зависит последовательно от трёх сервисов с доступностью ${serial.join('%, ')}% (все нужны для ответа) и от пары одинаковых независимых реплик хранилища с доступностью ${redundant}% каждая (достаточно одной живой). Отказы независимы. Сколько минут в 30-дневном месяце в среднем будет недоступен API? Округлите до целого.`,
      answerHint: 'минуты, целое',
      answerKey: String(ans),
      explanation: `Последовательные звенья перемножаются, пара реплик даёт 1 - (1 - ${redundant / 100})^2. Итоговая доступность ≈ ${(avail * 100).toFixed(4)}%, простой ${minutes.toFixed(1)} мин, округляем до ${ans}.`,
      params: { serial: serial.join(','), redundant },
    };
  },
);

const ROLE_DEFS: Record<string, { inherits: string[]; allow: string[] }> = {
  viewer: { inherits: [], allow: ['read'] },
  editor: { inherits: ['viewer'], allow: ['write'] },
  admin: { inherits: ['editor'], allow: ['delete'] },
  auditor: { inherits: ['viewer'], allow: ['export'] },
};

export const apiRbacInherit: TaskGenerator = fam(
  { slug: 'api-rbac-inherit', title: 'Права с наследованием ролей и запретами', sub: 'web-api', grade: 'senior', catalogIds: ['be.authz', 'common.security-basics'], format: 'number', a: 1.2, b: 1.05, paramSpace: 5e5, timeLimitSec: 270 },
  (seed) => {
    const rng = createRng(seed);
    const perms = ['read', 'write', 'delete', 'export'];
    const denies: Record<string, string[]> = { viewer: [], editor: [], admin: [], auditor: [] };
    denies[rng.pick(['editor', 'auditor'])] = [rng.pick(['write', 'export', 'read'])];
    if (rng.int(0, 1)) denies['admin'] = [rng.pick(['export', 'write'])];
    const users = ['u1', 'u2', 'u3'].map((u) => ({ u, roles: rng.sample(Object.keys(ROLE_DEFS), rng.int(1, 2)) }));
    const effective = (role: string): Set<string> => {
      const s = new Set(ROLE_DEFS[role]!.allow);
      for (const p of ROLE_DEFS[role]!.inherits) for (const x of effective(p)) s.add(x);
      return s;
    };
    const denied = (role: string): Set<string> => {
      const s = new Set(denies[role]!);
      for (const p of ROLE_DEFS[role]!.inherits) for (const x of denied(p)) s.add(x);
      return s;
    };
    const reqs = Array.from({ length: 14 }, () => ({ user: rng.pick(users), perm: rng.pick(perms) }));
    let allowed = 0;
    for (const r of reqs) {
      const allow = new Set<string>();
      const deny = new Set<string>();
      for (const role of r.user.roles) {
        for (const x of effective(role)) allow.add(x);
        for (const x of denied(role)) deny.add(x);
      }
      if (allow.has(r.perm) && !deny.has(r.perm)) allowed++;
    }
    const roleLine = Object.entries(ROLE_DEFS).map(([r, d]) => `${r}: разрешает ${d.allow.join(', ')}${d.inherits.length ? `; наследует ${d.inherits.join(', ')}` : ''}${denies[r]!.length ? `; запрещает ${denies[r]!.join(', ')}` : ''}`);
    return {
      prompt: 'Права вычисляются так: у пользователя может быть несколько ролей; роль даёт свои права плюс права унаследованных ролей (транзитивно); запрет (deny) роли - собственный или унаследованный - перекрывает любое разрешение у любой из ролей пользователя. Сколько из четырнадцати запросов будет разрешено?',
      code: [...roleLine, '', ...users.map((u) => `${u.u}: роли ${u.roles.join(', ')}`), '', ...reqs.map((r, i) => `${i + 1}. ${r.user.u} -> ${r.perm}`)].join('\n'),
      answerHint: 'число разрешённых запросов',
      answerKey: String(allowed),
      explanation: `Для каждого запроса собираем разрешения по всем ролям пользователя с наследованием и вычитаем запреты. Разрешено ${allowed}.`,
      params: { users: users.map((u) => u.roles.join('+')).join(','), denies: JSON.stringify(denies) },
    };
  },
);

export const WEBAPI_BANK2: TaskGenerator[] = [
  apiTestAsserts,
  apiErrorCodes,
  apiQueryResult,
  apiTestSharedState,
  apiMergePatch,
  apiAcceptHeader,
  apiMiddlewareOrder,
  apiCorsPreflight,
  apiFanoutTail,
  apiExpandContract,
  apiSlaChain,
  apiRbacInherit,
];
