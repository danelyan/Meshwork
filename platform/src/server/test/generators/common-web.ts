// Общие семейства: HTTP, безопасность, регулярные выражения (ADR 0003, дополнение 11.10). a, b – ПРЕДЛОЖЕНИЕ (экспертные).
import { createRng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';

import { commonFamily, numbers } from './common-util';

const PATHS = ['/orders', '/users/42', '/cart/items', '/payments/7', '/profile', '/reports/q3'];

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const METHODS: { m: string; idempotent: boolean; safe: boolean }[] = [
  { m: 'GET', idempotent: true, safe: true },
  { m: 'HEAD', idempotent: true, safe: true },
  { m: 'OPTIONS', idempotent: true, safe: true },
  { m: 'PUT', idempotent: true, safe: false },
  { m: 'DELETE', idempotent: true, safe: false },
  { m: 'POST', idempotent: false, safe: false },
  { m: 'PATCH', idempotent: false, safe: false },
];

export const httpMethodProps: TaskGenerator = commonFamily({
  id: 'cm.http-method-props',
  competency: 'common.http',
  title: 'Безопасные и идемпотентные методы',
  specialization: 'backend',
  grade: 'junior',
  catalogIds: ['common.http'],
  format: 'list',
  a: 1.1,
  b: -1.0,
  paramSpace: 1e6,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const prop = rng.int(0, 1) === 0 ? 'idempotent' : 'safe';
    let reqs = Array.from({ length: rng.int(5, 6) }, () => ({ ...rng.pick(METHODS), path: rng.pick(PATHS) }));
    if (!reqs.some((r) => r[prop])) reqs = [...reqs.slice(1), { ...METHODS[0]!, path: rng.pick(PATHS) }];
    if (reqs.every((r) => r[prop])) reqs = [...reqs.slice(1), { ...METHODS[5]!, path: rng.pick(PATHS) }];
    const key = reqs.flatMap((r, i) => (r[prop] ? [i + 1] : []));
    return {
      prompt:
        prop === 'idempotent'
          ? 'Какие запросы идемпотентны по семантике HTTP (RFC 9110): повтор того же запроса не меняет итоговое состояние сервера сверх первого? Укажите номера.'
          : 'Какие запросы безопасны по семантике HTTP (RFC 9110): по смыслу только читают и не должны менять состояние сервера? Укажите номера.',
      code: reqs.map((r, i) => `${i + 1}. ${r.m} ${r.path}`).join('\n'),
      answerHint: 'номера через запятую',
      answerKey: numbers(key),
      explanation:
        prop === 'idempotent'
          ? 'Идемпотентны GET, HEAD, OPTIONS, PUT, DELETE; POST и PATCH – нет (их повтор может создать или изменить ресурс ещё раз).'
          : 'Безопасны GET, HEAD, OPTIONS (и TRACE); PUT и DELETE идемпотентны, но не безопасны.',
      params: { prop, methods: reqs.map((r) => r.m) },
    };
  },
});

export const httpCacheOrigin: TaskGenerator = commonFamily({
  id: 'cm.http-cache-origin',
  competency: 'common.http',
  title: 'Сколько запросов дойдёт до сервера при кэшировании',
  specialization: 'backend',
  grade: 'middle',
  catalogIds: ['common.http'],
  format: 'number',
  a: 1.2,
  b: 0.5,
  paramSpace: 1e8,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const mode = rng.int(0, 5);
    const maxAge = rng.pick([30, 60, 120, 300]);
    const header = mode === 4 ? 'Cache-Control: no-store' : mode === 5 ? 'Cache-Control: no-cache' : `Cache-Control: max-age=${maxAge}`;
    const times: number[] = [];
    let t = 0;
    const count = rng.int(5, 8);
    for (let i = 0; i < count; i++) {
      times.push(t);
      t += rng.int(1, Math.round((maxAge * 1.6) / 10)) * 10;
    }
    let origin = 0;
    let fetchedAt = -Infinity;
    for (const at of times) {
      if (mode >= 4 || at - fetchedAt >= maxAge) {
        origin++;
        fetchedAt = at;
      }
    }
    return {
      prompt: [
        `Браузер запрашивает GET /api/catalog в моменты времени (секунды) ниже. Сервер на каждый ответ 200 ставит заголовок «${header}», ETag нет. Других кэшей нет, кэш браузера изначально пуст, часы точные; ответ свеж, пока его возраст строго меньше max-age.`,
        'Сколько запросов дойдёт до сервера (включая запросы на перепроверку)?',
      ].join('\n'),
      code: `t = ${times.join(', ')}`,
      answerHint: 'число запросов',
      answerKey: String(origin),
      explanation:
        mode === 4
          ? 'no-store запрещает сохранять ответ: каждый запрос идёт на сервер.'
          : mode === 5
            ? 'no-cache разрешает хранить, но требует перепроверки у сервера перед каждым использованием: каждый запрос доходит до сервера.'
            : `Ответ свеж, пока его возраст меньше ${maxAge} с; запрос в момент, когда возраст ≥ ${maxAge}, идёт на сервер и обновляет копию.`,
      params: { mode, maxAge, times },
    };
  },
});

export const idempotencyKey: TaskGenerator = commonFamily({
  id: 'cm.idempotency-key',
  competency: 'common.http',
  title: 'Повторы платежа с ключом идемпотентности',
  specialization: 'backend',
  grade: 'senior',
  catalogIds: ['common.http'],
  format: 'number',
  a: 1.2,
  b: 1.2,
  paramSpace: 1e8,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ttl = rng.pick([10, 15, 30]);
    const keys = ['k1', 'k2', 'k3'];
    const bodies = ['amount=500', 'amount=700', 'amount=900'];
    const events: { t: number; key: string | null; body: string }[] = [];
    let t = 0;
    const total = rng.int(6, 8);
    for (let i = 0; i < total; i++) {
      const prev = events.length > 0 && rng.int(0, 2) > 0 ? rng.pick(events) : null;
      const noKey = rng.int(0, 7) === 0;
      const key = noKey ? null : prev?.key ?? rng.pick(keys);
      const sameBody = prev !== null && rng.int(0, 4) > 0;
      const body = sameBody ? prev.body : rng.pick(bodies);
      events.push({ t, key, body });
      t += rng.pick([1, 2, 5, 8, 12]);
    }
    const store = new Map<string, { at: number; body: string }>();
    let charges = 0;
    const lines: string[] = [];
    for (const e of events) {
      lines.push(`${String(e.t).padStart(2)} мин  POST /payments  ${e.key ? `Idempotency-Key: ${e.key}` : '(без ключа)'}  ${e.body}`);
      if (!e.key) {
        charges++;
        continue;
      }
      const saved = store.get(e.key);
      if (saved && e.t - saved.at < ttl) continue; // повтор (тот же ответ) или 422 при другом теле – без списания
      store.set(e.key, { at: e.t, body: e.body });
      charges++;
    }
    return {
      prompt: [
        'Платёжный API обрабатывает POST /payments так:',
        `• ключ Idempotency-Key хранится ${ttl} мин с момента первой обработки; повтор с тем же ключом в этот срок возвращает сохранённый ответ без нового списания;`,
        '• тот же ключ с другим телом в этот срок – ответ 422 без списания;',
        '• после истечения срока ключ забыт, запрос обрабатывается как новый; запрос без ключа всегда списывает.',
        'Клиент отправил запросы ниже (часть – повторы после таймаута). Сколько списаний произойдёт?',
      ].join('\n'),
      code: lines.join('\n'),
      answerHint: 'число списаний',
      answerKey: String(charges),
      explanation: `Списание – при первом ключе, при ключе после ${ttl} мин и при каждом запросе без ключа; повторы и конфликтующие тела в срок хранения не списывают.`,
      params: { ttl, events: events.length },
    };
  },
});

// ---------------------------------------------------------------------------
// Безопасность
// ---------------------------------------------------------------------------

const SAFE_QUERIES = [
  "cur.execute('SELECT * FROM users WHERE id = %s', (user_id,))",
  "db.query('SELECT * FROM orders WHERE owner = $1', [ownerId])",
  "cur.execute('UPDATE carts SET qty = %s WHERE id = %s', (qty, cart_id))",
  "db.query('DELETE FROM sessions WHERE token = $1', [token])",
  "stmt = conn.prepare('SELECT name FROM items WHERE sku = ?'); stmt.get(sku)",
];
const UNSAFE_QUERIES = [
  "cur.execute(f\"SELECT * FROM users WHERE email = '{email}'\")",
  "db.query('SELECT * FROM orders WHERE status = \\'' + req.query.status + '\\'')",
  "cur.execute('SELECT * FROM goods WHERE title LIKE \\'%' + q + '%\\'')",
  'db.query(`SELECT * FROM logs WHERE level = ${req.query.level}`)',
  "cur.execute(\"DELETE FROM tokens WHERE user = '%s'\" % username)",
];

export const sqlInjectionLine: TaskGenerator = commonFamily({
  id: 'cm.sql-injection-line',
  competency: 'common.security',
  title: 'Строка с SQL-инъекцией',
  specialization: 'backend',
  grade: 'junior',
  catalogIds: ['common.security-basics'],
  format: 'line',
  a: 1.2,
  b: -0.8,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const safe = rng.sample(SAFE_QUERIES, rng.int(3, 4));
    const bad = rng.pick(UNSAFE_QUERIES);
    const pos = rng.int(0, safe.length);
    const lines = [...safe.slice(0, pos), bad, ...safe.slice(pos)];
    return {
      prompt: 'Значения email, status, q, level, username, user_id, ownerId, qty, cart_id, token, sku приходят от пользователя. В какой строке SQL-инъекция?',
      code: lines.join('\n'),
      answerHint: 'номер строки',
      answerKey: String(pos + 1),
      explanation: 'Уязвима строка, где пользовательский ввод вклеен в текст запроса (конкатенация, f-строка, шаблон, %); в остальных значения передаются параметрами.',
      params: { pos, bad: UNSAFE_QUERIES.indexOf(bad) },
    };
  },
});

const REQUEST_KINDS: { text: string; sameSite: boolean; topGet: boolean }[] = [
  { text: 'пользователь на bank.example нажимает ссылку на другую страницу bank.example', sameSite: true, topGet: true },
  { text: 'страница bank.example делает fetch к https://bank.example/api/balance', sameSite: true, topGet: false },
  { text: 'форма на bank.example отправляет POST на bank.example/transfer', sameSite: true, topGet: false },
  { text: 'пользователь на news.example нажимает ссылку https://bank.example/offers (переход в той же вкладке)', sameSite: false, topGet: true },
  { text: 'страница evil.example автоматически отправляет форму POST на https://bank.example/transfer', sameSite: false, topGet: false },
  { text: 'страница evil.example вставляет <img src="https://bank.example/avatar.png">', sameSite: false, topGet: false },
  { text: 'страница blog.example встраивает <iframe src="https://bank.example/widget">', sameSite: false, topGet: false },
  { text: 'страница shop.example делает fetch к https://bank.example/api/rates с credentials: "include"', sameSite: false, topGet: false },
];

export const sameSiteCookies: TaskGenerator = commonFamily({
  id: 'cm.samesite-cookie',
  competency: 'common.security',
  title: 'Какие запросы понесут cookie с SameSite',
  specialization: 'backend',
  grade: 'middle',
  catalogIds: ['common.security-basics'],
  format: 'list',
  a: 1.2,
  b: 0.6,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const mode = rng.pick(['Strict', 'Lax', 'Lax', 'None']);
    const same = rng.sample(REQUEST_KINDS.filter((r) => r.sameSite), rng.int(1, 2));
    const cross = rng.sample(REQUEST_KINDS.filter((r) => !r.sameSite), rng.int(3, 4));
    const reqs = rng.shuffle([...same, ...cross]);
    const sends = (r: (typeof REQUEST_KINDS)[number]) => r.sameSite || mode === 'None' || (mode === 'Lax' && r.topGet);
    return {
      prompt: [
        `Сайт https://bank.example при входе ставит cookie: «Set-Cookie: session=…; Secure; HttpOnly; SameSite=${mode}» (атрибут указан явно). Пользователь вошёл. В каких запросах браузер приложит эту cookie?`,
        'Считайте, что сторонние cookie не блокируются настройками браузера. Укажите номера.',
      ].join('\n'),
      code: reqs.map((r, i) => `${i + 1}. ${r.text}`).join('\n'),
      answerHint: 'номера через запятую',
      answerKey: numbers(reqs.flatMap((r, i) => (sends(r) ? [i + 1] : []))),
      explanation:
        mode === 'Strict'
          ? 'Strict: cookie только в запросах, инициированных с того же сайта.'
          : mode === 'Lax'
            ? 'Lax: тот же сайт плюс переходы верхнего уровня безопасным методом (GET-ссылка) с другого сайта; кросс-сайтовые POST, картинки, iframe и fetch – без cookie.'
            : 'None (с Secure): cookie во всех запросах, включая кросс-сайтовые – защита от CSRF ложится на токены.',
      params: { mode, n: reqs.length },
    };
  },
});

export const jwtValidation: TaskGenerator = commonFamily({
  id: 'cm.jwt-validation',
  competency: 'common.security',
  title: 'Какие JWT примет сервер',
  specialization: 'backend',
  grade: 'senior',
  catalogIds: ['common.security-basics', 'common.auth-flow'],
  format: 'list',
  a: 1.2,
  b: 1.2,
  paramSpace: 1e8,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const now = rng.int(1_700_000_000, 1_800_000_000);
    const good = () => ({ alg: 'RS256', sig: 'верна', iss: 'https://id.example', aud: 'orders-api', exp: now + rng.int(60, 3600), nbf: now - rng.int(0, 600) });
    type Tok = ReturnType<typeof good>;
    const defects: ((t: Tok) => Tok)[] = [
      (t) => ({ ...t, alg: 'none', sig: '–' }),
      (t) => ({ ...t, alg: 'HS256', sig: 'верна (ключ – публичный ключ RS256)' }),
      (t) => ({ ...t, sig: 'не сходится' }),
      (t) => ({ ...t, exp: now - rng.int(1, 600) }),
      (t) => ({ ...t, nbf: now + rng.int(60, 600) }),
      (t) => ({ ...t, aud: 'billing-api' }),
      (t) => ({ ...t, iss: 'https://id.example.evil' }),
    ];
    const n = rng.int(5, 6);
    const okCount = rng.int(1, 2);
    const toks = rng.shuffle([...Array.from({ length: okCount }, () => ({ t: good(), ok: true })), ...rng.sample(defects, n - okCount).map((d) => ({ t: d(good()), ok: false }))]);
    return {
      prompt: [
        `Сервис orders-api проверяет JWT: разрешён только alg RS256 (ключ издателя), подпись, iss = https://id.example, aud содержит orders-api, exp > now, nbf ≤ now. Сейчас now = ${now} (Unix-время). Какие токены будут приняты?`,
      ].join('\n'),
      code: toks.map(({ t }, i) => `${i + 1}. alg=${t.alg}; подпись: ${t.sig}; iss=${t.iss}; aud=${t.aud}; exp=${t.exp}; nbf=${t.nbf}`).join('\n'),
      answerHint: 'номера через запятую',
      answerKey: numbers(toks.flatMap((x, i) => (x.ok ? [i + 1] : []))),
      explanation: 'Отклоняются: alg=none и подмена алгоритма (HS256 с публичным ключом), неверная подпись, истёкший exp, будущий nbf, чужая аудитория и чужой издатель.',
      params: { n, okCount, now },
    };
  },
});

// ---------------------------------------------------------------------------
// Регулярные выражения (синтаксис JavaScript; ключ считает сам RegExp)
// ---------------------------------------------------------------------------

const REGEX_CASES: { re: string; what: string; valid: string[]; invalid: string[] }[] = [
  { re: '^\\d{3}-\\d{2}-\\d{2}$', what: 'номер вида 123-45-67', valid: ['123-45-67', '900-00-12', '555-12-34'], invalid: ['12-345-67', '1234-56-7', '123-45-678', '123 45 67', 'abc-de-fg'] },
  { re: '^[A-Z][a-z]+$', what: 'слово с заглавной буквы (латиница)', valid: ['Anna', 'Boris', 'Kazan'], invalid: ['anna', 'ANNA', 'A', 'Anna1', 'An na'] },
  { re: '^#[0-9a-fA-F]{6}$', what: 'цвет #RRGGBB', valid: ['#1a2B3c', '#FFFFFF', '#00ff00'], invalid: ['#FFF', '1a2b3c', '#GG0000', '#1a2b3c4', '# 1a2b3c'] },
  { re: '^\\d+(\\.\\d{1,2})?$', what: 'сумма с не более чем двумя знаками после точки', valid: ['10', '0.5', '199.99'], invalid: ['.5', '10.', '1.234', '1,50', '-3'] },
  { re: '^[a-z0-9._]+@[a-z]+\\.(ru|com)$', what: 'простая почта на .ru или .com', valid: ['a.b@mail.ru', 'dev_1@site.com', 'x@y.ru'], invalid: ['a@b.org', 'A@mail.ru', '@mail.ru', 'a@mail.ru.', 'a b@mail.ru'] },
];

export const regexMatchCount: TaskGenerator = commonFamily({
  id: 'cm.regex-match-count',
  competency: 'common.regex',
  title: 'Сколько строк подходит под шаблон',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['common.debugging'],
  format: 'number',
  a: 1.1,
  b: -0.6,
  paramSpace: 1e6,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const c = rng.pick(REGEX_CASES);
    const strings = rng.shuffle([...rng.sample(c.valid, rng.int(1, 3)), ...rng.sample(c.invalid, rng.int(3, 4))]);
    const re = new RegExp(c.re);
    const key = strings.filter((s) => re.test(s)).length;
    return {
      prompt: `Шаблон (JavaScript, без флагов) задуман как «${c.what}». Для скольких строк re.test(s) вернёт true?`,
      code: [`const re = /${c.re}/;`, ...strings.map((s) => `re.test(${JSON.stringify(s)})`)].join('\n'),
      answerHint: 'число строк',
      answerKey: String(key),
      explanation: `^ и $ привязывают шаблон ко всей строке; подходят: ${strings.filter((s) => re.test(s)).join(', ') || 'нет'}.`,
      params: { re: c.re, strings },
    };
  },
});

const CAPTURE_CASES: { re: string; make: (r: ReturnType<typeof createRng>) => string }[] = [
  {
    re: '\\bid=(\\d+)',
    make: (r) => r.shuffle([`id=${r.int(1, 99)}`, `uid=${r.int(1, 99)}`, `id=${r.int(100, 999)}`, `id=x${r.int(1, 9)}`, `pid=${r.int(1, 9)}`, `id=${r.int(1, 9)}`]).join('; '),
  },
  {
    re: '(\\d+)px',
    make: (r) => `margin: ${r.int(1, 30)}px ${r.int(0, 9)}em ${r.int(1, 30)}px; width: ${r.int(10, 99)}%; top: ${r.int(1, 50)}px`,
  },
  {
    re: '\\b([A-Z]{2,3})-\\d+',
    make: (r) => r.shuffle([`${r.pick(['FE', 'BE', 'OPS'])}-${r.int(1, 99)}`, `x${r.pick(['AB', 'QA'])}-${r.int(1, 9)}`, `${r.pick(['DEV', 'QA'])}-${r.int(100, 999)}`, `abc-${r.int(1, 9)}`, `ABCD-${r.int(1, 9)}`]).join(' '),
  },
  {
    re: 'key=(\\w+)',
    make: (r) => r.shuffle([`key=${r.pick(['alpha', 'beta', 'gamma'])}`, `mykey=${r.pick(['one', 'two'])}`, `key=${r.int(10, 99)}`, `key= ${r.pick(['x', 'y'])}`, `KEY=${r.pick(['up', 'down'])}`]).join('&'),
  },
];

export const regexCaptures: TaskGenerator = commonFamily({
  id: 'cm.regex-captures',
  competency: 'common.regex',
  title: 'Что захватит группа регулярного выражения',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['common.debugging'],
  format: 'text',
  a: 1.2,
  b: 0.5,
  paramSpace: 1e7,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    let c = rng.pick(CAPTURE_CASES);
    let text = c.make(rng);
    let got = [...text.matchAll(new RegExp(c.re, 'g'))].map((m) => m[1]!);
    while (got.length === 0) {
      c = rng.pick(CAPTURE_CASES);
      text = c.make(rng);
      got = [...text.matchAll(new RegExp(c.re, 'g'))].map((m) => m[1]!);
    }
    return {
      prompt: 'Что выведет код (JavaScript)? Ответ – значения через запятую, в порядке вывода.',
      code: [`const text = ${JSON.stringify(text)};`, `for (const m of text.matchAll(/${c.re}/g)) console.log(m[1]);`].join('\n'),
      answerHint: 'значения через запятую, по порядку',
      answerKey: got.join(','),
      explanation: 'matchAll с флагом g перебирает все непересекающиеся совпадения слева направо; m[1] – первая группа. \\b – граница слова, регистр учитывается.',
      params: { re: c.re, text },
    };
  },
});

export const regexGreedy: TaskGenerator = commonFamily({
  id: 'cm.regex-greedy',
  competency: 'common.regex',
  title: 'Жадные и ленивые квантификаторы',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['common.debugging'],
  format: 'number',
  a: 1.1,
  b: 1.0,
  paramSpace: 1e6,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const words = ['ok', 'id', 'x', 'name', 'v2', 'go'];
    const kind = rng.int(0, 2);
    let text: string;
    let re: string;
    if (kind === 0) {
      const tags = Array.from({ length: rng.int(2, 3) }, () => rng.pick(['b', 'i', 'em', 'span']));
      text = tags.map((t) => `<${t}>${rng.pick(words)}</${t}>`).join(rng.pick([' и ', ', ', ' ']));
      re = rng.pick(['<.+>', '<.+?>', '<[^>]+>', '<.*?>']);
    } else if (kind === 1) {
      text = Array.from({ length: rng.int(2, 4) }, () => `"${rng.pick(words)}"`).join(rng.pick([' = ', ', ', ' ']));
      re = rng.pick(['".*"', '".*?"', '"[^"]*"']);
    } else {
      text = Array.from({ length: rng.int(2, 3) }, () => String(rng.int(1, 999))).join(rng.pick([' ', '-', 'a']));
      re = rng.pick(['\\d+', '\\d+?', '\\d*', '\\d{2}']);
    }
    const ask = rng.int(0, 1) === 0 ? 'count' : 'first';
    const ms = text.match(new RegExp(re, 'g')) ?? [];
    const key = ask === 'count' ? ms.length : (ms[0] ?? '').length;
    return {
      prompt:
        ask === 'count'
          ? 'Сколько элементов в массиве, который вернёт text.match(re) (JavaScript)? Если вернётся null – ответьте 0.'
          : 'Какой длины (в символах) первое совпадение text.match(re)[0] (JavaScript)? Если совпадений нет – 0.',
      code: [`const text = ${JSON.stringify(text)};`, `const re = /${re}/g;`].join('\n'),
      answerHint: 'число',
      answerKey: String(key),
      explanation: `Совпадения: ${ms.map((m) => JSON.stringify(m)).join(', ') || 'нет'}. Жадный квантификатор (+, *) захватывает максимум и откатывается; ленивый (+?, *?) – минимум; \\d* даёт и пустые совпадения.`,
      params: { kind, re, ask },
    };
  },
});

export const COMMON_WEB_GENERATORS: readonly TaskGenerator[] = [httpMethodProps, httpCacheOrigin, idempotencyKey, sqlInjectionLine, sameSiteCookies, jwtValidation, regexMatchCount, regexCaptures, regexGreedy];
