// Общие семейства: SQL, алгоритмы, структуры данных (ADR 0003, дополнение 11.10). a, b — ПРЕДЛОЖЕНИЕ (экспертные):
// Junior b ≤ −0,4, Middle b 0,3…0,8, Senior b 1,0…1,7, a 1,0…1,4 — как у семейств подкатегорий.
import { createRng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';

import { commonFamily, table } from './common-util';

const REGIONS = ['Север', 'Юг', 'Центр', 'Урал'];

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

export const sqlAggregate: TaskGenerator = commonFamily({
  id: 'cm.sql-aggregate',
  competency: 'common.sql',
  title: 'Результат агрегатного запроса',
  specialization: 'backend',
  grade: 'junior',
  catalogIds: ['common.sql-queries'],
  format: 'number',
  a: 1.2,
  b: -0.9,
  paramSpace: 1e8,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const regions = rng.sample(REGIONS, 3);
    const n = rng.int(6, 9);
    const rows = Array.from({ length: n }, (_, i) => ({ id: i + 1, region: regions[i % 3]!, amount: rng.int(0, 5) === 0 ? null : rng.int(1, 20) * 10 }));
    const shuffled = rng.shuffle(rows).map((r, i) => ({ ...r, id: i + 1 }));
    const amounts = (pred: (r: (typeof rows)[number]) => boolean) => shuffled.filter(pred).flatMap((r) => (r.amount === null ? [] : [r.amount]));
    const kind = rng.int(0, 3);
    const reg = rng.pick(regions);
    const t = rng.int(4, 15) * 10;
    let sql: string;
    let key: number;
    let explanation: string;
    if (kind === 0) {
      sql = `SELECT SUM(amount) FROM sales WHERE region = '${reg}';`;
      key = amounts((r) => r.region === reg).reduce((s, x) => s + x, 0);
      explanation = 'SUM складывает значения подходящих строк и пропускает NULL.';
    } else if (kind === 1) {
      sql = `SELECT COUNT(DISTINCT region) FROM sales WHERE amount >= ${t};`;
      key = new Set(shuffled.filter((r) => r.amount !== null && r.amount >= t).map((r) => r.region)).size;
      explanation = 'COUNT(DISTINCT) считает разные значения; строка с NULL в amount условию не удовлетворяет.';
    } else if (kind === 2) {
      sql = `SELECT COUNT(amount) FROM sales WHERE region <> '${reg}';`;
      key = amounts((r) => r.region !== reg).length;
      explanation = 'COUNT(столбец) не считает NULL, в отличие от COUNT(*).';
    } else {
      sql = `SELECT COUNT(*) FROM (\n  SELECT region FROM sales GROUP BY region HAVING SUM(amount) > ${t * 2}\n) t;`;
      key = regions.filter((g) => amounts((r) => r.region === g).reduce((s, x) => s + x, 0) > t * 2).length;
      explanation = 'GROUP BY даёт строку на регион, HAVING оставляет регионы с суммой выше порога (NULL в сумму не входит), внешний COUNT(*) считает их.';
    }
    return {
      prompt: 'Дана таблица sales и запрос (PostgreSQL). Какое число он вернёт? Если результат NULL, ответьте 0.',
      code: [table('sales', ['id', 'region', 'amount'], shuffled.map((r) => [r.id, r.region, r.amount ?? 'NULL'])), '', sql].join('\n'),
      answerHint: 'число',
      answerKey: String(key),
      explanation,
      params: { kind, n, t },
    };
  },
});

export const sqlJoinMultiplicity: TaskGenerator = commonFamily({
  id: 'cm.sql-join-rows',
  competency: 'common.sql',
  title: 'Число строк соединения с повторами ключей',
  specialization: 'backend',
  grade: 'middle',
  catalogIds: ['common.sql-queries'],
  format: 'number',
  a: 1.2,
  b: 0.5,
  paramSpace: 1e8,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const keys = () => Array.from({ length: rng.int(4, 6) }, () => (rng.int(0, 6) === 0 ? null : rng.int(1, 4)));
    const a = keys();
    const b = keys();
    const matches = (k: number | null, other: (number | null)[]) => (k === null ? 0 : other.filter((x) => x === k).length);
    const kind = rng.int(0, 3);
    const joins = [
      { sql: 'SELECT COUNT(*) FROM a JOIN b ON a.k = b.k;', count: a.reduce<number>((s, k) => s + matches(k, b), 0), why: 'INNER JOIN даёт строку на каждую пару совпавших ключей: повторы перемножаются, NULL не равен ничему.' },
      { sql: 'SELECT COUNT(*) FROM a LEFT JOIN b ON a.k = b.k;', count: a.reduce<number>((s, k) => s + Math.max(1, matches(k, b)), 0), why: 'LEFT JOIN: каждая строка a столько раз, сколько у неё пар в b, и один раз, если пар нет.' },
      {
        sql: 'SELECT COUNT(*) FROM a FULL JOIN b ON a.k = b.k;',
        count: a.reduce<number>((s, k) => s + Math.max(1, matches(k, b)), 0) + b.filter((k) => matches(k, a) === 0).length,
        why: 'FULL JOIN = пары совпавших ключей + строки a без пары + строки b без пары.',
      },
      { sql: 'SELECT COUNT(*) FROM a LEFT JOIN b ON a.k = b.k WHERE b.k IS NULL;', count: a.filter((k) => matches(k, b) === 0).length, why: 'После LEFT JOIN условие b.k IS NULL оставляет строки a без пары (включая a.k = NULL).' },
    ][kind]!;
    const show = (xs: (number | null)[]) => xs.map((k) => [k ?? 'NULL']);
    return {
      prompt: 'Даны таблицы a(k) и b(k), в ключах есть повторы и NULL. Сколько строк насчитает запрос?',
      code: [table('a', ['k'], show(a)), '', table('b', ['k'], show(b)), '', joins.sql].join('\n'),
      answerHint: 'число строк',
      answerKey: String(joins.count),
      explanation: joins.why,
      params: { kind, a, b },
    };
  },
});

export const sqlNotInNull: TaskGenerator = commonFamily({
  id: 'cm.sql-anti-join',
  competency: 'common.sql',
  title: 'Анти-соединение при NULL в подзапросе',
  specialization: 'backend',
  grade: 'senior',
  catalogIds: ['common.sql-queries'],
  format: 'number',
  a: 1.2,
  b: 1.1,
  paramSpace: 1e7,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = rng.int(5, 8);
    const ids: number[] = [];
    for (let i = 0, id = rng.int(10, 20); i < n; i++, id += rng.int(1, 4)) ids.push(id);
    const blockedIds = rng.sample(ids, rng.int(1, 3));
    const hasNull = rng.int(0, 9) < 6;
    const blocked: (number | null)[] = rng.shuffle([...blockedIds, ...(hasNull ? [null] : []), ...(rng.int(0, 1) ? [999] : [])]);
    const matched = ids.filter((id) => blockedIds.includes(id)).length;
    const kind = rng.int(0, 9) < 5 ? 0 : rng.int(1, 3);
    const queries = [
      { sql: 'SELECT COUNT(*) FROM customers\nWHERE id NOT IN (SELECT customer_id FROM blocked);', key: hasNull ? 0 : n - matched },
      { sql: 'SELECT COUNT(*) FROM customers c\nWHERE NOT EXISTS (SELECT 1 FROM blocked b WHERE b.customer_id = c.id);', key: n - matched },
      { sql: 'SELECT COUNT(*) FROM customers\nWHERE id IN (SELECT customer_id FROM blocked);', key: matched },
      { sql: 'SELECT COUNT(*) FROM customers c\nLEFT JOIN blocked b ON b.customer_id = c.id\nWHERE b.customer_id IS NULL;', key: n - matched },
    ];
    const q = queries[kind]!;
    const why =
      kind === 0
        ? hasNull
          ? 'NOT IN со списком, где есть NULL, никогда не даёт TRUE: id <> NULL — UNKNOWN, и запрос возвращает 0. Анти-соединение пишут через NOT EXISTS.'
          : 'NULL в подзапросе нет, NOT IN работает как анти-соединение: клиенты минус заблокированные.'
        : 'NOT EXISTS, IN и LEFT JOIN … IS NULL не ломаются от NULL в blocked: NULL просто ни с чем не совпадает.';
    return {
      prompt: 'Даны таблицы customers и blocked (PostgreSQL). Сколько вернёт запрос?',
      code: [table('customers', ['id'], ids.map((id) => [id])), '', table('blocked', ['customer_id'], blocked.map((k) => [k ?? 'NULL'])), '', q.sql].join('\n'),
      answerHint: 'число',
      answerKey: String(q.key),
      explanation: why,
      params: { kind, n, hasNull },
    };
  },
});

// ---------------------------------------------------------------------------
// Алгоритмы и сложность
// ---------------------------------------------------------------------------

export const binarySearchSteps: TaskGenerator = commonFamily({
  id: 'cm.binary-search-steps',
  competency: 'common.algorithms',
  title: 'Шаги бинарного поиска',
  specialization: 'backend',
  grade: 'junior',
  catalogIds: ['common.algo-complexity'],
  format: 'number',
  a: 1.1,
  b: -0.6,
  paramSpace: 1e8,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = rng.int(7, 15);
    const arr: number[] = [];
    let v = rng.int(1, 9);
    for (let i = 0; i < n; i++) {
      arr.push(v);
      v += rng.int(1, 6);
    }
    const absent = Array.from({ length: arr[n - 1]! - arr[0]! + 5 }, (_, i) => arr[0]! - 2 + i).filter((v) => !arr.includes(v));
    const target = rng.int(0, 2) > 0 ? rng.pick(arr) : rng.pick(absent);
    let lo = 0;
    let hi = n - 1;
    let steps = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      steps++;
      if (arr[mid] === target) break;
      if (arr[mid]! < target) lo = mid + 1;
      else hi = mid - 1;
    }
    const code = [
      `a = [${arr.join(', ')}]`,
      `x = ${target}`,
      'lo, hi, steps = 0, len(a) - 1, 0',
      'while lo <= hi:',
      '    mid = (lo + hi) // 2',
      '    steps += 1',
      '    if a[mid] == x:',
      '        break',
      '    if a[mid] < x:',
      '        lo = mid + 1',
      '    else:',
      '        hi = mid - 1',
      'print(steps)',
    ].join('\n');
    return {
      prompt: 'Что напечатает программа (Python)? Посчитайте итерации цикла бинарного поиска.',
      code,
      answerHint: 'число',
      answerKey: String(steps),
      explanation: `Каждая итерация сравнивает a[mid] и сужает [lo; hi] вдвое; для x = ${target} понадобилось ${steps} итераций (не больше ⌊log₂ ${n}⌋ + 1 = ${Math.floor(Math.log2(n)) + 1}).`,
      params: { n, target, present: arr.includes(target) },
    };
  },
});

export const loopCount: TaskGenerator = commonFamily({
  id: 'cm.loop-count',
  competency: 'common.algorithms',
  title: 'Сколько раз выполнится операция',
  specialization: 'backend',
  grade: 'middle',
  catalogIds: ['common.algo-complexity'],
  format: 'number',
  a: 1.2,
  b: 0.4,
  paramSpace: 1e6,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const kind = rng.int(0, 3);
    const n = rng.int(6, 40);
    const k = rng.int(2, 4);
    let count = 0;
    let code: string;
    let why: string;
    if (kind === 0) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) count++;
      code = `n = ${n}\nfor i in range(n):\n    for j in range(i + 1, n):\n        op()`;
      why = `Пары i < j: n·(n−1)/2 = ${count}. Это O(n²).`;
    } else if (kind === 1) {
      for (let i = 1; i < n; i *= k) count++;
      code = `n = ${n}\ni = 1\nwhile i < n:\n    op()\n    i *= ${k}`;
      why = `i растёт как ${k}^t, цикл идёт, пока ${k}^t < n: ${count} раз — O(log n).`;
    } else if (kind === 2) {
      for (let i = 1; i <= n; i++) for (let j = i; j < n; j *= 2) count++;
      code = `n = ${n}\nfor i in range(1, n + 1):\n    j = i\n    while j < n:\n        op()\n        j *= 2`;
      why = `Для каждого i внутренний цикл удваивает j от i до n; сумма по i даёт ${count} — O(n log n) в худшем случае.`;
    } else {
      const m = rng.int(3, 7);
      for (let i = 0; i < n; i += k) for (let j = 0; j < m; j++) count++;
      code = `n, m = ${n}, ${m}\nfor i in range(0, n, ${k}):\n    for j in range(m):\n        op()`;
      why = `Внешний цикл — ⌈n/${k}⌉ = ${Math.ceil(n / k)} итераций, внутренний — m = ${m}: ${count}.`;
    }
    return {
      prompt: 'Сколько раз будет вызвана op() (Python)?',
      code,
      answerHint: 'число вызовов',
      answerKey: String(count),
      explanation: why,
      params: { kind, n, k },
    };
  },
});

export const amortizedGrowth: TaskGenerator = commonFamily({
  id: 'cm.array-growth',
  competency: 'common.algorithms',
  title: 'Копирования при росте динамического массива',
  specialization: 'backend',
  grade: 'senior',
  catalogIds: ['common.algo-complexity'],
  format: 'number',
  a: 1.1,
  b: 1.1,
  paramSpace: 1e5,
  timeLimitSec: 270,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const cap0 = rng.pick([1, 2, 4]);
    const additive = rng.int(0, 2) === 0;
    const step = additive ? rng.pick([2, 4, 8]) : rng.pick([2, 3]);
    const n = rng.int(10, 70);
    let cap = cap0;
    let size = 0;
    let copies = 0;
    let grows = 0;
    for (let i = 0; i < n; i++) {
      if (size === cap) {
        copies += size;
        cap = additive ? cap + step : cap * step;
        grows++;
      }
      size++;
    }
    const rule = additive ? `ёмкость увеличивается на ${step}` : `ёмкость умножается на ${step}`;
    return {
      prompt: [
        `Динамический массив: начальная ёмкость ${cap0}, пустой. Когда добавляемый элемент не помещается, выделяется новый буфер (${rule}) и все текущие элементы копируются в него.`,
        `Сколько копирований элементов произойдёт за ${n} добавлений подряд (сами записи новых элементов не считаются)?`,
      ].join('\n'),
      answerHint: 'число копирований',
      answerKey: String(copies),
      explanation: `Расширений — ${grows}, на каждом копируются все элементы. ${additive ? 'При аддитивном росте копирований Θ(n²/шаг): добавление в среднем O(n).' : 'При геометрическом росте копирований < n·k/(k−1): амортизированно O(1) на добавление.'}`,
      params: { cap0, additive, step, n },
    };
  },
});

// ---------------------------------------------------------------------------
// Структуры данных
// ---------------------------------------------------------------------------

export const stackQueue: TaskGenerator = commonFamily({
  id: 'cm.stack-queue',
  competency: 'common.data-structures',
  title: 'Порядок извлечения: стек и очередь',
  specialization: 'backend',
  grade: 'junior',
  catalogIds: ['common.algo-complexity'],
  format: 'text',
  a: 1.0,
  b: -1.1,
  paramSpace: 1e7,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const isStack = rng.int(0, 1) === 0;
    const items: number[] = [];
    const ops: string[] = [];
    const out: number[] = [];
    let next = rng.int(1, 9);
    const total = rng.int(8, 11);
    for (let i = 0; i < total; i++) {
      if (items.length === 0 || rng.int(0, 2) > 0) {
        items.push(next);
        ops.push(`${isStack ? 'push' : 'enqueue'}(${next})`);
        next += rng.int(1, 5);
      } else {
        out.push(isStack ? items.pop()! : items.shift()!);
        ops.push(isStack ? 'pop()' : 'dequeue()');
      }
    }
    if (out.length === 0) {
      out.push(isStack ? items.pop()! : items.shift()!);
      ops.push(isStack ? 'pop()' : 'dequeue()');
    }
    return {
      prompt: `Над ${isStack ? 'пустым стеком' : 'пустой очередью'} выполнены операции по порядку. Какие значения вернули ${isStack ? 'pop()' : 'dequeue()'}? Ответ — в порядке вызовов.`,
      code: ops.join('\n'),
      answerHint: 'значения через запятую, по порядку',
      answerKey: out.join(','),
      explanation: isStack ? 'Стек — LIFO: pop() возвращает последний добавленный из оставшихся.' : 'Очередь — FIFO: dequeue() возвращает самый ранний из оставшихся.',
      params: { isStack, ops: ops.length },
    };
  },
});

export const hashBuckets: TaskGenerator = commonFamily({
  id: 'cm.hash-buckets',
  competency: 'common.data-structures',
  title: 'Хеш-таблица: цепочки и пробирование',
  specialization: 'backend',
  grade: 'middle',
  catalogIds: ['common.algo-complexity'],
  format: 'number',
  a: 1.2,
  b: 0.5,
  paramSpace: 1e8,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const m = rng.pick([5, 7, 8, 10, 11]);
    const keys = rng.sample(Array.from({ length: 60 }, (_, i) => i + 3), rng.int(6, Math.min(9, m - 1)));
    const kind = rng.int(0, 2);
    let key: number;
    let prompt: string;
    let why: string;
    if (kind < 2) {
      const chains = Array.from({ length: m }, () => 0);
      for (const k of keys) chains[k % m]!++;
      if (kind === 0) {
        key = Math.max(...chains);
        prompt = 'Какой длины самая длинная цепочка?';
        why = 'Ключ попадает в корзину k mod m; длина цепочки — сколько ключей дали один остаток.';
      } else {
        key = chains.filter((c) => c === 0).length;
        prompt = 'Сколько корзин останутся пустыми?';
        why = 'Пустые корзины — остатки, которые не дал ни один ключ.';
      }
      prompt = `Хеш-таблица с цепочками, ${m} корзин, h(k) = k mod ${m}. Вставлены ключи по порядку. ${prompt}`;
    } else {
      const slots: (number | null)[] = Array.from({ length: m }, () => null);
      for (const k of keys) {
        let i = k % m;
        while (slots[i] !== null) i = (i + 1) % m;
        slots[i] = k;
      }
      const last = keys[keys.length - 1]!;
      key = slots.indexOf(last);
      prompt = `Хеш-таблица с открытой адресацией (линейное пробирование, шаг 1, по кругу), ${m} ячеек с номерами 0…${m - 1}, h(k) = k mod ${m}. Вставлены ключи по порядку. В какой ячейке окажется последний ключ ${last}?`;
      why = 'Ключ кладётся в ячейку h(k), а если она занята — в следующую свободную по кругу.';
    }
    return {
      prompt,
      code: `ключи: ${keys.join(', ')}`,
      answerHint: 'число',
      answerKey: String(key),
      explanation: why,
      params: { kind, m, keys },
    };
  },
});

export const cacheEviction: TaskGenerator = commonFamily({
  id: 'cm.cache-eviction',
  competency: 'common.data-structures',
  title: 'Промахи кэша LRU и FIFO',
  specialization: 'backend',
  grade: 'senior',
  catalogIds: ['common.algo-complexity'],
  format: 'number',
  a: 1.2,
  b: 1.0,
  paramSpace: 1e8,
  timeLimitSec: 270,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const cap = rng.int(2, 4);
    const lru = rng.int(0, 2) > 0;
    const alphabet = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, cap + rng.int(1, 2));
    const seq = Array.from({ length: rng.int(10, 14) }, () => rng.pick(alphabet));
    const cache: string[] = [];
    let misses = 0;
    for (const k of seq) {
      const at = cache.indexOf(k);
      if (at >= 0) {
        if (lru) {
          cache.splice(at, 1);
          cache.push(k);
        }
        continue;
      }
      misses++;
      if (cache.length === cap) cache.shift();
      cache.push(k);
    }
    return {
      prompt: `Кэш на ${cap} ключа, вытеснение ${lru ? 'LRU (вытесняется ключ, к которому дольше всего не обращались)' : 'FIFO (вытесняется ключ, раньше всех попавший в кэш; попадание порядок не меняет)'}. Кэш пуст, обращения идут по порядку. Сколько будет промахов?`,
      code: seq.join(' '),
      answerHint: 'число промахов',
      answerKey: String(misses),
      explanation: lru ? 'LRU: попадание переносит ключ в «свежий» конец, вытесняется самый старый по обращению.' : 'FIFO: порядок вытеснения — порядок загрузки, попадания его не меняют.',
      params: { cap, lru, seq },
    };
  },
});

export const COMMON_DATA_GENERATORS: readonly TaskGenerator[] = [sqlAggregate, sqlJoinMultiplicity, sqlNotInNull, binarySearchSteps, loopCount, amortizedGrowth, stackQueue, hashBuckets, cacheEviction];
