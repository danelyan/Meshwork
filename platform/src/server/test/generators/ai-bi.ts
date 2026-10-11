// Банк подкатегории ai.bi-analytics «BI-аналитика» (11.10): 8 Junior + 5 Middle + 5 Senior = 18 семейств.
// Метрики, SQL-витрины и оконные функции на маленькой таблице в условии, когорты, ARPU/LTV, ловушки (среднее против
// медианы, деление на ноль, дублирование при join, сезонность, план-факт). Ключ считает код (R-T-02), несущественные
// параметры идут от seed (R-T-01); a и b - ПРЕДЛОЖЕНИЕ (экспертные, без калибровки на людях). Банк меньше остальных
// подкатегорий ai (18 против 26-27), поэтому цифры персон читать осторожнее (docs/validation-results.md).
import { family, fx, sum } from './ai-bank2-util';
import { table } from './ai-util';

const SUB = 'ai.bi-analytics';

/** Дробная часть около «половины» последнего знака неоднозначна для человека: такие экземпляры пропускаем. */
function nearHalf(x: number, digits: number): boolean {
  const f = Math.abs((x * 10 ** digits) % 1);
  return Math.abs(f - 0.5) < 0.03;
}

// ---------------------------------------------------------------------------
// Junior
// ---------------------------------------------------------------------------

export const biArpu = family(
  { id: 'ai.bi-arpu', taskId: 'task:bi-arppu', title: 'ARPU и ARPPU', sub: SUB, grade: 'junior', catalogIds: ['ai.bi-metrics-design'], a: 1.4, b: -0.9, space: 1e8, time: 150 },
  (rng) => {
    for (;;) {
      const mau = rng.int(20, 90) * 1000;
      const payers = Math.round((mau * rng.int(20, 120)) / 1000);
      const revenue = payers * rng.int(150, 900) + rng.int(0, 99) * 100;
      const ask = rng.pick(['arpu', 'arppu'] as const);
      const v = ask === 'arpu' ? revenue / mau : revenue / payers;
      if (nearHalf(v, 2)) continue;
      return {
        prompt: `За месяц в приложении было ${mau} активных пользователей, из них заплатили ${payers}. Выручка за месяц - ${revenue} руб. Чему равен ${ask === 'arpu' ? 'ARPU (средняя выручка на одного активного пользователя)' : 'ARPPU (средняя выручка на одного платящего пользователя)'}, руб.?`,
        answerHint: 'руб. до 2 знаков',
        answerKey: fx(v, 2),
        explanation: ask === 'arpu' ? `ARPU = ${revenue} / ${mau} = ${fx(v, 2)}; делим на всех активных, а не только на платящих (${fx(revenue / payers, 2)} - это ARPPU).` : `ARPPU = ${revenue} / ${payers} = ${fx(v, 2)}; делим только на платящих (на всех активных получился бы ARPU ${fx(revenue / mau, 2)}).`,
        params: { mau, payers, revenue, ask },
      };
    }
  },
);

export const biFunnelChain = family(
  { id: 'ai.bi-funnel-chain', taskId: 'task:bi-funnel-chain', title: 'Сквозная конверсия воронки', sub: SUB, grade: 'junior', catalogIds: ['ai.bi-metrics-design'], a: 1.4, b: -0.85, space: 1e8, time: 150 },
  (rng) => {
    for (;;) {
      const steps = rng.pick([['просмотр карточки', 'добавление в корзину', 'оформление заказа', 'оплата'], ['регистрация', 'первый заказ', 'повторный заказ']]);
      const ps = steps.slice(1).map(() => rng.int(12, 85));
      const total = ps.reduce((acc, p) => (acc * p) / 100, 100);
      if (nearHalf(total, 2)) continue;
      return {
        prompt: `Воронка: ${steps.join(' → ')}. Конверсия каждого шага считается от числа пользователей предыдущего шага. Какой процент пользователей, дошедших до шага «${steps[0]}», доходит до шага «${steps[steps.length - 1]}»?`,
        code: steps.slice(1).map((s, i) => `${steps[i]} → ${s}: ${ps[i]} %`).join('\n'),
        answerHint: '% до 2 знаков',
        answerKey: fx(total, 2),
        explanation: `Конверсии шагов перемножаются: ${ps.map((p) => `${p} %`).join(' × ')} = ${fx(total, 2)} %. Складывать или усреднять их нельзя: база у каждого шага своя.`,
        params: { ps: ps.join(','), steps: steps.length },
      };
    }
  },
);

export const biSqlHaving = family(
  { id: 'ai.bi-sql-having', taskId: 'task:bi-sql-having', title: 'SQL: HAVING по клиентам', sub: SUB, grade: 'junior', catalogIds: ['ai.bi-sql-analytics'], a: 1.4, b: -0.8, space: 1e9, time: 210 },
  (rng) => {
    for (;;) {
      const clients = ['anna', 'boris', 'vera', 'gleb', 'dana', 'egor'];
      const rows = Array.from({ length: rng.int(13, 16) }, () => ({ c: rng.pick(clients), amount: rng.int(1, 20) * 100 }));
      const k = rng.int(2, 3);
      const t = rng.int(10, 30) * 100;
      const groups = clients.map((c) => {
        const own = rows.filter((r) => r.c === c);
        return { c, n: own.length, total: sum(own.map((r) => r.amount)) };
      });
      const passed = groups.filter((g) => g.n >= k && g.total > t);
      const byCountOnly = groups.filter((g) => g.n >= k);
      const byTotalOnly = groups.filter((g) => g.total > t);
      if (passed.length < 2 || byCountOnly.length === passed.length || byTotalOnly.length === passed.length) continue;
      const answer = sum(passed.map((g) => g.total));
      return {
        prompt: `Запрос: SELECT client, SUM(amount) AS total FROM orders GROUP BY client HAVING COUNT(*) >= ${k} AND SUM(amount) > ${t}. Чему равна сумма значений столбца total по всем возвращённым строкам?`,
        code: table(['client', 'amount'], rows.map((r) => [r.c, r.amount])),
        answerHint: 'число',
        answerKey: String(answer),
        explanation: `Группы (клиент: заказов, сумма): ${groups.filter((g) => g.n > 0).map((g) => `${g.c}: ${g.n}, ${g.total}`).join('; ')}. Условию HAVING удовлетворяют ${passed.map((g) => g.c).join(', ')}; их суммы дают ${answer}. HAVING фильтрует группы после агрегации, WHERE так не умеет.`,
        params: { rows: rows.map((r) => `${r.c}:${r.amount}`).join(','), k, t },
      };
    }
  },
);

export const biLeftJoinRows = family(
  { id: 'ai.bi-left-join-rows', taskId: 'task:bi-sql-left-join', title: 'SQL: строк после LEFT JOIN', sub: SUB, grade: 'junior', catalogIds: ['ai.bi-sql-analytics'], a: 1.4, b: -0.75, space: 1e9, time: 210 },
  (rng) => {
    const nc = rng.int(8, 11);
    const customers = Array.from({ length: nc }, (_, i) => ({ id: i + 1, city: rng.pick(['Казань', 'Самара', 'Тверь', 'Омск']) }));
    const orders = Array.from({ length: rng.int(7, 14) }, (_, i) => ({ id: 100 + i, cid: rng.int(1, nc - 3) }));
    const per = customers.map((c) => orders.filter((o) => o.cid === c.id).length);
    const rowsCount = sum(per.map((n) => Math.max(1, n)));
    const noOrders = per.filter((n) => n === 0).length;
    return {
      prompt: 'Запрос: SELECT c.id, o.id FROM customers c LEFT JOIN orders o ON o.customer_id = c.id. Сколько строк вернёт запрос?',
      code: `customers (id, city)\n${table(['id', 'city'], customers.map((c) => [c.id, c.city]))}\n\norders (id, customer_id)\n${table(['id', 'customer_id'], orders.map((o) => [o.id, o.cid]))}`,
      answerHint: 'число строк',
      answerKey: String(rowsCount),
      explanation: `Каждый заказ даёт строку (${orders.length}), и ещё по одной строке с NULL получают клиенты без заказов (${noOrders}). Итого ${rowsCount}. INNER JOIN вернул бы ${orders.length}.`,
      params: { nc, orders: orders.map((o) => o.cid).join(',') },
    };
  },
);

export const biMeanMedianGap = family(
  { id: 'ai.bi-mean-median-gap', taskId: 'task:bi-mean-median-outlier', title: 'Среднее и медиана при выбросе', sub: SUB, grade: 'junior', catalogIds: ['ai.bi-dashboards'], a: 1.4, b: -0.7, space: 1e9, time: 180 },
  (rng) => {
    for (;;) {
      const n = rng.pick([9, 11]);
      const amounts = Array.from({ length: n }, () => rng.int(8, 25) * 100);
      amounts[rng.int(0, n - 1)] = rng.int(80, 300) * 100;
      const sorted = [...amounts].sort((x, y) => x - y);
      const median = sorted[(n - 1) / 2]!;
      const mean = sum(amounts) / n;
      const gap = mean - median;
      if (nearHalf(gap, 2) || gap < 200) continue;
      return {
        prompt: 'В дашборде показан средний чек за день, но руководитель считает его завышенным из-за одного крупного заказа. На сколько рублей среднее арифметическое чеков больше их медианы?',
        code: amounts.map((v, i) => `заказ ${i + 1}: ${v}`).join('\n'),
        answerHint: 'руб. до 2 знаков',
        answerKey: fx(gap, 2),
        explanation: `Среднее ${fx(mean, 2)}; медиана (средний элемент отсортированного ряда) ${median}; разница ${fx(gap, 2)}. Выброс тянет среднее вверх, медиана к нему устойчива, поэтому для «типичного» чека показывают её.`,
        params: { amounts: amounts.join(',') },
      };
    }
  },
);

export const biRatioOfSums = family(
  { id: 'ai.bi-ratio-of-sums', taskId: 'task:bi-ratio-of-sums', title: 'Конверсия за неделю по дням', sub: SUB, grade: 'junior', catalogIds: ['ai.bi-dashboards', 'ai.bi-metrics-design'], a: 1.4, b: -0.65, space: 1e10, time: 210 },
  (rng) => {
    for (;;) {
      const zero = rng.next() < 0.5 ? rng.int(0, 6) : -1;
      const days = Array.from({ length: 7 }, (_, i) => {
        const visits = i === zero ? 0 : rng.pick([rng.int(15, 60), rng.int(500, 3000)]);
        return { d: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'][i]!, visits, orders: Math.round((visits * rng.int(10, 80)) / 1000) };
      });
      const tv = sum(days.map((d) => d.visits));
      const to = sum(days.map((d) => d.orders));
      const conv = (to / tv) * 100;
      const live = days.filter((d) => d.visits > 0);
      const avg = (sum(live.map((d) => d.orders / d.visits)) / live.length) * 100;
      if (nearHalf(conv, 1) || Math.abs(avg - conv) < 0.7) continue;
      return {
        prompt: 'Для дашборда нужна конверсия из визита в заказ за всю неделю (одно число, %). Чему она равна?',
        code: table(['день', 'визиты', 'заказы'], days.map((d) => [d.d, d.visits, d.orders])),
        answerHint: '% до 1 знака',
        answerKey: fx(conv, 1),
        explanation: `Конверсия периода = сумма заказов / сумма визитов = ${to} / ${tv} = ${fx(conv, 1)} %. Среднее дневных конверсий (${fx(avg, 1)} %) неверно: дни с малым трафиком получают тот же вес, а день с нулём визитов вообще нельзя посчитать (деление на ноль).`,
        params: { days: days.map((d) => `${d.visits}:${d.orders}`).join(',') },
      };
    }
  },
);

export const biPlanFact = family(
  { id: 'ai.bi-plan-fact', taskId: 'task:bi-plan-fact', title: 'Выполнение плана нарастающим итогом', sub: SUB, grade: 'junior', catalogIds: ['ai.bi-dashboards'], a: 1.4, b: -0.55, space: 1e9, time: 180 },
  (rng) => {
    for (;;) {
      const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн'];
      const plan = months.map(() => rng.int(8, 40) * 100);
      const fact = plan.map((p) => Math.round((p * rng.int(60, 140)) / 100 / 10) * 10);
      const m = rng.int(3, months.length);
      const cumPlan = sum(plan.slice(0, m));
      const cumFact = sum(fact.slice(0, m));
      const pct = (cumFact / cumPlan) * 100;
      const avgPct = (sum(plan.slice(0, m).map((p, i) => fact[i]! / p)) / m) * 100;
      if (nearHalf(pct, 1) || Math.abs(pct - avgPct) < 0.8) continue;
      return {
        prompt: `Таблица план-факт по выручке, тыс. руб. Какой процент плана выполнен нарастающим итогом с января по ${months[m - 1]} включительно?`,
        code: table(['месяц', 'план', 'факт'], months.map((mo, i) => [mo, plan[i]!, fact[i]!])),
        answerHint: '% до 1 знака',
        answerKey: fx(pct, 1),
        explanation: `Нарастающий итог: факт ${cumFact} / план ${cumPlan} = ${fx(pct, 1)} %. Среднее месячных процентов выполнения (${fx(avgPct, 1)} %) даёт другое число: месяцы с разным планом входят в него с одинаковым весом.`,
        params: { plan: plan.join(','), fact: fact.join(','), m },
      };
    }
  },
);

export const biDedupeSum = family(
  { id: 'ai.bi-dedupe-sum', taskId: 'task:bi-dedupe-sum', title: 'Выручка без дублей загрузки', sub: SUB, grade: 'junior', catalogIds: ['ai.bi-data-quality'], a: 1.4, b: -0.45, space: 1e10, time: 180 },
  (rng) => {
    const uniq = Array.from({ length: rng.int(7, 9) }, (_, i) => ({ id: 5000 + i * 3 + rng.int(0, 2), amount: rng.int(5, 60) * 100 }));
    const rows = [...uniq];
    for (let k = rng.int(2, 4); k > 0; k--) rows.push(rng.pick(uniq));
    const shuffled = rng.shuffle(rows);
    const naive = sum(shuffled.map((r) => r.amount));
    const clean = sum(uniq.map((r) => r.amount));
    return {
      prompt: 'В витрину заказов после сбоя ночной загрузки часть строк попала дважды (одинаковые order_id и сумма). Чему равна выручка, если каждый заказ посчитать один раз?',
      code: table(['order_id', 'amount'], shuffled.map((r) => [r.id, r.amount])),
      answerHint: 'сумма',
      answerKey: String(clean),
      explanation: `Уникальных заказов ${uniq.length}, их сумма ${clean}. Если просуммировать все ${shuffled.length} строк, получится завышенные ${naive}. Дубли ловят по ключу: COUNT(*) против COUNT(DISTINCT order_id).`,
      params: { ids: shuffled.map((r) => `${r.id}:${r.amount}`).join(',') },
    };
  },
);

// ---------------------------------------------------------------------------
// Middle
// ---------------------------------------------------------------------------

export const biWindowFrame = family(
  { id: 'ai.bi-window-frame', taskId: 'task:bi-window-frame', title: 'SQL: скользящая сумма окном', sub: SUB, grade: 'middle', catalogIds: ['ai.bi-sql-analytics'], a: 1.3, b: 0.3, space: 1e10, time: 270 },
  (rng) => {
    const n = rng.int(7, 9);
    let day = rng.int(1, 3);
    const rows = Array.from({ length: n }, () => {
      day += rng.pick([1, 1, 1, 2, 3]);
      return { day, rev: rng.int(5, 60) * 10 };
    });
    const w = rng.pick([2, 3]);
    const i = rng.int(1, n - 1);
    const v = sum(rows.slice(Math.max(0, i - w), i + 1).map((r) => r.rev));
    return {
      prompt: `Запрос: SELECT day, SUM(revenue) OVER (ORDER BY day ROWS BETWEEN ${w} PRECEDING AND CURRENT ROW) AS s FROM daily_revenue. Чему равно значение s в строке с day = ${rows[i]!.day}? В таблице есть пропуски дней.`,
      code: table(['day', 'revenue'], rows.map((r) => [r.day, r.rev])),
      answerHint: 'число',
      answerKey: String(v),
      explanation: `Рамка ROWS считает физические строки, а не календарные дни: берём текущую строку и до ${w} предыдущих (здесь ${Math.min(w, i)}) - ${rows.slice(Math.max(0, i - w), i + 1).map((r) => r.rev).join(' + ')} = ${v}. Пропуски в днях рамку не расширяют.`,
      params: { rows: rows.map((r) => `${r.day}:${r.rev}`).join(','), w, i },
    };
  },
);

export const biJoinFanout = family(
  { id: 'ai.bi-join-fanout', taskId: 'task:bi-join-fanout', title: 'Выручка после JOIN с позициями', sub: SUB, grade: 'middle', catalogIds: ['ai.bi-data-modeling', 'ai.bi-sql-analytics'], a: 1.3, b: 0.4, space: 1e10, time: 270 },
  (rng) => {
    for (;;) {
      const orders = Array.from({ length: rng.int(5, 6) }, (_, i) => ({ id: i + 1, amount: rng.int(4, 40) * 100, items: rng.pick([0, 1, 2, 2, 3, 4]) }));
      const joined = sum(orders.map((o) => o.amount * o.items));
      const real = sum(orders.map((o) => o.amount));
      if (joined === real || orders.every((o) => o.items === 0)) continue;
      const items = orders.flatMap((o) => Array.from({ length: o.items }, (_, k) => [o.id, `sku-${o.id}${String.fromCharCode(97 + k)}`]));
      return {
        prompt: 'Запрос: SELECT SUM(o.amount) FROM orders o JOIN order_items i ON i.order_id = o.id. Чему равен результат? (У заказа сумма хранится одной строкой, позиций в заказе несколько.)',
        code: `orders (id, amount)\n${table(['id', 'amount'], orders.map((o) => [o.id, o.amount]))}\n\norder_items (order_id, sku)\n${table(['order_id', 'sku'], items)}`,
        answerHint: 'число',
        answerKey: String(joined),
        explanation: `После JOIN сумма заказа повторяется по каждой его позиции: ${orders.map((o) => `${o.amount}×${o.items}`).join(' + ')} = ${joined}. Заказы без позиций пропадают (INNER JOIN). Настоящая выручка ${real}; чтобы её получить, агрегируют до джойна или считают SUM по уникальным заказам.`,
        params: { orders: orders.map((o) => `${o.amount}:${o.items}`).join(',') },
      };
    }
  },
);

export const biRollingRetention = family(
  { id: 'ai.bi-rolling-retention', taskId: 'task:bi-rolling-retention', title: 'Rolling retention', sub: SUB, grade: 'middle', catalogIds: ['ai.bi-metrics-design'], a: 1.3, b: 0.5, space: 1e9, time: 300 },
  (rng) => {
    for (;;) {
      const users = Array.from({ length: rng.int(14, 18) }, (_, i) => {
        const days = Array.from(new Set(Array.from({ length: rng.int(1, 4) }, () => rng.int(1, 16)))).sort((x, y) => x - y);
        return { u: `u${i + 1}`, days };
      });
      const k = rng.int(5, 9);
      const rolling = users.filter((u) => Math.max(...u.days) >= k).length;
      const classic = users.filter((u) => u.days.includes(k)).length;
      if (rolling === classic || nearHalf((rolling / users.length) * 100, 1)) continue;
      return {
        prompt: `Для каждого пользователя (регистрация - день 0) перечислены дни, когда он заходил в продукт. Rolling retention дня ${k} - доля пользователей, у которых был хотя бы один заход в день ${k} или позже. Чему он равен, в процентах?`,
        code: table(['пользователь', 'дни заходов'], users.map((u) => [u.u, u.days.join(' ')])),
        answerHint: '% до 1 знака',
        answerKey: fx((rolling / users.length) * 100, 1),
        explanation: `Заход в день ${k} или позже есть у ${rolling} из ${users.length}: ${fx((rolling / users.length) * 100, 1)} %. Классический retention (заход ровно в день ${k}) дал бы ${classic} из ${users.length} - он всегда не выше rolling.`,
        params: { users: users.map((u) => u.days.join('.')).join('|'), k },
      };
    }
  },
);

export const biLtvCac = family(
  { id: 'ai.bi-ltv-cac', taskId: 'task:bi-ltv-cac', title: 'LTV к CAC', sub: SUB, grade: 'middle', catalogIds: ['ai.bi-metrics-design'], a: 1.3, b: 0.6, space: 1e8, time: 270 },
  (rng) => {
    for (;;) {
      const arpu = rng.int(20, 90) * 10;
      const margin = rng.pick([40, 50, 60, 70, 80]);
      const churn = rng.pick([3, 4, 5, 6, 8, 10]);
      const cac = rng.int(10, 60) * 100;
      const ltv = (arpu * (margin / 100)) / (churn / 100);
      const ratio = ltv / cac;
      if (nearHalf(ratio, 2)) continue;
      return {
        prompt: `Подписочный сервис: ARPU ${arpu} руб. в месяц, валовая маржа ${margin} %, ежемесячный отток ${churn} %, стоимость привлечения клиента (CAC) ${cac} руб. LTV считаем как ARPU × маржа / отток (средний срок жизни = 1 / отток месяцев). Чему равно отношение LTV к CAC?`,
        answerHint: 'до 2 знаков',
        answerKey: fx(ratio, 2),
        explanation: `LTV = ${arpu} × ${margin / 100} / ${churn / 100} = ${fx(ltv, 2)} руб.; отношение к CAC ${cac}: ${fx(ratio, 2)}. LTV считают на маржу, а не на выручку: с выручкой получилось бы ${fx(((arpu / (churn / 100)) / cac), 2)}.`,
        params: { arpu, margin, churn, cac },
      };
    }
  },
);

export const biZTest = family(
  { id: 'ai.bi-ab-ztest', taskId: 'task:bi-ab-ztest', title: 'Z-статистика для отчёта по A/B', sub: SUB, grade: 'middle', catalogIds: ['ai.bi-experiment-reporting'], a: 1.3, b: 0.7, space: 1e8, time: 300 },
  (rng) => {
    for (;;) {
      const n1 = rng.int(20, 70) * 100;
      const n2 = rng.int(20, 70) * 100;
      const p1 = rng.int(50, 150) / 1000;
      const x1 = Math.round(n1 * p1);
      const x2 = Math.round(n2 * (p1 + rng.int(-10, 30) / 1000));
      const pool = (x1 + x2) / (n1 + n2);
      const z = (x2 / n2 - x1 / n1) / Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
      if (nearHalf(z, 2)) continue;
      return {
        prompt: `В отчёте по A/B-тесту нужна z-статистика для разности конверсий. Контроль: ${x1} конверсий из ${n1}, вариант: ${x2} из ${n2}. Используйте объединённую долю p = (x₁ + x₂) / (n₁ + n₂): z = (q₂ - q₁) / √(p(1-p)(1/n₁ + 1/n₂)). Чему равно z?`,
        answerHint: 'до 2 знаков, со знаком',
        answerKey: fx(z, 2),
        explanation: `q₁ = ${fx(x1 / n1, 4)}, q₂ = ${fx(x2 / n2, 4)}, p = ${fx(pool, 4)}; z = ${fx(z, 2)}. ${Math.abs(z) >= 1.96 ? 'Модуль больше 1,96: различие значимо на уровне 5 %.' : 'Модуль меньше 1,96: на уровне 5 % различие не значимо.'}`,
        params: { x1, n1, x2, n2 },
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Senior
// ---------------------------------------------------------------------------

export const biSeasonalAdjust = family(
  { id: 'ai.bi-seasonal-adjust', taskId: 'task:bi-seasonal-adjust', title: 'Рост без сезонности', sub: SUB, grade: 'senior', catalogIds: ['ai.bi-dashboards', 'ai.bi-metrics-design'], a: 1.4, b: 1.2, space: 1e10, time: 330 },
  (rng) => {
    for (;;) {
      const base = [rng.int(60, 100), rng.int(90, 140), rng.int(50, 90), rng.int(120, 200)];
      const year = (g: number) => base.map((v) => Math.round(v * g + rng.int(-4, 4)));
      const y1 = year(1);
      const y2 = year(1.1);
      const mean = (q: number) => (y1[q]! + y2[q]!) / 2;
      const overall = (sum(y1) + sum(y2)) / 8;
      const idx = [0, 1, 2, 3].map((q) => mean(q) / overall);
      const a = rng.pick([0, 2]);
      const cur = [Math.round(base[a]! * 1.2 + rng.int(-4, 4)), Math.round(base[a + 1]! * 1.2 + rng.int(-4, 4))];
      const raw = (cur[1]! / cur[0]! - 1) * 100;
      const adj = (cur[1]! / idx[a + 1]! / (cur[0]! / idx[a]!) - 1) * 100;
      if (nearHalf(adj, 1) || Math.abs(adj - raw) < 4) continue;
      const q = ['Q1', 'Q2', 'Q3', 'Q4'];
      return {
        prompt: `Квартальные продажи, тыс. шт. Сезонный индекс квартала - среднее значение этого квартала за два прошлых года, делённое на среднее по всем восьми кварталам. Очищенное значение = факт / индекс. На сколько процентов выросло очищенное значение ${q[a + 1]} текущего года по сравнению с ${q[a]} (со знаком)?`,
        code: `позапрошлый год: ${y1.join(', ')}\nпрошлый год: ${y2.join(', ')}\nтекущий год: ${q[a]} = ${cur[0]}, ${q[a + 1]} = ${cur[1]}`,
        answerHint: '% до 1 знака, со знаком',
        answerKey: fx(adj, 1),
        explanation: `Индексы кварталов: ${idx.map((v) => fx(v, 3)).join(', ')}. Очищенные значения: ${fx(cur[0]! / idx[a]!, 2)} и ${fx(cur[1]! / idx[a + 1]!, 2)}; рост ${fx(adj, 1)} %. Сырой рост ${fx(raw, 1)} % смешивает реальную динамику с сезонностью, на дашборде их нужно разделять.`,
        params: { y1: y1.join(','), y2: y2.join(','), cur: cur.join(','), a },
      };
    }
  },
);

export const biScdAsOf = family(
  { id: 'ai.bi-scd-asof', taskId: 'task:bi-scd-asof', title: 'Выручка сегмента на дату заказа', sub: SUB, grade: 'senior', catalogIds: ['ai.bi-data-modeling'], a: 1.4, b: 1.3, space: 1e10, time: 360 },
  (rng) => {
    for (;;) {
      const custs = ['A', 'B', 'C'];
      const hist = custs.flatMap((c) => {
        const cut = rng.int(8, 20);
        const first = rng.pick(['gold', 'basic']);
        return [
          { c, seg: first, from: 1, to: cut },
          { c, seg: first === 'gold' ? 'basic' : 'gold', from: cut, to: 31 },
        ];
      });
      const orders = Array.from({ length: rng.int(8, 10) }, () => ({ c: rng.pick(custs), day: rng.int(1, 30), amount: rng.int(2, 30) * 100 }));
      const segAt = (c: string, d: number) => hist.find((h) => h.c === c && d >= h.from && d < h.to)!.seg;
      const current = (c: string) => hist.filter((h) => h.c === c).sort((x, y) => y.from - x.from)[0]!.seg;
      const asOf = sum(orders.filter((o) => segAt(o.c, o.day) === 'gold').map((o) => o.amount));
      const naive = sum(orders.filter((o) => current(o.c) === 'gold').map((o) => o.amount));
      if (asOf === naive || asOf === 0) continue;
      return {
        prompt: 'Сегмент клиента меняется со временем (медленно меняющееся измерение). Строка истории действует с valid_from включительно до valid_to не включая. Чему равна выручка сегмента gold, если каждый заказ относить к сегменту, в котором клиент был в день заказа?',
        code: `segment_history (customer, segment, valid_from, valid_to)\n${table(['customer', 'segment', 'valid_from', 'valid_to'], hist.map((h) => [h.c, h.seg, h.from, h.to]))}\n\norders (customer, day, amount)\n${table(['customer', 'day', 'amount'], orders.map((o) => [o.c, o.day, o.amount]))}`,
        answerHint: 'сумма',
        answerKey: String(asOf),
        explanation: `Для каждого заказа берём строку истории, в интервал которой попадает день. Сумма заказов в gold на дату заказа - ${asOf}. Если присоединить текущий сегмент клиента, получится ${naive}: выручка переедет в сегмент задним числом.`,
        params: { hist: hist.map((h) => `${h.c}:${h.seg}:${h.from}:${h.to}`).join(','), orders: orders.map((o) => `${o.c}:${o.day}:${o.amount}`).join(',') },
      };
    }
  },
);

export const biPriceVolumeMix = family(
  { id: 'ai.bi-price-volume-mix', taskId: 'task:bi-pvm-decomposition', title: 'Разложение выручки: эффект структуры', sub: SUB, grade: 'senior', catalogIds: ['ai.bi-metrics-design'], a: 1.4, b: 1.4, space: 1e10, time: 360 },
  (rng) => {
    for (;;) {
      const n = rng.int(2, 3);
      const items = Array.from({ length: n }, (_, i) => {
        const p0 = rng.int(5, 40) * 10;
        return { name: ['Базовый', 'Плюс', 'Про'][i]!, p0, q0: rng.int(10, 80) * 10, p1: p0 + rng.int(-5, 8) * 10, q1: rng.int(10, 80) * 10 };
      });
      const Q0 = sum(items.map((x) => x.q0));
      const Q1 = sum(items.map((x) => x.q1));
      const R0 = sum(items.map((x) => x.p0 * x.q0));
      const R1 = sum(items.map((x) => x.p1 * x.q1));
      const avg0 = R0 / Q0;
      const volume = (Q1 - Q0) * avg0;
      const price = sum(items.map((x) => (x.p1 - x.p0) * x.q1));
      const mix = R1 - R0 - volume - price;
      if (nearHalf(mix, 2) || Math.abs(mix) < 300) continue;
      return {
        prompt: 'Выручка тарифов изменилась между периодами. Разложение: эффект цены = Σ (p₁ - p₀) · q₁; эффект объёма = (Q₁ - Q₀) · (R₀ / Q₀), где Q - суммарное число подписок, R - суммарная выручка; эффект структуры (mix) = изменение выручки минус эффект цены и объёма. Чему равен эффект структуры, руб.?',
        code: table(['тариф', 'цена, период 0', 'подписок, период 0', 'цена, период 1', 'подписок, период 1'], items.map((x) => [x.name, x.p0, x.q0, x.p1, x.q1])),
        answerHint: 'руб. до 2 знаков, со знаком',
        answerKey: fx(mix, 2),
        explanation: `Изменение выручки ${R1 - R0}; объём ${fx(volume, 2)}; цена ${price}; остаток - структура: ${fx(mix, 2)}. Структура показывает, как сдвиг в сторону дорогих или дешёвых тарифов меняет выручку при том же числе подписок.`,
        params: { items: items.map((x) => `${x.p0}:${x.q0}:${x.p1}:${x.q1}`).join('|') },
      };
    }
  },
);

export const biAttribution = family(
  { id: 'ai.bi-attribution', taskId: 'task:bi-attribution', title: 'Атрибуция по позициям касаний', sub: SUB, grade: 'senior', catalogIds: ['ai.bi-metrics-design'], a: 1.4, b: 1.5, space: 1e10, time: 360 },
  (rng) => {
    for (;;) {
      const channels = ['search', 'email', 'social', 'direct'];
      const trips = Array.from({ length: rng.int(6, 8) }, () => ({ path: Array.from({ length: rng.int(2, 4) }, () => rng.pick(channels)), amount: rng.int(5, 40) * 100 }));
      const target = rng.pick(channels);
      const credit = (path: string[], ch: string): number => {
        const n = path.length;
        const w = (i: number) => (n === 2 ? 0.5 : i === 0 || i === n - 1 ? 0.4 : 0.2 / (n - 2));
        return path.reduce((s, c, i) => s + (c === ch ? w(i) : 0), 0);
      };
      const pos = sum(trips.map((t) => t.amount * credit(t.path, target)));
      const last = sum(trips.filter((t) => t.path[t.path.length - 1] === target).map((t) => t.amount));
      if (nearHalf(pos, 2) || Math.abs(pos - last) < 1 || pos === 0) continue;
      return {
        prompt: `Атрибуция по позициям: у пути из двух касаний каждое получает 50 % выручки; у пути из трёх и более первое и последнее касания получают по 40 %, остальные 20 % делятся поровну между промежуточными. Если канал встречается в пути несколько раз, его доли складываются. Сколько выручки припишут каналу «${target}»?`,
        code: trips.map((t, i) => `путь ${i + 1}: ${t.path.join(' > ')} - ${t.amount} руб.`).join('\n'),
        answerHint: 'руб. до 2 знаков',
        answerKey: fx(pos, 2),
        explanation: `Суммируем долю канала по каждому пути, умноженную на выручку пути: ${fx(pos, 2)} руб. Модель «последнее касание» дала бы ${last} руб.: выбор модели атрибуции меняет бюджетные выводы.`,
        params: { trips: trips.map((t) => `${t.path.join('>')}:${t.amount}`).join('|'), target },
      };
    }
  },
);

export const biReconcile = family(
  { id: 'ai.bi-reconcile', taskId: 'task:bi-reconcile', title: 'Сверка источника и витрины', sub: SUB, grade: 'senior', catalogIds: ['ai.bi-data-quality'], a: 1.4, b: 1.6, space: 1e10, time: 330 },
  (rng) => {
    for (;;) {
      const n = rng.int(7, 9);
      const src = Array.from({ length: n }, (_, i) => ({ id: 9000 + i, amount: rng.int(5, 50) * 100 }));
      const dwh = src.filter(() => rng.next() > 0.18).map((r) => ({ id: r.id, amount: rng.next() < 0.3 ? r.amount + rng.pick([-1, 1]) * rng.int(1, 5) * 100 : r.amount }));
      for (let k = rng.int(1, 2); k > 0; k--) dwh.push({ id: 9100 + k, amount: rng.int(5, 30) * 100 });
      const dwhMap = new Map(dwh.map((r) => [r.id, r.amount]));
      const srcMap = new Map(src.map((r) => [r.id, r.amount]));
      const ids = new Set([...srcMap.keys(), ...dwhMap.keys()]);
      let total = 0;
      let mism = 0;
      for (const id of ids) {
        const d = Math.abs((srcMap.get(id) ?? 0) - (dwhMap.get(id) ?? 0));
        total += d;
        if (d > 0) mism++;
      }
      const netDiff = Math.abs(sum(src.map((r) => r.amount)) - sum(dwh.map((r) => r.amount)));
      if (mism < 3 || total === netDiff) continue;
      return {
        prompt: 'Сверка выручки источника и витрины. Для каждого order_id из объединения двух таблиц считается модуль разности сумм (отсутствующая строка считается нулём). Чему равна сумма этих модулей?',
        code: `source (order_id, amount)\n${table(['order_id', 'amount'], src.map((r) => [r.id, r.amount]))}\n\nwarehouse (order_id, amount)\n${table(['order_id', 'amount'], dwh.map((r) => [r.id, r.amount]))}`,
        answerHint: 'число',
        answerKey: String(total),
        explanation: `Расхождения есть в ${mism} заказах; сумма модулей ${total}. Разность итогов источника и витрины (${netDiff}) их скрывает: потерянные и лишние строки, завышения и занижения гасят друг друга, поэтому сверять нужно построчно по ключу (FULL OUTER JOIN).`,
        params: { src: src.map((r) => r.amount).join(','), dwh: dwh.map((r) => `${r.id}:${r.amount}`).join(',') },
      };
    }
  },
);

export const AI_BI_GENERATORS = [
  biArpu,
  biFunnelChain,
  biSqlHaving,
  biLeftJoinRows,
  biMeanMedianGap,
  biRatioOfSums,
  biPlanFact,
  biDedupeSum,
  biWindowFrame,
  biJoinFanout,
  biRollingRetention,
  biLtvCac,
  biZTest,
  biSeasonalAdjust,
  biScdAsOf,
  biPriceVolumeMix,
  biAttribution,
  biReconcile,
];
