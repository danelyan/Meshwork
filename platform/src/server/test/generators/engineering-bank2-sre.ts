// Второй пакет семейств engineering.sre (+3 Junior, +5 Middle, +4 Senior; решение владельца 11.10).
// Параметры a, b – экспертные, не откалиброваны. Формулы доступности (последовательное и параллельное
// соединение), очереди (накопление и разгрузка), «хвостовая» задержка при fan-out – стандартные модели;
// сверка с документацией не проводилась (помечено в docs/validation-results.md).
import { fam, hhmm, num, table } from './engineering-bank2-util';
import type { TaskGenerator } from '../types';

const SUB = 'sre' as const;

// --- Junior ---------------------------------------------------------------------------------------------------

export const availabilityCounts = fam(
  { id: 'availability-counts', title: 'Доступность по счётчикам запросов', sub: SUB, grade: 'junior', cat: ['eng.slo'], format: 'number', hint: '% до сотых', a: 1.1, b: -1.0, space: 1e8, time: 180 },
  (rng) => {
    const c2 = rng.int(60000, 99000);
    const c3 = rng.int(1000, 6000);
    const c4 = rng.int(500, 5000);
    const c5 = rng.int(20, 900);
    const health = rng.int(5, 30) * 1000;
    const counted = c2 + c3 + c4 + c5;
    const sli = ((counted - c5) / counted) * 100;
    return {
      prompt: 'SLI доступности считается как доля «хороших» запросов среди учитываемых. Плохие – только ответы 5xx; 4xx – ошибка клиента, считается хорошим. Запросы проверки здоровья (health check) в SLI не входят совсем. Чему равна доступность за сутки в процентах (округлите до сотых)?',
      code: table('запросы за сутки', ['класс', 'число'], [['2xx', c2], ['3xx', c3], ['4xx', c4], ['5xx', c5], ['health check', health]]),
      answerKey: num(sli, 2),
      explanation: `Учитываем ${counted} запросов (без health check); плохих ${c5}; (${counted} − ${c5}) / ${counted} ≈ ${sli.toFixed(2)} %.`,
      params: { c2, c3, c4, c5, health },
    };
  },
);

export const mttrMean = fam(
  { id: 'mttr-mean', title: 'Среднее время восстановления', sub: SUB, grade: 'junior', cat: ['eng.incident-postmortem'], format: 'number', hint: 'минуты', a: 1.1, b: -1.2, space: 1e6, time: 150 },
  (rng) => {
    const n = rng.int(4, 6);
    const det = Array.from({ length: n }, () => rng.int(2, 25));
    const dur = Array.from({ length: n }, () => rng.int(20, 120));
    // Подгоняем последний, чтобы среднее было целым.
    for (const arr of [det, dur]) {
      const rest = arr.slice(0, -1).reduce((s, x) => s + x, 0);
      while ((rest + arr[n - 1]!) % n !== 0) arr[n - 1]!++;
    }
    const rows: { s: number; d: number; r: number }[] = [];
    let t = rng.int(0, 400);
    for (let i = 0; i < n; i++) {
      t += rng.int(60, 300);
      rows.push({ s: t, d: t + det[i]!, r: t + dur[i]! });
      t += dur[i]!;
    }
    const kind = rng.int(0, 1);
    const answer = kind === 0 ? dur.reduce((s, x) => s + x, 0) / n : det.reduce((s, x) => s + x, 0) / n;
    return {
      prompt: `По журналу инцидентов (время суток) посчитайте ${kind === 0 ? 'MTTR – среднее время от начала инцидента до восстановления' : 'MTTD – среднее время от начала инцидента до его обнаружения'}, в минутах.`,
      code: table('инциденты', ['№', 'начался', 'обнаружен', 'восстановлен'], rows.map((r, i) => [i + 1, hhmm(r.s % 1440), hhmm(r.d % 1440), hhmm(r.r % 1440)])),
      answerKey: String(answer),
      explanation: kind === 0 ? 'MTTR: среднее (восстановлен − начался) по инцидентам.' : 'MTTD: среднее (обнаружен − начался) по инцидентам.',
      params: { n, kind },
    };
  },
);

export const severityCount = fam(
  { id: 'severity-count', title: 'Серьёзность инцидентов по матрице', sub: SUB, grade: 'junior', cat: ['eng.incident-postmortem'], format: 'number', hint: 'число инцидентов', a: 1.1, b: -1.0, space: 1e6, time: 150 },
  (rng) => {
    const n = rng.int(9, 13);
    const incs = Array.from({ length: n }, (_, i) => ({
      name: `INC-${rng.int(100, 999)}-${i + 1}`,
      users: rng.pick([1, 3, 5, 12, 20, 35, 60, 80]),
      min: rng.pick([5, 12, 25, 40, 70, 120]),
      loss: rng.int(0, 7) === 0,
    }));
    const sev = (x: (typeof incs)[number]) => (x.loss || x.users >= 50 ? 1 : x.users >= 10 && x.min >= 30 ? 2 : 3);
    const level = rng.pick([1, 2, 3]);
    const answer = incs.filter((x) => sev(x) === level).length;
    return {
      prompt: `Матрица серьёзности: SEV1 – потеряны данные ИЛИ затронуто не менее 50 % пользователей; иначе SEV2 – затронуто не менее 10 % пользователей И длительность не менее 30 мин; всё остальное – SEV3. Применяется первое подходящее правило сверху. Сколько инцидентов получат уровень SEV${level}?`,
      code: table('инциденты', ['инцидент', 'затронуто, %', 'длительность, мин', 'потеря данных'], incs.map((x) => [x.name, x.users, x.min, x.loss ? 'да' : 'нет'])),
      answerKey: String(answer),
      explanation: `Уровни по порядку: ${incs.map((x) => sev(x)).join(', ')}. SEV${level} – ${answer}.`,
      params: { n, level },
    };
  },
);

// --- Middle ---------------------------------------------------------------------------------------------------

export const rollingErrorAlert = fam(
  { id: 'rolling-error-alert', title: 'Когда сработает алерт по скользящему окну', sub: SUB, grade: 'middle', cat: ['eng.alerting'], format: 'number', hint: 'номер минуты', a: 1.2, b: 0.4, space: 1e7, time: 240 },
  (rng) => {
    const W = rng.pick([3, 4, 5]);
    const thr = rng.pick([2, 3, 5]);
    const n = rng.int(14, 22);
    const spike = rng.int(W, n - W - 1); // окно целиком внутри всплеска успевает набраться до конца ряда
    const req = Array.from({ length: n }, () => rng.int(8, 14) * 100);
    const err = req.map((r, i) => (i >= spike ? Math.floor((r * rng.int(thr + 2, thr + 8)) / 100) : Math.floor((r * rng.int(0, 1)) / 100) + rng.int(0, 5)));
    let answer = 0;
    for (let i = W - 1; i < n; i++) {
      let e = 0;
      let r = 0;
      for (let k = i - W + 1; k <= i; k++) {
        e += err[k]!;
        r += req[k]!;
      }
      if (e * 100 > thr * r) {
        answer = i + 1;
        break;
      }
    }
    return {
      prompt: `Алерт проверяется в конце каждой минуты: доля ошибок за последние ${W} минут (сумма ошибок, делённая на сумму запросов за эти ${W} минут) строго выше ${thr} %. Пока не набралось ${W} минут данных, проверка не выполняется. В какой по счёту минуте (с 1) алерт сработает впервые?`,
      code: table('по минутам', ['минута', 'запросы', 'ошибки'], req.map((r, i) => [i + 1, r, err[i]!])),
      answerKey: String(answer),
      explanation: `Скользящее окно из ${W} минут сглаживает единичные всплески, но срабатывает с задержкой: доля считается по сумме ошибок и запросов окна, а не по минуте.`,
      params: { W, thr, n, spike },
    };
  },
);

export const compositeAvailability = fam(
  { id: 'composite-availability', title: 'Доступность цепочки с резервом', sub: SUB, grade: 'middle', cat: ['eng.slo', 'eng.capacity-planning'], format: 'number', hint: 'минуты до десятых', a: 1.2, b: 0.5, space: 1e4, time: 240 },
  (rng) => {
    const pcts = [99, 99.5, 99.9, 99.95, 99.99];
    const gw = rng.pick(pcts);
    const app = rng.pick(pcts.slice(0, 4));
    const copies = rng.int(2, 3);
    const db = rng.pick(pcts);
    const appBlock = 1 - (1 - app / 100) ** copies;
    const total = (gw / 100) * appBlock * (db / 100);
    const down = (1 - total) * 43200;
    return {
      prompt: `Запрос обслуживается цепочкой: шлюз → приложение → база данных, все звенья нужны. Приложение запущено в ${copies} независимых копиях, достаточно одной живой. Отказы независимы. Доступность звеньев указана ниже. Сколько минут в месяц (30 дней) цепочка недоступна (округлите до десятых)?`,
      code: [`шлюз: ${gw} %`, `приложение (каждая копия): ${app} %`, `база данных: ${db} %`].join('\n'),
      answerKey: num(down, 1),
      explanation: `Копии приложения: 1 − (1 − ${app / 100})^${copies} = ${appBlock.toFixed(6)}; цепочка умножает доступности: ${(total * 100).toFixed(4)} %; простой ${down.toFixed(1)} мин. Резерв усиливает только своё звено, слабое последовательное звено остаётся потолком.`,
      params: { gw, app, copies, db },
    };
  },
);

export const deadlineAttempts = fam(
  { id: 'deadline-attempts', title: 'Сколько попыток успеет до дедлайна', sub: SUB, grade: 'middle', cat: ['eng.retries-resilience'], format: 'number', hint: 'число попыток', a: 1.2, b: 0.3, space: 1e5, time: 210 },
  (rng) => {
    const t = rng.int(15, 80) * 10;
    const b = rng.int(3, 30) * 10;
    const D = rng.int(20, 60) * 100;
    const expo = rng.int(0, 1) === 1;
    const kind = rng.int(0, 1);
    let s = 0;
    let started = 0;
    let lastStart = 0;
    for (let k = 0; s < D; k++) {
      started++;
      lastStart = s;
      s += t + (expo ? b * 2 ** k : b);
    }
    return {
      prompt: `Вышестоящий клиент ждёт ответ не дольше ${D} мс с момента запроса. Сервис вызывает зависимость; каждая попытка завершается ошибкой таймаута ровно через ${t} мс. Между попытками пауза: ${expo ? `${b} мс, ${b * 2} мс, ${b * 4} мс и так далее (удваивается)` : `${b} мс (постоянная)`}. Новая попытка запускается, только если с начала запроса прошло меньше ${D} мс. ${kind === 0 ? 'Сколько попыток будет запущено?' : 'В какую миллисекунду (от начала запроса) стартует последняя запущенная попытка?'}`,
      answerKey: String(kind === 0 ? started : lastStart),
      explanation: `Каждая следующая попытка стартует через ${t} мс работы и паузу. ${kind === 0 ? `Запущено ${started}.` : `Последняя попытка стартует в ${lastStart} мс.`} Без общего бюджета времени ретраи тратят ресурсы на ответ, который клиенту уже не нужен.`,
      params: { t, b, D, expo, kind },
    };
  },
);

export const backlogDrain = fam(
  { id: 'backlog-drain', title: 'Разбор очереди после всплеска', sub: SUB, grade: 'middle', cat: ['eng.capacity-planning'], format: 'number', hint: 'минуты', a: 1.1, b: 0.3, space: 1e6, time: 210 },
  (rng) => {
    const mu = rng.pick([600, 800, 1000, 1200]);
    const lam0 = Math.round(mu * rng.pick([0.5, 0.6, 0.7]));
    const lam1 = mu + rng.pick([2, 3, 4, 5]) * 100;
    const t1 = rng.int(4, 15);
    const b0 = rng.pick([0, 0, 500, 1000]);
    const backlog = b0 + (lam1 - mu) * t1;
    const drain = Math.ceil(backlog / (mu - lam0));
    const answer = t1 + drain;
    return {
      prompt: `Консьюмеры обрабатывают ${mu} сообщений в минуту. Обычно поступает ${lam0} в минуту, но с момента 0 в течение ${t1} мин приходит ${lam1} в минуту, потом поток возвращается к обычному. ${b0 ? `В момент 0 в очереди уже ${b0} сообщений.` : 'В момент 0 очередь пуста.'} Через сколько минут от начала всплеска очередь снова опустеет (округлите вверх до целых минут)?`,
      answerKey: String(answer),
      explanation: `За всплеск очередь выросла до ${backlog} (${b0 ? `${b0} + ` : ''}(${lam1} − ${mu}) · ${t1}); после него разгребается со скоростью ${mu} − ${lam0} = ${mu - lam0} в минуту: ⌈${backlog} / ${mu - lam0}⌉ = ${drain} мин. Итого ${answer}.`,
      params: { mu, lam0, lam1, t1, b0 },
    };
  },
);

export const budgetRecovery = fam(
  { id: 'budget-recovery', title: 'Когда вернётся бюджет ошибок', sub: SUB, grade: 'middle', cat: ['eng.slo'], format: 'number', hint: 'сутки', a: 1.2, b: 0.6, space: 1e8, time: 240 },
  (rng) => {
    const W = 14;
    const slo = rng.pick([99.5, 99.9]);
    const budget = W * 1440 * (1 - slo / 100);
    let bad: number[] = [];
    for (let tries = 0; tries < 100; tries++) {
      bad = Array.from({ length: W }, () => rng.int(0, 3));
      for (let k = 0, c = rng.int(1, 3); k < c; k++) bad[rng.int(0, W - 1)] = rng.int(15, Math.max(16, Math.round(budget / 2)));
      if (bad.reduce((s, x) => s + x, 0) > budget) break;
    }
    const all = [...bad];
    let answer = 0;
    for (let d = W + 1; d <= 3 * W; d++) {
      all.push(0);
      const sum = all.slice(-W).reduce((s, x) => s + x, 0);
      if (sum <= budget) {
        answer = d - W;
        break;
      }
    }
    return {
      prompt: `SLO доступности ${slo} % считается в скользящем окне ${W} суток, бюджет ошибок окна – ${num(budget, 2)} мин. В конце ${W}-х суток окно уже превысило бюджет. Если новых сбоев не будет, через сколько суток после этого момента суммарные плохие минуты окна опустятся до бюджета или ниже (то есть бюджет перестанет быть превышен)?`,
      code: `плохие минуты по суткам (1…${W}): ${bad.join(', ')}`,
      answerKey: String(answer),
      explanation: `Каждые сутки из окна выпадают самые старые данные; нужно дождаться, пока выпадут крупные инциденты. Через ${answer} сут сумма окна ≤ ${num(budget, 2)}.`,
      params: { W, slo },
    };
  },
);

// --- Senior ---------------------------------------------------------------------------------------------------

export const releaseGating = fam(
  { id: 'release-gating', title: 'Релизы под политикой бюджета ошибок', sub: SUB, grade: 'senior', cat: ['eng.slo'], format: 'number', hint: 'число релизов', a: 1.2, b: 1.2, space: 1e8, time: 330 },
  (rng) => {
    const D = rng.int(18, 24);
    const budget = rng.pick([40, 60, 80]);
    const thrPct = rng.pick([50, 60, 70]);
    const cost = rng.pick([4, 6, 8]);
    const bad = Array.from({ length: D }, () => (rng.int(0, 4) === 0 ? rng.int(5, 20) : rng.int(0, 2)));
    const relDays = rng.sample(Array.from({ length: D }, (_, i) => i + 1), rng.int(8, 11)).sort((a, b) => a - b);
    const kind = rng.int(0, 1);
    let cum = 0;
    let blocked = 0;
    const blockedDays: number[] = [];
    for (let d = 1; d <= D; d++) {
      cum += bad[d - 1]!;
      if (relDays.includes(d)) {
        if (cum * 100 < thrPct * budget) cum += cost;
        else {
          blocked++;
          blockedDays.push(d);
        }
      }
    }
    const answer = kind === 0 ? blocked : blockedDays.reduce((a, b) => a + b, 0);
    return {
      prompt: `За ${D} суток действует бюджет ошибок ${budget} плохих минут. Политика: релиз разрешён, только если уже потрачено менее ${thrPct} % бюджета (на момент релиза, с учётом инцидентов этих суток); иначе релиз откладывается (заморозка), и на минуты это не влияет. Каждый выпущенный релиз стоит бюджету ещё ${cost} плохих минут (откаты, всплески ошибок). Инциденты суток происходят до релиза того же дня. ${kind === 0 ? 'Сколько запланированных релизов будет заблокировано?' : 'Чему равна сумма номеров суток, релизы которых будут заблокированы (0, если таких нет)?'}`,
      code: [`плохие минуты по суткам (1…${D}): ${bad.join(', ')}`, `релизы по суткам: ${relDays.join(', ')}`].join('\n'),
      answerKey: String(answer),
      explanation: `Идём по суткам, накапливая израсходованное; каждый выпущенный релиз добавляет ${cost} мин и приближает заморозку. Заблокированы релизы суток: ${blockedDays.join(', ') || 'нет'}.`,
      params: { D, budget, thrPct, cost },
    };
  },
);

export const cacheColdStart = fam(
  { id: 'cache-cold-start', title: 'Холодный кэш после перезапуска', sub: SUB, grade: 'senior', cat: ['eng.capacity-planning'], format: 'number', hint: 'минуты', a: 1.2, b: 1.1, space: 1e5, time: 300 },
  (rng) => {
    const rps = rng.pick([2000, 3000, 4000, 5000]);
    const dbCap = Math.floor((rps * rng.pick([0.15, 0.2, 0.25, 0.3])) / 50) * 50;
    const slope = rng.pick([2, 3, 4, 5]); // п.п. доли попаданий в минуту
    const hit0 = rng.pick([90, 95, 98]);
    const need = 100 - (dbCap * 100) / rps;
    let t = 0;
    while (Math.min(hit0, slope * t) < need && t < 1000) t++;
    const steady = (rps * (100 - hit0)) / 100;
    return {
      prompt: `Сервис получает ${rps} запросов/с; запросы, попавшие в кэш, до базы данных не доходят. После перезапуска кэш пуст, и доля попаданий растёт линейно на ${slope} процентных пункта в минуту (0 % в момент 0), пока не достигнет обычных ${hit0} %. База выдерживает ${dbCap} запросов/с (в нормальном режиме ей приходится ${steady}). Через сколько целых минут после перезапуска нагрузка на базу впервые станет не выше предела (считаем по состоянию на конец минуты)?`,
      answerKey: String(t),
      explanation: `Нагрузка на базу = ${rps} · (100 − hit) / 100 ≤ ${dbCap} при hit ≥ ${need.toFixed(1)} %; при росте ${slope} п.п./мин это ${t}-я минута. До неё базу надо защищать: прогрев кэша, ограничение трафика, коалесинг запросов.`,
      params: { rps, dbCap, slope, hit0 },
    };
  },
);

export const tailFanout = fam(
  { id: 'tail-fanout', title: 'Хвост задержки при fan-out', sub: SUB, grade: 'senior', cat: ['eng.slo', 'eng.observability'], format: 'number', hint: '% до десятых', a: 1.1, b: 1.0, space: 1e3, time: 270 },
  (rng) => {
    const p = rng.pick([0.1, 0.2, 0.5, 1, 2, 3, 5]);
    const n = rng.pick([5, 8, 10, 15, 20, 30, 40, 50, 80, 100]);
    const hedge = rng.int(0, 1) === 1;
    const per = hedge ? (p / 100) ** 2 : p / 100;
    const slow = (1 - (1 - per) ** n) * 100;
    return {
      prompt: `Пользовательский запрос параллельно обращается к ${n} шардам и ждёт все ответы. Каждое обращение к шарду независимо оказывается медленным (дольше целевой задержки) с вероятностью ${p} %. ${hedge ? 'Включены дублирующие запросы (hedging): каждое обращение отправляется на две реплики одновременно, берётся первый ответ; обращение медленное, только если медленны обе реплики (независимо).' : 'Дублирующих запросов нет.'} Какой процент пользовательских запросов окажется медленным (дольше целевой хотя бы на одном шарде)? Округлите до десятых.`,
      answerKey: num(slow, 1),
      explanation: `Вероятность, что одно обращение медленное: ${num(per * 100, 4)} %; хотя бы одно из ${n} медленное: 1 − (1 − ${per})^${n} ≈ ${slow.toFixed(1)} %. Чем шире fan-out, тем сильнее редкий хвост одного шарда превращается в типичный опыт пользователя.`,
      params: { p, n, hedge },
    };
  },
);

export const rpoFailover = fam(
  { id: 'rpo-failover', title: 'Потери при аварийном переключении', sub: SUB, grade: 'senior', cat: ['eng.incident-postmortem', 'eng.capacity-planning'], format: 'number', hint: 'число', a: 1.1, b: 1.2, space: 1e7, time: 300 },
  (rng) => {
    const n = rng.int(6, 8);
    const tps = Array.from({ length: n }, () => rng.int(2, 9) * 50);
    const lagA = Array.from({ length: n }, () => rng.int(8, 60));
    const lagB = Array.from({ length: n }, () => rng.int(8, 60));
    const m = rng.int(2, n);
    const lag = Math.min(lagA[m - 1]!, lagB[m - 1]!);
    const rpo = rng.pick([5, 7]);
    const kind = rng.int(0, 1);
    const answer = kind === 0 ? lag * tps[m - 1]! : Math.max(0, lag - rpo) * tps[m - 1]!;
    return {
      prompt: `Первичная база с асинхронной репликацией на две реплики отказала в конце минуты ${m}. Выбрана реплика с меньшим отставанием на тот момент; отставание – сколько секунд записей не успело на неё доехать. Записи в минуту ${m} шли равномерно с указанной скоростью (транзакций/с). ${kind === 0 ? 'Сколько подтверждённых клиентам транзакций потеряно при переключении?' : `Цель RPO – ${rpo} с. Сколько транзакций потеряно сверх допустимого (то есть за секунды, на которые превышено RPO; 0, если не превышено)?`}`,
      code: table('по минутам', ['минута', 'транзакций/с', 'отставание A, с', 'отставание B, с'], tps.map((x, i) => [i + 1, x, lagA[i]!, lagB[i]!])),
      answerKey: String(answer),
      explanation: `Берём реплику с меньшим отставанием в минуте ${m}: ${lag} с. ${kind === 0 ? `Потеряно ${lag} · ${tps[m - 1]} = ${answer} транзакций.` : `Превышение: (${lag} − ${rpo}, не меньше нуля) · ${tps[m - 1]} транзакций/с.`} Асинхронная репликация допускает потерю подтверждённых записей; нулевой RPO даёт только синхронная.`,
      params: { n, m, rpo, kind },
    };
  },
);

export const SRE_BANK2: TaskGenerator[] = [
  availabilityCounts,
  mttrMean,
  severityCount,
  rollingErrorAlert,
  compositeAvailability,
  deadlineAttempts,
  backlogDrain,
  budgetRecovery,
  releaseGating,
  cacheColdStart,
  tailFanout,
  rpoFailover,
];
