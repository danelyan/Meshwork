// Второй пакет семейств engineering.data-eng (+3 Junior, +5 Middle, +4 Senior; решение владельца 11.10).
// Пробел по разбору конкурентов (research/competitors/test-banks.md): оркестрация — DAG, зависимости, повторы.
// Параметры a, b — экспертные, не откалиброваны. Поведение trigger_rule и depends_on_past описано по общей модели
// Airflow; сверка с документацией не проводилась (помечено в docs/validation-results.md).
import { fam, hhmm, listKey, randomDag, table } from './engineering-bank2-util';
import type { TaskGenerator } from '../types';

const TASKS = ['extract_orders', 'extract_users', 'clean', 'dedup', 'enrich', 'join_geo', 'aggregate', 'validate', 'load_dwh', 'build_mart', 'notify', 'export_csv'];
const SUB = 'data-eng' as const;

// --- Junior ---------------------------------------------------------------------------------------------------

export const dagSkipped = fam(
  { id: 'dag-skipped', title: 'Что не выполнится после падения задачи', sub: SUB, grade: 'junior', cat: ['eng.orchestration'], format: 'number', hint: 'минуты', a: 1.1, b: -1.0, space: 1e5, time: 150 },
  (rng) => {
    const n = rng.int(6, 8);
    const names = rng.sample(TASKS, n);
    const parents = randomDag(rng, n);
    const failed = rng.pick(Array.from({ length: n - 1 }, (_, i) => i).filter((i) => parents.some((ps) => ps.includes(i))));
    // Одна из задач (не источник и не упавшая) может иметь правило all_done.
    const doneCand = Array.from({ length: n }, (_, i) => i).filter((i) => i > failed && parents[i]!.length > 0);
    const allDone = rng.int(0, 2) > 0 && doneCand.length ? rng.pick(doneCand) : -1;
    const ok: boolean[] = [];
    for (let i = 0; i < n; i++) {
      if (i === failed) ok[i] = false;
      else if (i === allDone) ok[i] = true;
      else ok[i] = parents[i]!.every((p) => ok[p]);
    }
    const dur = Array.from({ length: n }, () => rng.int(1, 8) * 5);
    const answer = ok.reduce((s, x, i) => s + (!x && i !== failed ? dur[i]! : 0), 0);
    const edges = parents.flatMap((ps, i) => ps.map((p) => `${names[p]} >> ${names[i]}`));
    return {
      prompt: `В оркестраторе задачи связаны зависимостями (ниже). У всех задач правило запуска all_success: задача стартует, только если все родители завершились успешно; иначе она получает статус upstream_failed и не выполняется.${allDone >= 0 ? ` Исключение: у ${names[allDone]} правило all_done — оно стартует, когда все родители завершились в любом статусе.` : ''} Задача ${names[failed]} упала (повторы исчерпаны). Сколько минут плановой работы других задач пропадёт (суммарная длительность задач, которые не выполнятся успешно, без упавшей)?`,
      code: [...names.map((nm, i) => `${nm}: ${dur[i]} мин`), '', ...edges].join('\n'),
      answerKey: String(answer),
      explanation: `Идём по зависимостям: ${names.map((nm, i) => `${nm}${ok[i] ? ' — ок' : i === failed ? ' — упала' : ' — не выполнится'}`).join('; ')}. Потеряно ${answer} мин.`,
      params: { n, failed, allDone },
    };
  },
);

export const retryTimeline = fam(
  { id: 'retry-timeline', title: 'Когда завершится задача с повторами', sub: SUB, grade: 'junior', cat: ['eng.orchestration'], format: 'number', hint: 'минуты', a: 1.1, b: -1.2, space: 5e3, time: 150 },
  (rng) => {
    const retries = rng.int(2, 4);
    const delay = rng.pick([2, 3, 5, 10]);
    const dur = rng.int(3, 9);
    const finalFail = rng.int(0, 2) === 0;
    const failures = finalFail ? retries + 1 : rng.int(1, retries);
    const attempts = failures; // число неудачных попыток
    const total = finalFail ? attempts * dur + (attempts - 1) * delay : (attempts + 1) * dur + attempts * delay;
    return {
      prompt: `Задача оркестратора запускается в 00:00 и настроена на ${retries} повтора(ов) с паузой ${delay} мин между попытками. Одна попытка длится ${dur} мин; ${finalFail ? 'все попытки заканчиваются ошибкой' : `первые ${attempts} попыток(и) заканчиваются ошибкой, следующая успешна`}. Через сколько минут после старта ${finalFail ? 'задача получит финальный статус failed' : 'задача завершится успешно'}?`,
      answerKey: String(total),
      explanation: finalFail
        ? `Попыток ${attempts} по ${dur} мин и ${attempts - 1} паузы по ${delay} мин: ${total}.`
        : `${attempts} неудачных и 1 успешная попытка по ${dur} мин и ${attempts} паузы по ${delay} мин: ${total}.`,
      params: { retries, delay, dur, finalFail, attempts },
    };
  },
);

export const dqChecks = fam(
  { id: 'dq-checks', title: 'Сколько строк нарушают проверки качества', sub: SUB, grade: 'junior', cat: ['eng.data-quality'], format: 'number', hint: 'число строк', a: 1.1, b: -0.9, space: 1e6, time: 180 },
  (rng) => {
    const n = rng.int(14, 20);
    const countries = ['RU', 'KZ', 'BY', 'AM'];
    const rows: (string | number)[][] = [];
    const ids: number[] = [];
    for (let i = 0; i < n; i++) ids.push(100 + i);
    // Дубли id: одна пара.
    const dupAt = rng.int(1, n - 1);
    ids[dupAt] = ids[dupAt - 1]!;
    for (let i = 0; i < n; i++) {
      const email = rng.int(0, 5) === 0 ? '' : `${rng.pick(['a', 'b', 'c', 'd', 'e'])}${rng.int(1, 99)}@mail.test`;
      const age = rng.int(0, 5) === 0 ? rng.pick([-3, 130, 150, 200]) : rng.int(18, 70);
      const country = rng.int(0, 5) === 0 ? 'XX' : rng.pick(countries);
      rows.push([ids[i]!, email === '' ? 'NULL' : email, age, country]);
    }
    const rules = [
      { k: 'id', text: 'id уникален (строка нарушает правило, если её id встречается в таблице больше одного раза)', bad: (r: (string | number)[]) => ids.filter((x) => x === r[0]).length > 1 },
      { k: 'email', text: 'email не NULL', bad: (r: (string | number)[]) => r[1] === 'NULL' },
      { k: 'age', text: 'age от 0 до 120', bad: (r: (string | number)[]) => Number(r[2]) < 0 || Number(r[2]) > 120 },
      { k: 'country', text: `country из списка ${countries.join(', ')}`, bad: (r: (string | number)[]) => !countries.includes(String(r[3])) },
    ];
    const use = rng.sample(rules, rng.int(3, 4));
    const answer = rows.filter((r) => use.some((u) => u.bad(r))).length;
    return {
      prompt: `Перед загрузкой в витрину данные проходят проверки качества. Строка не проходит, если нарушает хотя бы одно правило:\n${use.map((u, i) => `${i + 1}) ${u.text}`).join('\n')}\nСколько строк таблицы не пройдут проверки?`,
      code: table('users_stage', ['id', 'email', 'age', 'country'], rows),
      answerKey: String(answer),
      explanation: `Проверяем каждую строку по правилам ${use.map((u) => u.k).join(', ')}; строка считается один раз, даже если нарушены два правила. Не проходят ${answer}.`,
      params: { n, rules: use.map((u) => u.k).join(',') },
    };
  },
);

// --- Middle ---------------------------------------------------------------------------------------------------

export const dagCriticalPath = fam(
  { id: 'dag-critical-path', title: 'Критический путь пайплайна', sub: SUB, grade: 'middle', cat: ['eng.orchestration'], format: 'number', hint: 'минуты', a: 1.2, b: 0.3, space: 1e7, time: 240 },
  (rng) => {
    const n = rng.int(6, 8);
    const names = rng.sample(TASKS, n);
    const parents = randomDag(rng, n);
    const dur = Array.from({ length: n }, () => rng.int(1, 8) * 5);
    const longest = (d: number[]) => {
      const end: number[] = [];
      for (let i = 0; i < n; i++) end[i] = d[i]! + Math.max(0, ...parents[i]!.map((p) => end[p]!));
      return Math.max(...end);
    };
    const base = longest(dur);
    const kind = rng.int(0, 1);
    const z = rng.int(0, n - 1);
    const cut = Math.min(dur[z]! - 5 >= 5 ? rng.pick([5, 10]) : 5, dur[z]! - 5 > 0 ? dur[z]! - 5 : 0);
    const faster = dur.map((d, i) => (i === z ? d - cut : d));
    const answer = kind === 0 ? base : base - longest(faster);
    const code = names.map((nm, i) => `${nm} (${dur[i]} мин)${parents[i]!.length ? ': после ' + parents[i]!.map((p) => names[p]).join(', ') : ''}`).join('\n');
    return {
      prompt:
        kind === 0
          ? 'Задачи пайплайна ниже выполняются параллельно, насколько позволяют зависимости; ресурсов хватает на все сразу. За сколько минут отработает весь пайплайн?'
          : `Задачи пайплайна ниже выполняются параллельно, насколько позволяют зависимости; ресурсов хватает на все сразу. Задачу ${names[z]} ускорили на ${cut} мин. На сколько минут сократится время всего пайплайна? (Если не изменится — 0.)`,
      code,
      answerKey: String(answer),
      explanation:
        kind === 0
          ? `Время пайплайна — длина самого длинного пути по зависимостям (критического): ${base} мин.`
          : `Было ${base} мин; после ускорения ${base - answer} мин. Выигрыш есть, только если задача лежит на критическом пути (и пока он остаётся самым длинным).`,
      params: { n, kind, z, cut },
    };
  },
);

export const backoffTotal = fam(
  { id: 'backoff-total', title: 'Экспоненциальные повторы задачи', sub: SUB, grade: 'middle', cat: ['eng.orchestration', 'eng.etl-pipeline'], format: 'number', hint: 'минуты', a: 1.2, b: 0.4, space: 1e4, time: 210 },
  (rng) => {
    const base = rng.pick([1, 2, 3, 5]);
    const cap = rng.pick([8, 10, 15, 20]);
    const dur = rng.int(2, 6);
    const retries = rng.int(4, 7);
    const j = rng.int(3, retries);
    const delays = Array.from({ length: retries }, (_, k) => Math.min(base * 2 ** k, cap));
    const kind = rng.int(0, 1);
    const startOfRetry = j * dur + delays.slice(0, j).reduce((s, x) => s + x, 0);
    const fin = (retries + 1) * dur + delays.reduce((s, x) => s + x, 0);
    return {
      prompt: `Задача стартует в момент 0 и падает на каждой попытке через ${dur} мин после старта попытки. Повторов — ${retries}; пауза перед k-м повтором равна min(${base}·2^(k−1), ${cap}) мин. ${kind === 0 ? `В какую минуту (от старта задачи) начнётся ${j}-й повтор?` : 'Через сколько минут от старта задача получит финальный статус failed?'}`,
      answerKey: String(kind === 0 ? startOfRetry : fin),
      explanation: `Паузы: ${delays.join(', ')} мин. ${kind === 0 ? `${j} неудачных попыток по ${dur} и первые ${j} пауз: ${startOfRetry}.` : `${retries + 1} попыток по ${dur} и все ${retries} пауз: ${fin}.`}`,
      params: { base, cap, dur, retries, j, kind },
    };
  },
);

export const mergeUpsert = fam(
  { id: 'merge-upsert', title: 'Результат MERGE с запоздавшими строками', sub: SUB, grade: 'middle', cat: ['eng.idempotent-load'], format: 'number', hint: 'число', a: 1.2, b: 0.5, space: 1e7, time: 240 },
  (rng) => {
    const nt = rng.int(4, 5);
    const target = Array.from({ length: nt }, (_, i) => ({ id: i + 1, val: rng.int(1, 9) * 10, upd: rng.int(10, 40) }));
    const ids = rng.sample([1, 2, 3, 4, 5, 6, 7], rng.int(4, 5));
    const src = ids.map((id) => {
      const t = target.find((x) => x.id === id);
      const late = t && rng.int(0, 2) === 0;
      return { id, val: rng.int(1, 9) * 10, upd: t ? (late ? t.upd - rng.int(1, 5) : t.upd + rng.int(1, 20)) : rng.int(10, 50), op: rng.int(0, 5) === 0 ? 'D' : 'U' };
    });
    const state = new Map(target.map((t) => [t.id, { ...t }]));
    for (const s of src) {
      const t = state.get(s.id);
      if (t) {
        if (s.upd > t.upd) {
          if (s.op === 'D') state.delete(s.id);
          else state.set(s.id, { id: s.id, val: s.val, upd: s.upd });
        }
      } else if (s.op !== 'D') state.set(s.id, { id: s.id, val: s.val, upd: s.upd });
    }
    const kind = rng.int(0, 1);
    const sum = [...state.values()].reduce((a, r) => a + r.val, 0);
    const sumUpd = [...state.values()].reduce((a, r) => a + r.upd, 0);
    const answer = kind === 0 ? sum : sumUpd;
    return {
      prompt: `Ночная загрузка применяет пачку из источника к целевой таблице командой MERGE (ниже). Пачка может содержать строки, запоздавшие относительно целевой таблицы (меньший upd). Что получится в целевой таблице: ${kind === 0 ? 'сумма val по всем строкам' : 'сумма upd по всем строкам'}?`,
      code: [
        table('target', ['id', 'val', 'upd'], target.map((t) => [t.id, t.val, t.upd])),
        '',
        table('source', ['id', 'val', 'upd', 'op'], src.map((s) => [s.id, s.val, s.upd, s.op])),
        '',
        'MERGE INTO target t USING source s ON t.id = s.id',
        "WHEN MATCHED AND s.upd > t.upd AND s.op = 'D' THEN DELETE",
        'WHEN MATCHED AND s.upd > t.upd THEN UPDATE SET val = s.val, upd = s.upd',
        "WHEN NOT MATCHED AND s.op <> 'D' THEN INSERT (id, val, upd) VALUES (s.id, s.val, s.upd);",
      ].join('\n'),
      answerKey: String(answer),
      explanation: 'Совпавшие строки меняются только если в источнике upd новее (запоздавшие игнорируются); новые строки вставляются, кроме пометок D; D по свежей совпавшей строке удаляет её.',
      params: { nt, nsrc: src.length, kind },
    };
  },
);

export const shuffleSkew = fam(
  { id: 'shuffle-skew', title: 'Перекос партиций при join', sub: SUB, grade: 'middle', cat: ['eng.partitioning'], format: 'number', hint: 'число строк', a: 1.1, b: 0.3, space: 1e6, time: 210 },
  (rng) => {
    const p = rng.int(3, 5);
    const nk = rng.int(6, 9);
    const rows = Array.from({ length: nk }, () => rng.int(1, 9) * 100);
    rows[rng.int(0, nk - 1)] = rng.int(20, 40) * 100;
    const load = Array.from({ length: p }, () => 0);
    rows.forEach((r, k) => (load[(k + 1) % p]! += r));
    const kind = rng.int(0, 1);
    const avg = rows.reduce((a, b) => a + b, 0) / p;
    const answer = kind === 0 ? Math.max(...load) : Math.max(...load) - Math.min(...load);
    return {
      prompt: `Таблица фактов перед join перераспределяется по ключу: строка с ключом k попадает в партицию k mod ${p}. Размеры ключей (число строк) даны ниже. ${kind === 0 ? 'Сколько строк получит самая нагруженная партиция?' : 'На сколько строк самая нагруженная партиция больше самой лёгкой?'}`,
      code: rows.map((r, k) => `ключ ${k + 1}: ${r}`).join('\n'),
      answerKey: String(answer),
      explanation: `Нагрузка по партициям: ${load.join(', ')}; среднее ${avg.toFixed(0)}. Один «горячий» ключ перекашивает партицию, и stage ждёт самую тяжёлую задачу.`,
      params: { p, nk, kind },
    };
  },
);

export const cdcReplay = fam(
  { id: 'cdc-replay', title: 'Проигрывание журнала изменений', sub: SUB, grade: 'middle', cat: ['eng.incremental-load'], format: 'number', hint: 'число', a: 1.2, b: 0.4, space: 1e7, time: 240 },
  (rng) => {
    const n = rng.int(8, 10);
    type Ev = { lsn: number; op: 'I' | 'U' | 'D'; id: number; val: number };
    const live = new Map<number, number>();
    const evs: Ev[] = [];
    let lsn = rng.int(1, 4) * 100;
    for (let i = 0; i < n; i++) {
      lsn += rng.int(1, 9);
      const liveIds = [...live.keys()];
      const free = [1, 2, 3, 4, 5].filter((x) => !live.has(x));
      const choice = liveIds.length === 0 ? 'I' : free.length === 0 ? rng.pick(['U', 'D']) : rng.pick(['I', 'U', 'D', 'U']);
      if (choice === 'I') {
        const id = rng.pick(free);
        const val = rng.int(1, 9) * 10;
        live.set(id, val);
        evs.push({ lsn, op: 'I', id, val });
      } else if (choice === 'U') {
        const id = rng.pick(liveIds);
        const val = rng.int(1, 9) * 10;
        live.set(id, val);
        evs.push({ lsn, op: 'U', id, val });
      } else {
        const id = rng.pick(liveIds);
        live.delete(id);
        evs.push({ lsn, op: 'D', id, val: 0 });
      }
    }
    const kind = rng.int(0, 1);
    const answer = kind === 0 ? [...live.values()].reduce((a, b) => a + b, 0) : [...live].reduce((a, [id, v]) => a + id * v, 0);
    const arrival = rng.shuffle(evs);
    return {
      prompt: `Журнал изменений (CDC) источника дошёл до приёмника не по порядку — в порядке прибытия (ниже). Приёмник применяет события строго по возрастанию lsn: I вставляет строку, U заменяет val, D удаляет. Таблица в начале пуста. ${kind === 0 ? 'Чему равна сумма val по строкам в конце?' : 'Чему равна сумма id × val по строкам в конце?'}`,
      code: table('cdc_log (в порядке прибытия)', ['lsn', 'op', 'id', 'val'], arrival.map((e) => [e.lsn, e.op, e.id, e.op === 'D' ? '-' : e.val])),
      answerKey: String(answer),
      explanation: 'Сначала сортируем события по lsn, затем применяем: порядок прибытия значения не имеет, иначе удаление или обновление применилось бы к несуществующей строке.',
      params: { n, kind },
    };
  },
);

// --- Senior ---------------------------------------------------------------------------------------------------

export const backfillSim = fam(
  { id: 'backfill-sim', title: 'Время бэкфилла с depends_on_past', sub: SUB, grade: 'senior', cat: ['eng.orchestration', 'eng.capacity-planning'], format: 'number', hint: 'минуты', a: 1.2, b: 1.2, space: 1e6, time: 330 },
  (rng) => {
    const days = rng.int(4, 7);
    const k = rng.int(2, 3);
    const a = rng.int(2, 6) * 5;
    const b = rng.int(2, 8) * 5;
    const c = rng.int(1, 5) * 5;
    const finish: number[] = [];
    const bEnd: number[] = [];
    for (let d = 0; d < days; d++) {
      const start = d < k ? 0 : finish[d - k]!;
      const aEnd = start + a;
      const bStart = Math.max(aEnd, d > 0 ? bEnd[d - 1]! : 0);
      bEnd[d] = bStart + b;
      finish[d] = bEnd[d]! + c;
    }
    const answer = finish[days - 1]!;
    return {
      prompt: `Нужно пересчитать ${days} дней подряд (бэкфилл). Каждый день — отдельный запуск DAG из трёх последовательных задач: extract (${a} мин) → transform (${b} мин) → load (${c} мин). Одновременно активны не более ${k} запусков (новый стартует, когда завершился запуск, освободивший слот); запуски стартуют по порядку дней, в момент 0 стартуют первые ${k}. У transform включён depends_on_past: он не стартует, пока transform предыдущего дня не завершился. Ресурсов хватает. Через сколько минут завершится последний запуск?`,
      answerKey: String(answer),
      explanation: `Серия transform идёт друг за другом и упирается в ${b} мин на день; слоты и extract лишь определяют, когда первый transform сможет стартовать. По дням: завершения запусков ${finish.join(', ')}; последний — ${answer}.`,
      params: { days, k, a, b, c },
    };
  },
);

export const saltedSkew = fam(
  { id: 'salted-skew', title: 'Подсоление горячего ключа', sub: SUB, grade: 'senior', cat: ['eng.partitioning'], format: 'number', hint: 'число строк', a: 1.2, b: 1.1, space: 1e6, time: 300 },
  (rng) => {
    const p = rng.int(4, 6);
    const salts = rng.pick([2, 3, 4].filter((s) => s <= p));
    const hot = rng.int(1, p) ;
    let hotRows = salts * rng.int(5, 20) * 100;
    const others = Array.from({ length: p + 2 }, () => rng.int(2, 10) * 100);
    const kind = rng.int(0, 1);
    let loadBefore: number[] = [];
    let loadAfter: number[] = [];
    let answer = 0;
    for (let tries = 0; tries < 20; tries++) {
      loadBefore = Array.from({ length: p }, () => 0);
      loadAfter = Array.from({ length: p }, () => 0);
      // Остальные ключи 1..n (кроме горячего) — по k mod p.
      let ok = 0;
      for (let key = 1; ok < others.length; key++) {
        if (key === hot) continue;
        loadBefore[key % p]! += others[ok]!;
        loadAfter[key % p]! += others[ok]!;
        ok++;
      }
      loadBefore[hot % p]! += hotRows;
      for (let s = 0; s < salts; s++) loadAfter[(hot + s) % p]! += hotRows / salts;
      answer = kind === 0 ? Math.max(...loadAfter) : Math.max(...loadBefore) - Math.max(...loadAfter);
      // Ответ не должен совпадать с числом из условия: при совпадении увеличиваем горячий ключ.
      if (answer !== hotRows && !others.includes(answer)) break;
      hotRows += salts * 100;
    }
    return {
      prompt: `Ключ ${hot} — «горячий»: ${hotRows} строк. Остальные ключи (по порядку, начиная с 1, кроме ${hot}) имеют размеры: ${others.join(', ')}. Строка попадает в партицию key mod ${p}. Для ключа ${hot} включили подсоление: его строки поровну разделены между ${salts} значениями соли s = 0…${salts - 1}, и пара (ключ, соль) попадает в партицию (key + s) mod ${p}; остальные ключи не меняются. ${kind === 0 ? 'Сколько строк в самой нагруженной партиции после подсоления?' : 'На сколько строк уменьшилась нагрузка самой тяжёлой партиции по сравнению с ситуацией без подсоления?'}`,
      answerKey: String(answer),
      explanation: `Без подсоления: ${loadBefore.join(', ')}; с подсолением: ${loadAfter.join(', ')}. Подсоление выравнивает горячий ключ, но агрегат или join потом придётся досчитывать по ключу без соли.`,
      params: { p, salts, hot, hotRows, kind },
    };
  },
);

export const freshnessLag = fam(
  { id: 'freshness-lag', title: 'Свежесть данных на дашборде', sub: SUB, grade: 'senior', cat: ['eng.etl-pipeline', 'eng.orchestration'], format: 'number', hint: 'минуты', a: 1.2, b: 1.3, space: 1e6, time: 330 },
  (rng) => {
    const ingEvery = rng.pick([30, 60]);
    const ingOff = rng.pick([5, 10, 15]);
    const ingDur = rng.pick([5, 10, 15]);
    const trEvery = rng.pick([60, 90, 120]);
    const trOff = rng.pick([20, 30, 40]);
    const trDur = rng.pick([10, 20, 25]);
    const T = rng.int(8 * 60, 14 * 60) + rng.int(0, 11) * 5;
    // Загрузки: старт ingOff + i·ingEvery, публикуют данные «по момент старта».
    const ing: { fin: number; asOf: number }[] = [];
    for (let s = ingOff; s <= T; s += ingEvery) ing.push({ fin: s + ingDur, asOf: s });
    const tr: { fin: number; asOf: number }[] = [];
    for (let s = trOff; s <= T; s += trEvery) {
      const avail = ing.filter((x) => x.fin <= s);
      if (avail.length) tr.push({ fin: s + trDur, asOf: Math.max(...avail.map((x) => x.asOf)) });
    }
    const shown = tr.filter((x) => x.fin <= T);
    const answer = T - Math.max(...shown.map((x) => x.asOf));
    return {
      prompt: `Данные идут в два шага. Загрузка из источника запускается каждые ${ingEvery} мин (первый запуск в 00:${String(ingOff).padStart(2, '0')}), длится ${ingDur} мин и публикует данные «по момент своего старта». Трансформация запускается каждые ${trEvery} мин (первый запуск в 00:${String(trOff).padStart(2, '0')}), длится ${trDur} мин, на старте берёт самую свежую уже опубликованную загрузку и публикует витрину с тем же «данные по» момент по окончании работы. Сейчас ${hhmm(T)}. Насколько (в минутах) данные на дашборде старее текущего момента — то есть разница между текущим временем и «данные по» последней опубликованной витрины?`,
      answerKey: String(answer),
      explanation: `Последняя опубликованная витрина содержит данные по ${hhmm(T - answer)}. Задержки складываются: ожидание следующего запуска загрузки, её длительность, ожидание запуска трансформации и её длительность.`,
      params: { ingEvery, ingOff, ingDur, trEvery, trOff, trDur, T },
    };
  },
);

export const schemaCompat = fam(
  { id: 'schema-compat', title: 'Какие изменения схемы сломают чтение', sub: SUB, grade: 'senior', cat: ['eng.data-types', 'eng.etl-pipeline'], format: 'list', hint: 'номера через запятую', a: 1.1, b: 1.0, space: 1e5, time: 270 },
  (rng) => {
    const fields = ['user_id', 'amount', 'status', 'created_at', 'country', 'channel', 'discount', 'comment'];
    const kinds = [
      { t: 'добавили поле {f} со значением по умолчанию', bad: false },
      { t: 'добавили обязательное поле {f} без значения по умолчанию', bad: true },
      { t: 'удалили поле {f}', bad: false },
      { t: 'расширили тип поля {f} с int до long', bad: false },
      { t: 'сузили тип поля {f} с long до int', bad: true },
      { t: 'переименовали поле {f} без алиаса', bad: true },
      { t: 'переименовали поле {f}, оставив старое имя в алиасах', bad: false },
      { t: 'сменили тип поля {f} со string на int', bad: true },
      { t: 'сделали поле {f} допускающим null (union с null)', bad: false },
      { t: 'сделали допускающее null поле {f} обязательным, без значения по умолчанию', bad: true },
    ];
    const pick = rng.sample(kinds, 7);
    const fs = rng.sample(fields, 7);
    const items = pick.map((k, i) => ({ text: k.t.replace('{f}', fs[i]!), bad: k.bad, n: i + 1 }));
    const bad = items.filter((x) => x.bad).map((x) => x.n);
    return {
      prompt: 'Сервис обновляет схему данных в хранилище (Avro/Parquet-подобный формат с эволюцией схемы). Читатель переходит на НОВУЮ схему и читает как новые, так и уже записанные старые файлы. Читатель ломается, если не может прочитать старый файл по новой схеме: нет значения для поля, тип не приводится без потери, поле не находится по имени. Какие из изменений нарушают чтение старых файлов? Перечислите их номера.',
      code: items.map((x) => `${x.n}. ${x.text}`).join('\n'),
      answerKey: listKey(bad),
      explanation: 'Ломают чтение старых файлов: новое обязательное поле без default, сужение типа, переименование без алиаса, смена несовместимого типа, ужесточение null. Удаление поля, расширение типа, default, алиас и допуск null безопасны.',
      params: { picked: pick.map((k) => kinds.indexOf(k)).join(',') },
    };
  },
);

export const DATA_BANK2: TaskGenerator[] = [
  dagSkipped,
  retryTimeline,
  dqChecks,
  dagCriticalPath,
  backoffTotal,
  mergeUpsert,
  shuffleSkew,
  cdcReplay,
  backfillSim,
  saltedSkew,
  freshnessLag,
  schemaCompat,
];
