// Второй пакет семейств engineering.qa-automation (+3 Junior, +5 Middle, +4 Senior; решение владельца 11.10).
// Пробел по разбору конкурентов (research/competitors/test-banks.md): автотесты API (проверки ответа) на Junior.
// Параметры a, b – экспертные, не откалиброваны. Выбор тестов по маркерам pytest (-m) и правила rerun – по общему
// знанию; сверка с документацией не проводилась (помечено в docs/validation-results.md).
import { fam, listKey, num, randomDag } from './engineering-bank2-util';
import type { TaskGenerator } from '../types';

const SUB = 'qa-automation' as const;

// --- Junior ---------------------------------------------------------------------------------------------------

export const apiAssertions = fam(
  { id: 'api-assertions', title: 'Какие проверки ответа API упадут', sub: SUB, grade: 'junior', cat: ['eng.test-design'], format: 'list', hint: 'номера упавших проверок', a: 1.1, b: -1.2, space: 1e6, time: 180 },
  (rng) => {
    const status = rng.pick([200, 201]);
    const id = rng.int(1000, 9999);
    const st = rng.pick(['new', 'paid', 'shipped']);
    const total = rng.int(5, 40) * 100;
    const items = rng.int(1, 4);
    const withLocation = status === 201;
    const ctype = 'application/json';
    type A = { text: string; ok: boolean };
    const mk = (lines: ((truth: boolean) => A)[]) => lines;
    const templates = mk([
      (t) => {
        const v = t ? status : rng.pick([200, 201, 202, 400].filter((x) => x !== status));
        return { text: `assert resp.status_code == ${v}`, ok: v === status };
      },
      (t) => {
        const v = t ? st : rng.pick(['new', 'paid', 'shipped', 'cancelled'].filter((x) => x !== st));
        return { text: `assert resp.json()["status"] == "${v}"`, ok: v === st };
      },
      (t) => {
        const v = t ? total - 100 : total + rng.int(1, 5) * 100;
        return { text: `assert resp.json()["total"] > ${v}`, ok: total > v };
      },
      (t) => {
        const v = t ? items : items + rng.int(1, 2);
        return { text: `assert len(resp.json()["items"]) == ${v}`, ok: items === v };
      },
      (t) => {
        const h = t ? (withLocation ? 'Location' : 'Content-Type') : withLocation ? 'ETag' : 'Location';
        const present = h === 'Content-Type' || (h === 'Location' && withLocation);
        return { text: `assert "${h}" in resp.headers`, ok: present };
      },
      (t) => {
        const v = t ? ctype : 'text/html';
        return { text: `assert resp.headers["Content-Type"] == "${v}"`, ok: v === ctype };
      },
      (t) => ({ text: t ? 'assert "error" not in resp.json()' : 'assert "error" in resp.json()', ok: t }),
    ]);
    let asserts: A[] = [];
    for (let tries = 0; tries < 50; tries++) {
      const chosen = rng.sample(templates, rng.int(5, 6));
      asserts = chosen.map((f) => f(rng.int(0, 2) > 0));
      const fails = asserts.filter((a) => !a.ok).length;
      if (fails >= 1 && fails <= asserts.length - 2) break;
    }
    const failing = asserts.flatMap((a, i) => (a.ok ? [] : [i + 1]));
    const body = `{"id": ${id}, "status": "${st}", "total": ${total}, "items": [${Array.from({ length: items }, (_, i) => i + 1).join(', ')}]}`;
    return {
      prompt: 'Автотест вызывает API и проверяет ответ (ниже). Какие из проверок упадут? Перечислите их номера.',
      code: [
        `HTTP ${status}`,
        `Content-Type: ${ctype}`,
        ...(withLocation ? [`Location: /orders/${id}`] : []),
        '',
        body,
        '',
        ...asserts.map((a, i) => `${i + 1}. ${a.text}`),
      ].join('\n'),
      answerKey: listKey(failing),
      explanation: `Сверяем каждую проверку с фактическим ответом: упадут ${failing.join(', ')}. Ключ отсутствует в ответе (KeyError) или значение не равно ожидаемому – проверка падает.`,
      params: { status, st, items, n: asserts.length },
    };
  },
);

export const markerSelect = fam(
  { id: 'marker-select', title: 'Сколько тестов выберет маркер', sub: SUB, grade: 'junior', cat: ['eng.test-strategy'], format: 'number', hint: 'число тестов', a: 1.1, b: -1.0, space: 1e6, time: 150 },
  (rng) => {
    const marks = ['smoke', 'slow', 'api', 'ui', 'flaky'];
    const n = rng.int(9, 12);
    const tests = Array.from({ length: n }, (_, i) => ({ name: `test_${rng.pick(['login', 'cart', 'search', 'pay', 'profile', 'export', 'refund', 'filter'])}_${i + 1}`, m: rng.sample(marks, rng.int(1, 3)) }));
    const forms: { expr: string; f: (m: string[]) => boolean }[] = [
      { expr: 'smoke', f: (m) => m.includes('smoke') },
      { expr: 'smoke and not slow', f: (m) => m.includes('smoke') && !m.includes('slow') },
      { expr: 'api or ui', f: (m) => m.includes('api') || m.includes('ui') },
      { expr: '(api or ui) and not flaky', f: (m) => (m.includes('api') || m.includes('ui')) && !m.includes('flaky') },
      { expr: 'not slow and not flaky', f: (m) => !m.includes('slow') && !m.includes('flaky') },
      { expr: 'api and slow', f: (m) => m.includes('api') && m.includes('slow') },
    ];
    const form = rng.pick(forms);
    const answer = tests.filter((t) => form.f(t.m)).length;
    return {
      prompt: `Тесты помечены маркерами pytest. Запуск: pytest -m "${form.expr}". Сколько тестов будет выбрано (остальные отфильтруются)?`,
      code: tests.map((t) => `@pytest.mark.${t.m.join(', @pytest.mark.')}  ${t.name}`).join('\n'),
      answerKey: String(answer),
      explanation: `Выражение -m вычисляется для набора маркеров каждого теста: "${form.expr}". Подходят ${answer}.`,
      params: { n, expr: form.expr },
    };
  },
);

export const schemaValidate = fam(
  { id: 'schema-validate', title: 'Ответы, не прошедшие схему', sub: SUB, grade: 'junior', cat: ['eng.test-design', 'eng.contract-tests'], format: 'list', hint: 'номера ответов', a: 1.1, b: -0.9, space: 1e6, time: 210 },
  (rng) => {
    const pool: { name: string; type: 'string' | 'integer' | 'boolean'; good: () => string; bad: () => string }[] = [
      { name: 'id', type: 'integer', good: () => String(rng.int(1, 999)), bad: () => `"${rng.int(1, 999)}"` },
      { name: 'email', type: 'string', good: () => `"u${rng.int(1, 99)}@x.test"`, bad: () => String(rng.int(1, 99)) },
      { name: 'active', type: 'boolean', good: () => rng.pick(['true', 'false']), bad: () => rng.pick(['"yes"', '1']) },
      { name: 'age', type: 'integer', good: () => String(rng.int(18, 80)), bad: () => 'null' },
      { name: 'name', type: 'string', good: () => `"${rng.pick(['Ivan', 'Maria', 'Oleg'])}"`, bad: () => 'true' },
    ];
    const req = rng.sample(pool, rng.int(3, 4));
    const n = rng.int(5, 6);
    let fails: number[] = [];
    let rows: string[] = [];
    for (let tries = 0; tries < 50; tries++) {
      fails = [];
      rows = [];
      for (let i = 1; i <= n; i++) {
        const mode = rng.int(0, 4); // 0 – пропуск поля, 1 – неверный тип, иначе корректно
        const target = rng.int(0, req.length - 1);
        const parts: string[] = [];
        req.forEach((f, k) => {
          if (mode === 0 && k === target) return;
          parts.push(`"${f.name}": ${mode === 1 && k === target ? f.bad() : f.good()}`);
        });
        if (rng.int(0, 2) === 0) parts.push('"note": "extra"');
        rows.push(`${i}. {${parts.join(', ')}}`);
        if (mode <= 1) fails.push(i);
      }
      if (fails.length >= 1 && fails.length <= n - 1) break;
    }
    return {
      prompt: 'Контрактный тест проверяет ответы API по JSON-схеме: все перечисленные поля обязательны и должны иметь указанный тип; лишние поля допустимы. Какие из ответов не пройдут проверку? Перечислите номера.',
      code: ['схема: ' + req.map((f) => `${f.name}: ${f.type}`).join(', '), '', ...rows].join('\n'),
      answerKey: listKey(fails),
      explanation: 'Ответ не проходит, если обязательного поля нет или его тип другой (число в кавычках – это строка, null – не число). Лишнее поле note схему не нарушает.',
      params: { n, fields: req.map((f) => f.name).join(',') },
    };
  },
);

// --- Middle ---------------------------------------------------------------------------------------------------

export const pollWait = fam(
  { id: 'poll-wait', title: 'Ожидание условия с опросом', sub: SUB, grade: 'middle', cat: ['eng.flaky-tests', 'eng.ui-autotests'], format: 'number', hint: 'секунды', a: 1.1, b: 0.3, space: 1e5, time: 210 },
  (rng) => {
    const expo = rng.int(0, 1) === 1;
    const p = rng.pick([1, 2, 3, 5]);
    const T = rng.pick([10, 15, 20, 30]);
    const r = rng.int(1, T + 6);
    // Моменты проверок: с шагом p (0, p, 2p, …) или с удваивающимся интервалом (0, p, 3p, 7p, …).
    const checks: number[] = [];
    if (expo) for (let k = 0, t = 0; t <= T; k++) { checks.push(t); t += p * 2 ** k; }
    else for (let t = 0; t <= T; t += p) checks.push(t);
    const hit = checks.find((t) => t >= r);
    const answer = hit !== undefined ? hit : T;
    return {
      prompt: `Автотест ждёт, пока сервис станет готов, опрашивая его. Первая проверка – в момент 0 с, дальше ${expo ? `интервал удваивается: пауза после k-й проверки (k = 0, 1, …) равна ${p}·2^k с` : `каждые ${p} с`}. Проверки идут, пока момент не превысил таймаут ${T} с; если готовности нет и после последней проверки, тест падает ровно в момент таймаута. Сервис становится готов в момент ${r} с (проверка в этот момент уже видит готовность). Через сколько секунд после начала ожидания тест закончит ожидание (успехом или падением)?`,
      answerKey: String(answer),
      explanation: `Моменты проверок: ${checks.join(', ')}. ${hit !== undefined ? `Первая проверка не раньше готовности – ${hit} с.` : `После готовности проверок до таймаута нет – падение в ${T} с.`}`,
      params: { expo, p, T, r },
    };
  },
);

export const orderDependence = fam(
  { id: 'order-dependence', title: 'Зависимость тестов от порядка', sub: SUB, grade: 'middle', cat: ['eng.test-isolation'], format: 'list', hint: 'номера упавших тестов', a: 1.2, b: 0.4, space: 1e7, time: 240 },
  (rng) => {
    const n = rng.int(5, 6);
    type T = { op: 'add' | 'set'; v: number; e: number };
    const tests: T[] = [];
    let x = 0;
    for (let i = 0; i < n; i++) {
      const op = rng.int(0, 2) === 0 ? 'set' : 'add';
      const v = op === 'set' ? rng.int(1, 9) : rng.int(1, 5);
      x = op === 'set' ? v : x + v;
      tests.push({ op, v, e: x });
    }
    let order: number[] = [];
    const failed: number[] = [];
    for (let tries = 0; tries < 100 && failed.length === 0; tries++) {
      order = rng.shuffle(tests.map((_, i) => i));
      let s = 0;
      for (const i of order) {
        const t = tests[i]!;
        s = t.op === 'set' ? t.v : s + t.v;
        if (s !== t.e) failed.push(i + 1);
      }
      if (failed.length === 0 && tries === 99) failed.push(1); // недостижимо на практике: при n ≥ 5 найдётся перестановка с падением
    }
    return {
      prompt: 'Тесты делят глобальное состояние x (в начале 0, не сбрасывается между тестами). Автор писал ожидания, запуская тесты по порядку номеров 1…n, и все проходили. Сейчас pytest-randomly запустил их в порядке, указанном ниже. Операция выполняется до проверки, даже если проверка в этом тесте падает. Какие тесты упадут? Перечислите номера.',
      code: [
        ...tests.map((t, i) => `test_${i + 1}: ${t.op === 'set' ? `x = ${t.v}` : `x += ${t.v}`}; assert x == ${t.e}`),
        '',
        `порядок запуска: ${order.map((i) => `test_${i + 1}`).join(', ')}`,
      ].join('\n'),
      answerKey: listKey(failed),
      explanation: 'Проходим тесты в порядке запуска, ведя значение x: проверка падает, когда накопленное значение отличается от ожидания автора. Тест, который присваивает x, «лечит» состояние, поэтому падения не всегда каскадны. Корень проблемы – общее изменяемое состояние без изоляции.',
      params: { n, order: order.join('') },
    };
  },
);

export const coverageUnion = fam(
  { id: 'coverage-union', title: 'Непокрытые строки после слияния отчётов', sub: SUB, grade: 'middle', cat: ['eng.test-design'], format: 'number', hint: 'число строк', a: 1.1, b: 0.3, space: 1e7, time: 240 },
  (rng) => {
    const N = rng.int(24, 36);
    const range = (set: Set<number>) => {
      const sorted = [...set].sort((a, b) => a - b);
      const out: string[] = [];
      for (let i = 0; i < sorted.length; ) {
        let j = i;
        while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
        out.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
        i = j + 1;
      }
      return out.join(', ');
    };
    const blocks = (count: number) => {
      const s = new Set<number>();
      for (let k = 0; k < count; k++) {
        const a = rng.int(1, N);
        const len = rng.int(1, 8);
        for (let i = a; i < Math.min(N + 1, a + len); i++) s.add(i);
      }
      return s;
    };
    const unit = blocks(rng.int(2, 3));
    const integ = blocks(rng.int(2, 3));
    const pragma = new Set<number>();
    for (let k = 0, c = rng.int(1, 2); k < c; k++) {
      const a = rng.int(1, N);
      for (let i = a; i < Math.min(N + 1, a + rng.int(1, 3)); i++) pragma.add(i);
    }
    let uncovered = 0;
    for (let i = 1; i <= N; i++) if (!unit.has(i) && !integ.has(i) && !pragma.has(i)) uncovered++;
    return {
      prompt: `В модуле ${N} исполняемых строк. Юнит-тесты и интеграционные тесты дали отдельные отчёты покрытия (строки, которые выполнились). Отчёты объединяют: строка покрыта, если выполнилась хотя бы в одном. Строки с «# pragma: no cover» исключены из подсчёта (не считаются ни покрытыми, ни непокрытыми). Сколько строк модуля остались непокрытыми?`,
      code: [`юнит: ${range(unit) || '–'}`, `интеграционные: ${range(integ) || '–'}`, `pragma: no cover на строках: ${range(pragma) || '–'}`].join('\n'),
      answerKey: String(uncovered),
      explanation: `Объединение покрытых – ${range(new Set([...unit, ...integ]))}; из ${N} строк вычитаем покрытые и исключённые pragma – остаётся ${uncovered}.`,
      params: { N, unit: unit.size, integ: integ.size, pragma: pragma.size },
    };
  },
);

export const flakyGreen = fam(
  { id: 'flaky-green', title: 'Шанс зелёного пайплайна с флаками', sub: SUB, grade: 'middle', cat: ['eng.flaky-tests'], format: 'number', hint: '% до десятых', a: 1.1, b: 0.6, space: 1e3, time: 240 },
  (rng) => {
    const n = rng.pick([5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60]);
    const q = rng.pick([2, 5, 10, 20]);
    const retries = rng.pick([0, 1, 2]);
    const pFailAll = (q / 100) ** (retries + 1);
    const green = (1 - pFailAll) ** n * 100;
    return {
      prompt: `В пайплайне ${n} нестабильных тестов; каждый независимо падает с вероятностью ${q} % при любом запуске. Остальные тесты стабильны. Упавший тест перезапускается до ${retries} ${retries === 1 ? 'раза' : 'раз'}${retries === 0 ? ' (то есть перезапусков нет)' : ''}; тест считается пройденным, если успешной оказалась хотя бы одна попытка. Пайплайн зелёный, если прошли все. Какова вероятность зелёного пайплайна в процентах (округлите до десятых)?`,
      answerKey: num(green, 1),
      explanation: `Тест проваливается окончательно с вероятностью ${q / 100}^${retries + 1} = ${pFailAll}; все ${n} проходят с вероятностью (1 − ${pFailAll})^${n} ≈ ${green.toFixed(1)} %. Перезапуски резко поднимают шанс, но маскируют нестабильность.`,
      params: { n, q, retries },
    };
  },
);

export const testImpact = fam(
  { id: 'test-impact', title: 'Какие тесты запустить после правки', sub: SUB, grade: 'middle', cat: ['eng.test-strategy'], format: 'number', hint: 'число тестов', a: 1.1, b: 0.5, space: 1e7, time: 240 },
  (rng) => {
    const m = rng.int(6, 7);
    const mods = rng.sample(['auth', 'db', 'cache', 'billing', 'orders', 'search', 'utils', 'notify'], m);
    const imports = randomDag(rng, m); // модуль i импортирует модули с меньшим индексом
    const nt = rng.int(10, 14);
    const tests = Array.from({ length: nt }, (_, i) => ({ name: `test_${i + 1}`, mods: rng.sample(Array.from({ length: m }, (_, k) => k), rng.int(1, 2)) }));
    const changed = rng.sample(Array.from({ length: m - 2 }, (_, k) => k), rng.int(1, 2));
    // Модуль затронут, если он сам изменён или транзитивно импортирует изменённый.
    const hit = new Set<number>(changed);
    for (let i = 0; i < m; i++) if (imports[i]!.some((p) => hit.has(p))) hit.add(i);
    // Тест запускается, если тестируемый им модуль затронут (тест – «клиент» модуля).
    const answer = tests.filter((t) => t.mods.some((x) => hit.has(x))).length;
    return {
      prompt: `Запускаем только тесты, на которые влияет правка. Модуль затронут, если изменён сам или (транзитивно) импортирует изменённый модуль. Тест нужно запустить, если он проверяет хотя бы один затронутый модуль. Изменены модули: ${changed.map((c) => mods[c]).join(', ')}. Сколько тестов запустить?`,
      code: [
        'импорты:',
        ...mods.map((nm, i) => `  ${nm} → ${imports[i]!.length ? imports[i]!.map((p) => mods[p]).join(', ') : '(ничего)'}`),
        'тесты:',
        ...tests.map((t) => `  ${t.name}: ${t.mods.map((x) => mods[x]).join(', ')}`),
      ].join('\n'),
      answerKey: String(answer),
      explanation: `Затронутые модули: ${[...hit].map((i) => mods[i]).join(', ')}. Подходят тесты, проверяющие хотя бы один из них: ${answer}.`,
      params: { m, nt, changed: changed.join(',') },
    };
  },
);

// --- Senior ---------------------------------------------------------------------------------------------------

export const quarantinePolicy = fam(
  { id: 'quarantine-policy', title: 'Кого отправить в карантин флаков', sub: SUB, grade: 'senior', cat: ['eng.flaky-tests'], format: 'list', hint: 'номера тестов', a: 1.2, b: 1.2, space: 1e8, time: 300 },
  (rng) => {
    const len = 12;
    const n = rng.int(6, 8);
    let hist: string[] = [];
    let ans: number[] = [];
    for (let tries = 0; tries < 50; tries++) {
      hist = [];
      ans = [];
      for (let i = 1; i <= n; i++) {
        const kind = rng.int(0, 4);
        const h: string[] = Array(len).fill('P');
        if (kind === 1 || kind === 2) {
          for (const idx of rng.sample(Array.from({ length: len - 1 }, (_, k) => k), rng.int(3, 5))) h[idx] = 'F';
        } else if (kind === 3) {
          const run = rng.int(3, 5);
          for (let k = len - run; k < len; k++) h[k] = 'F';
        } else if (kind === 4) {
          h[rng.int(0, len - 2)] = 'F';
        }
        hist.push(h.join(''));
        const f = h.filter((c) => c === 'F').length;
        const tail = h.slice(-3).every((c) => c === 'F');
        if (f >= 3 && f < len && !tail) ans.push(i);
      }
      if (ans.length >= 1 && ans.length <= n - 2) break;
    }
    return {
      prompt: `Политика карантина: тест уходит в карантин (не блокирует слияние, но чинится в срок), если среди последних ${len} запусков он падал минимум 3 раза, но проходил хотя бы раз, и при этом падал не во всех трёх последних запусках подряд – три падения подряд считаются регрессией: тест остаётся блокирующим и чинится немедленно. История ниже (слева самый старый запуск, P – прошёл, F – упал). Какие тесты нужно отправить в карантин?`,
      code: hist.map((h, i) => `test_${i + 1}: ${h}`).join('\n'),
      answerKey: listKey(ans),
      explanation: 'Для каждого теста считаем падения (≥ 3) и смотрим три последних запуска: если все F – регрессия, не карантин. Одиночный сбой (< 3) не повод карантинить – это шум.',
      params: { n },
    };
  },
);

export const contractBreak = fam(
  { id: 'contract-break', title: 'Каких потребителей сломает изменение API', sub: SUB, grade: 'senior', cat: ['eng.contract-tests'], format: 'list', hint: 'номера потребителей', a: 1.2, b: 1.3, space: 1e7, time: 330 },
  (rng) => {
    const fields = ['id', 'status', 'amount', 'currency', 'customer', 'created_at', 'discount'];
    const reqFields = ['idempotency_key', 'channel', 'region'];
    const consumers = rng.sample(['web', 'mobile', 'billing', 'analytics', 'partner', 'support'], 5).map((name) => ({
      name,
      reads: rng.sample(fields, rng.int(3, 4)),
      sends: rng.sample(reqFields, rng.int(1, 2)),
      strictEnum: rng.int(0, 1) === 1,
    }));
    type Ch = { text: string; breaks: (c: (typeof consumers)[number]) => boolean };
    const mk: (() => Ch)[] = [
      () => { const f = rng.pick(fields); return { text: `в ответе удалили поле ${f}`, breaks: (c) => c.reads.includes(f) }; },
      () => { const f = rng.pick(fields); return { text: `в ответе переименовали поле ${f} (старое имя больше не отдаётся)`, breaks: (c) => c.reads.includes(f) }; },
      () => { const f = rng.pick(fields); return { text: `в ответе сменили тип поля ${f} со строки на число`, breaks: (c) => c.reads.includes(f) }; },
      () => { const f = rng.pick(reqFields); return { text: `в запрос добавили обязательное поле ${f}`, breaks: (c) => !c.sends.includes(f) }; },
      () => ({ text: 'в ответ в перечисление status добавили новое значение «on_hold»', breaks: (c) => c.strictEnum && c.reads.includes('status') }),
      () => { const f = rng.pick(fields); return { text: `в ответ добавили необязательное поле ${f}_v2`, breaks: () => false }; },
    ];
    let changes: Ch[] = [];
    let broken: number[] = [];
    for (let tries = 0; tries < 50; tries++) {
      changes = rng.sample(mk, 4).map((f) => f());
      broken = consumers.flatMap((c, i) => (changes.some((ch) => ch.breaks(c)) ? [i + 1] : []));
      if (broken.length >= 1 && broken.length <= consumers.length - 1) break;
    }
    return {
      prompt: 'Команда провайдера выкатывает несколько изменений API одновременно. Потребитель описал контракт: какие поля ответа читает, какие поля шлёт в запросе и строго ли разбирает перечисление status (неизвестное значение – ошибка). Читать удалённое/переименованное поле или поле другого типа – ошибка; отсутствие нового обязательного поля запроса – ошибка. Каких потребителей сломает хотя бы одно из изменений? Перечислите номера.',
      code: [
        'изменения:',
        ...changes.map((c, i) => `  ${i + 1}) ${c.text}`),
        'потребители:',
        ...consumers.map((c, i) => `  ${i + 1}. ${c.name}: читает ${c.reads.join(', ')}; шлёт ${c.sends.join(', ')}; строгий status: ${c.strictEnum ? 'да' : 'нет'}`),
      ].join('\n'),
      answerKey: listKey(broken),
      explanation: `Для каждого потребителя проверяем каждое изменение по его контракту; ломаются: ${broken.join(', ')}. Добавление необязательного поля обратно совместимо, добавление значения enum – только для нестрогих разборщиков.`,
      params: { changes: changes.length },
    };
  },
);

export const testBudget = fam(
  { id: 'test-budget', title: 'Что оставить в бюджете времени', sub: SUB, grade: 'senior', cat: ['eng.test-strategy'], format: 'number', hint: 'число дефектов', a: 1.2, b: 1.1, space: 1e8, time: 330 },
  (rng) => {
    const n = rng.int(6, 7);
    const names = rng.sample(['smoke API', 'unit core', 'contract', 'e2e checkout', 'e2e search', 'perf', 'security scan', 'visual', 'migration check'], n);
    const dur = Array.from({ length: n }, () => rng.int(2, 12));
    const val = Array.from({ length: n }, () => rng.int(1, 9));
    const budget = Math.max(8, Math.floor(dur.reduce((s, d) => s + d, 0) * rng.pick([0.4, 0.5, 0.6])));
    // 0/1-рюкзак: максимум пойманных дефектов.
    const dp = Array(budget + 1).fill(0) as number[];
    for (let i = 0; i < n; i++) for (let w = budget; w >= dur[i]!; w--) dp[w] = Math.max(dp[w]!, dp[w - dur[i]!]! + val[i]!);
    const answer = dp[budget]!;
    return {
      prompt: `Пайплайн на каждый коммит должен уложиться в ${budget} минут тестового времени (проверки идут последовательно). По истории известно, сколько дефектов поймала каждая проверка за квартал. Каждую проверку можно взять целиком или не брать. Какое наибольшее число исторических дефектов покроет набор в бюджете?`,
      code: names.map((nm, i) => `${nm}: ${dur[i]} мин, поймано дефектов ${val[i]}`).join('\n'),
      answerKey: String(answer),
      explanation: `Это задача о рюкзаке: жадный выбор по «дефектов за минуту» не всегда оптимален. Перебор подмножеств в пределах ${budget} мин даёт максимум ${answer}.`,
      params: { n, budget },
    };
  },
);

export const lockedSchedule = fam(
  { id: 'locked-schedule', title: 'Параллельный прогон с блокировками ресурсов', sub: SUB, grade: 'senior', cat: ['eng.test-strategy', 'eng.test-isolation'], format: 'number', hint: 'минуты', a: 1.2, b: 1.2, space: 1e7, time: 330 },
  (rng) => {
    const workers = rng.int(2, 3);
    const n = rng.int(7, 9);
    const locks = ['db', 'cache', '-'];
    const tests = Array.from({ length: n }, (_, i) => ({ name: `t${i + 1}`, dur: rng.int(1, 6), lock: rng.pick(locks) }));
    const free = Array<number>(workers).fill(0);
    const lockFree = new Map<string, number>();
    let prevStart = 0;
    let makespan = 0;
    const starts: number[] = [];
    for (const t of tests) {
      const w = free.indexOf(Math.min(...free));
      const start = Math.max(free[w]!, t.lock === '-' ? 0 : lockFree.get(t.lock) ?? 0, prevStart);
      const end = start + t.dur;
      free[w] = end;
      if (t.lock !== '-') lockFree.set(t.lock, end);
      prevStart = start;
      starts.push(start);
      makespan = Math.max(makespan, end);
    }
    return {
      prompt: `Тесты запускаются параллельно на ${workers} воркерах. Правила: тесты берутся строго по списку (тест не стартует раньше предыдущего по списку); тест стартует на воркере, который освободился раньше всех, но не раньше, чем освободится ресурс его блокировки (db или cache; «-» – без блокировки; с одной блокировкой одновременно работает один тест). Через сколько минут завершится весь прогон?`,
      code: tests.map((t) => `${t.name}: ${t.dur} мин, блокировка ${t.lock}`).join('\n'),
      answerKey: String(makespan),
      explanation: `Старты по порядку: ${tests.map((t, i) => `${t.name}=${starts[i]}`).join(', ')}. Общий конец – ${makespan}. Блокировки на общих ресурсах сериализуют тесты, и число воркеров перестаёт ускорять прогон.`,
      params: { workers, n },
    };
  },
);

export const QA_BANK2: TaskGenerator[] = [
  apiAssertions,
  markerSelect,
  schemaValidate,
  pollWait,
  orderDependence,
  coverageUnion,
  flakyGreen,
  testImpact,
  quarantinePolicy,
  contractBreak,
  testBudget,
  lockedSchedule,
];
