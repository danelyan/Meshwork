// Расширение банка ai.data-science: +3 Junior, +5 Middle, +4 Senior (решение владельца 11.10).
// сезонный наив, экспоненциальное сглаживание, бэктест, r², доверительный интервал, стандартизация, CUPED, Holm.
import { family, fx, sum } from './ai-bank2-util';
import { table } from './ai-util';

const SUB = 'ai.data-science';

/** Ответ с дробной частью около «половины» последнего знака неоднозначен для человека: такие экземпляры пропускаем. */
function nearHalf(x: number, digits: number): boolean {
  const f = (x * 10 ** digits) % 1;
  return Math.abs(Math.abs(f) - 0.5) < 0.03;
}

// ---------------------------------------------------------------------------
// Junior
// ---------------------------------------------------------------------------

export const movingAverageForecast = family(
  { id: 'ai.moving-average-forecast', taskId: 'task:mean-median', title: 'Прогноз скользящим средним', sub: SUB, grade: 'junior', catalogIds: ['ai.pandas-sql'], a: 1.3, b: -1.1, space: 1e8, time: 180 },
  (rng) => {
    for (;;) {
      const series = Array.from({ length: rng.int(7, 9) }, () => rng.int(20, 90));
      const k = rng.pick([3, 4, 5]);
      const f = sum(series.slice(-k)) / k;
      if (nearHalf(f, 2)) continue;
      return {
        prompt: `Недельные продажи (шт.) за последние недели, от старых к новым. Прогноз на следующую неделю - среднее последних ${k} недель. Чему он равен?`,
        code: series.map((v, i) => `неделя ${i + 1}: ${v}`).join('\n'),
        answerHint: 'до 2 знаков',
        answerKey: fx(f, 2),
        explanation: `Последние ${k} значения: ${series.slice(-k).join(', ')}; сумма ${sum(series.slice(-k))}, делим на ${k}: ${fx(f, 2)}.`,
        params: { series: series.join(','), k },
      };
    }
  },
);

export const monthGrowth = family(
  { id: 'ai.month-growth', taskId: 'task:funnel-conversion', title: 'Рост месяц к месяцу', sub: SUB, grade: 'junior', catalogIds: ['ai.pandas-sql'], a: 1.3, b: -1.2, space: 1e6, time: 150 },
  (rng) => {
    for (;;) {
      const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн'];
      const vals = months.map(() => rng.int(80, 400) * 10);
      const i = rng.int(1, months.length - 1);
      const g = ((vals[i]! - vals[i - 1]!) / vals[i - 1]!) * 100;
      if (nearHalf(g, 1)) continue;
      return {
        prompt: `Выручка по месяцам, тыс. руб. На сколько процентов выручка в месяце «${months[i]}» изменилась по сравнению с предыдущим месяцем (отрицательное число - снижение)?`,
        code: months.map((m, j) => `${m}: ${vals[j]}`).join('\n'),
        answerHint: '% до 1 знака, со знаком',
        answerKey: fx(g, 1),
        explanation: `(${vals[i]} - ${vals[i - 1]}) / ${vals[i - 1]} × 100 = ${fx(g, 1)} %. Базой берётся предыдущий месяц, а не следующий.`,
        params: { vals: vals.join(','), i },
      };
    }
  },
);

export const groupTopRegion = family(
  { id: 'ai.group-top-region', taskId: 'task:sql-analytics', title: 'Регион-лидер по оплаченным заказам', sub: SUB, grade: 'junior', catalogIds: ['ai.pandas-sql', 'common.sql-queries'], a: 1.3, b: -0.9, space: 1e9, time: 210 },
  (rng) => {
    for (;;) {
      const rows = Array.from({ length: rng.int(10, 12) }, () => ({ region: rng.pick(['north', 'south', 'east', 'west']), status: rng.pick(['paid', 'paid', 'refund', 'new']), amount: rng.int(1, 30) * 100 }));
      const totals = new Map<string, number>();
      for (const r of rows) if (r.status === 'paid') totals.set(r.region, (totals.get(r.region) ?? 0) + r.amount);
      const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length < 2 || ranked[0]![1] === ranked[1]![1]) continue;
      const allTotals = new Map<string, number>();
      for (const r of rows) allTotals.set(r.region, (allTotals.get(r.region) ?? 0) + r.amount);
      const topAll = [...allTotals.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      if (topAll === ranked[0]![0] && rng.next() < 0.7) continue;
      return {
        prompt: 'Таблица заказов. Запрос: SELECT region FROM orders WHERE status = \'paid\' GROUP BY region ORDER BY SUM(amount) DESC LIMIT 1. Запрос возвращает регион-лидер. Какова сумма amount оплаченных заказов этого региона?',
        code: table(['region', 'status', 'amount'], rows.map((r) => [r.region, r.status, r.amount])),
        answerHint: 'сумма',
        answerKey: String(ranked[0]![1]),
        explanation: `Берём только paid и суммируем по регионам: ${ranked.map(([r, v]) => `${r} ${v}`).join(', ')}. Лидер - ${ranked[0]![0]} с суммой ${ranked[0]![1]}. Если не отфильтровать статус, лидером был бы ${topAll}.`,
        params: { rows: rows.map((r) => `${r.region}:${r.status}:${r.amount}`).join(',') },
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Middle
// ---------------------------------------------------------------------------

export const seasonalNaiveMae = family(
  { id: 'ai.seasonal-naive-mae', taskId: 'task:pandas-output', title: 'Ошибка сезонного наивного прогноза', sub: SUB, grade: 'middle', catalogIds: ['ai.pandas-sql'], a: 1.2, b: 0.3, space: 1e10, time: 270 },
  (rng) => {
    for (;;) {
      const m = rng.pick([4, 5, 7]);
      const pattern = Array.from({ length: m }, () => rng.int(20, 80));
      const train = Array.from({ length: 2 * m }, (_, i) => pattern[i % m]! + rng.int(-5, 5));
      const test = Array.from({ length: m }, (_, i) => pattern[i % m]! + rng.int(-5, 5));
      const fc = train.slice(-m);
      const mae = sum(test.map((v, i) => Math.abs(v - fc[i]!))) / m;
      if (nearHalf(mae, 2)) continue;
      return {
        prompt: `Ряд с недельной сезонностью (период ${m}). Сезонный наивный прогноз берёт для каждого шага значение того же положения в последнем полном сезоне обучения. Посчитайте MAE этого прогноза на тестовом сезоне.`,
        code: `обучение: ${train.join(', ')}\nтест:     ${test.join(', ')}`,
        answerHint: 'до 2 знаков',
        answerKey: fx(mae, 2),
        explanation: `Прогноз = последний сезон обучения: ${fc.join(', ')}. Модули ошибок: ${test.map((v, i) => Math.abs(v - fc[i]!)).join(', ')}; среднее ${fx(mae, 2)}.`,
        params: { m, train: train.join(','), test: test.join(',') },
      };
    }
  },
);

export const expSmoothing = family(
  { id: 'ai.exp-smoothing', taskId: 'task:weighted-mean', title: 'Экспоненциальное сглаживание', sub: SUB, grade: 'middle', catalogIds: ['ai.pandas-sql'], a: 1.2, b: 0.4, space: 1e8, time: 270 },
  (rng) => {
    for (;;) {
      const alpha = rng.pick([2, 3, 5, 7, 8]);
      const y = Array.from({ length: rng.int(5, 7) }, () => rng.int(20, 90));
      let level = y[0]!;
      for (let i = 1; i < y.length; i++) level = (alpha / 10) * y[i]! + (1 - alpha / 10) * level;
      if (nearHalf(level, 2)) continue;
      return {
        prompt: `Простое экспоненциальное сглаживание с α = ${alpha / 10}: начальный уровень равен первому наблюдению, затем уровень_t = α · y_t + (1 - α) · уровень_(t-1). Прогноз на следующий период равен последнему уровню. Чему он равен?`,
        code: y.map((v, i) => `y${i + 1} = ${v}`).join('\n'),
        answerHint: 'до 2 знаков',
        answerKey: fx(level, 2),
        explanation: `Идём по ряду, обновляя уровень: итог ${fx(level, 2)}. Чем больше α, тем сильнее прогноз следует за последними наблюдениями.`,
        params: { alpha, y: y.join(',') },
      };
    }
  },
);

export const explainedVariance = family(
  { id: 'ai.explained-variance', taskId: 'task:weighted-mean', title: 'Какую долю разброса объясняет связь', sub: SUB, grade: 'middle', catalogIds: ['ai.pandas-sql'], a: 1.2, b: 0.5, space: 1e9, time: 300 },
  (rng) => {
    for (;;) {
      const n = rng.int(6, 7);
      const x = Array.from({ length: n }, () => rng.int(1, 12));
      const y = x.map((v) => 3 * v + rng.int(-8, 8));
      const mx = sum(x) / n;
      const my = sum(y) / n;
      const sxy = sum(x.map((v, i) => (v - mx) * (y[i]! - my)));
      const sxx = sum(x.map((v) => (v - mx) ** 2));
      const syy = sum(y.map((v) => (v - my) ** 2));
      if (sxx === 0 || syy === 0) continue;
      const r2 = ((sxy * sxy) / (sxx * syy)) * 100;
      if (nearHalf(r2, 1)) continue;
      return {
        prompt: 'Аналитик посчитал связь между числом показов рекламы (x) и покупками (y) по неделям. Какой процент разброса покупок объясняется линейной связью с показами, то есть чему равен r² в процентах? (r - коэффициент корреляции Пирсона).',
        code: table(['x', 'y'], x.map((v, i) => [v, y[i]!])),
        answerHint: '% до 1 знака',
        answerKey: fx(r2, 1),
        explanation: `r² = Sxy² / (Sxx · Syy) = ${fx(sxy, 1)}² / (${fx(sxx, 1)} · ${fx(syy, 1)}) = ${fx(r2 / 100, 4)}, то есть ${fx(r2, 1)} %. Корреляция - не причинность: остальное объясняется другими факторами.`,
        params: { x: x.join(','), y: y.join(',') },
      };
    }
  },
);

export const diffConfidenceLow = family(
  { id: 'ai.diff-confidence-low', taskId: 'task:ab-uplift', title: 'Нижняя граница эффекта в A/B', sub: SUB, grade: 'middle', catalogIds: ['ai.ab-testing'], a: 1.2, b: 0.6, space: 1e8, time: 300 },
  (rng) => {
    for (;;) {
      const n1 = rng.int(20, 80) * 100;
      const n2 = rng.int(20, 80) * 100;
      const p1 = rng.int(40, 140) / 1000;
      const p2 = p1 + rng.int(-5, 25) / 1000;
      const x1 = Math.round(n1 * p1);
      const x2 = Math.round(n2 * p2);
      const q1 = x1 / n1;
      const q2 = x2 / n2;
      const se = Math.sqrt((q1 * (1 - q1)) / n1 + (q2 * (1 - q2)) / n2);
      const low = (q2 - q1 - 1.96 * se) * 100;
      if (nearHalf(low, 2)) continue;
      return {
        prompt: `A/B-тест: в контроле ${x1} конверсий из ${n1}, в варианте B - ${x2} из ${n2}. Постройте 95 %-й доверительный интервал для разности конверсий (B - A) по формуле (q₂ - q₁) ± 1,96 · √(q₁(1-q₁)/n₁ + q₂(1-q₂)/n₂). Чему равна нижняя граница, в процентных пунктах?`,
        answerHint: 'п.п. до 2 знаков, со знаком',
        answerKey: fx(low, 2),
        explanation: `q₁ = ${fx(q1, 4)}, q₂ = ${fx(q2, 4)}, SE = ${fx(se, 5)}. Нижняя граница ${fx(low, 2)} п.п.${low < 0 ? ' Она ниже нуля - значимого эффекта нет.' : ' Она выше нуля - эффект значим.'}`,
        params: { x1, n1, x2, n2 },
      };
    }
  },
);

export const retentionD7 = family(
  { id: 'ai.retention-d7', taskId: 'task:sql-analytics', title: 'Retention седьмого дня', sub: SUB, grade: 'middle', catalogIds: ['ai.pandas-sql'], a: 1.2, b: 0.3, space: 1e9, time: 300 },
  (rng) => {
    const users = Array.from({ length: rng.int(12, 16) }, (_, i) => {
      const signup = rng.int(1, 10);
      const active = Array.from(new Set(Array.from({ length: rng.int(3, 7) }, () => signup + rng.int(0, 9)))).sort((a, b) => a - b);
      return { u: `u${i + 1}`, signup, active };
    });
    const kept = users.filter((u) => u.active.includes(u.signup + 7)).length;
    return {
      prompt: 'Для каждого пользователя известен день регистрации и дни, когда он заходил в продукт. Retention D7 - доля пользователей, у которых был заход ровно на 7-й день после регистрации (день регистрации - нулевой). Чему равен D7, в процентах?',
      code: table(['пользователь', 'день регистрации', 'дни заходов'], users.map((u) => [u.u, u.signup, u.active.join(' ')])),
      answerHint: '% до 1 знака',
      answerKey: fx((kept / users.length) * 100, 1),
      explanation: `Заход на день регистрации + 7 был у ${kept} из ${users.length} пользователей: ${fx((kept / users.length) * 100, 1)} %. Заходы на 6-й или 8-й день в D7 не считаются.`,
      params: { users: users.map((u) => `${u.signup}:${u.active.join('.')}`).join('|') },
    };
  },
);

// ---------------------------------------------------------------------------
// Senior
// ---------------------------------------------------------------------------

export const rollingOriginMae = family(
  { id: 'ai.rolling-origin-mae', taskId: 'task:pandas-output', title: 'Бэктест прогноза скользящим окном', sub: SUB, grade: 'senior', catalogIds: ['ai.pandas-sql'], a: 1.2, b: 1.0, space: 1e10, time: 330 },
  (rng) => {
    for (;;) {
      const n = rng.int(11, 13);
      const y = Array.from({ length: n }, (_, i) => 40 + i * rng.int(1, 3) + rng.int(-6, 6));
      const k = rng.pick([3, 4]);
      const h = 2;
      const errs: number[] = [];
      for (let t = k; t + h <= n; t++) {
        // точка прогноза t (число уже известных значений), прогноз на значение с индексом t + h - 1
        const f = sum(y.slice(t - k, t)) / k;
        errs.push(Math.abs(y[t + h - 1]! - f));
      }
      const mae = sum(errs) / errs.length;
      if (nearHalf(mae, 2)) continue;
      return {
        prompt: `Качество прогноза проверяют скользящим началом. Для каждого t от ${k} до ${n - h} считается прогноз для значения y_(t+${h}), то есть на ${h} шага вперёд: среднее последних ${k} известных значений (y_(t-${k - 1}) … y_t). Ошибка - модуль разности прогноза и реального y_(t+${h}). Чему равна средняя абсолютная ошибка по всем t?`,
        code: y.map((v, i) => `y${i + 1} = ${v}`).join('\n'),
        answerHint: 'до 2 знаков',
        answerKey: fx(mae, 2),
        explanation: `${errs.length} моментов t = ${k}…${n - h}. Для каждого t: среднее ${k} последних известных значений и модуль разности с y_(t+${h}). Ошибки: ${errs.map((e) => fx(e, 2)).join(', ')}; среднее ${fx(mae, 2)}.`,
        params: { y: y.join(','), k },
      };
    }
  },
);

export const cupedDays = family(
  { id: 'ai.cuped-days', taskId: 'task:ab-sample-size', title: 'Сколько дней экономит CUPED', sub: SUB, grade: 'senior', catalogIds: ['ai.ab-testing'], a: 1.2, b: 1.2, space: 1e5, time: 330 },
  (rng) => {
    const n = rng.int(8, 60) * 1000;
    const rho = rng.pick([30, 40, 50, 60, 70, 80]);
    const daily = rng.pick([500, 800, 1000, 1500, 2000]);
    const adj = Math.ceil((n * (10000 - rho * rho)) / 10000 - 1e-9);
    const days = Math.ceil(adj / daily - 1e-9);
    const daysBase = Math.ceil(n / daily - 1e-9);
    return {
      prompt: `Для A/B-теста без поправок нужно ${n} пользователей на группу. В тесте применяют CUPED с ковариатой - метрикой того же пользователя до эксперимента; корреляция ковариаты с метрикой равна ${rho / 100}. CUPED уменьшает дисперсию в (1 - ρ²) раз, а нужный размер выборки пропорционален дисперсии. В каждую группу приходит ${daily} пользователей в сутки. За сколько полных суток (округление вверх) тест наберёт нужную выборку с CUPED?`,
      answerHint: 'сутки',
      answerKey: String(days),
      explanation: `Нужно ${n} × (1 - ${rho / 100}²) = ${adj} пользователей на группу. ${adj} / ${daily} с округлением вверх = ${days} сут. Без CUPED было бы ${daysBase}.`,
      params: { n, rho, daily },
    };
  },
);

export const standardizedDiff = family(
  { id: 'ai.standardized-diff', taskId: 'task:simpson', title: 'Эффект после выравнивания по сегментам', sub: SUB, grade: 'senior', catalogIds: ['ai.ab-testing', 'ai.pandas-sql'], a: 1.2, b: 1.1, space: 1e10, time: 360 },
  (rng) => {
    for (;;) {
      const segs = ['mobile', 'desktop', 'tablet'].map((s) => {
        const na = rng.int(5, 50) * 100;
        const nb = rng.int(5, 50) * 100;
        return { s, na, nb, xa: Math.round((na * rng.int(20, 120)) / 1000), xb: Math.round((nb * rng.int(20, 120)) / 1000) };
      });
      const total = sum(segs.map((g) => g.na + g.nb));
      const w = segs.map((g) => (g.na + g.nb) / total);
      const ra = sum(segs.map((g, i) => w[i]! * (g.xa / g.na)));
      const rb = sum(segs.map((g, i) => w[i]! * (g.xb / g.nb)));
      const diff = (rb - ra) * 100;
      const crudeA = sum(segs.map((g) => g.xa)) / sum(segs.map((g) => g.na));
      const crudeB = sum(segs.map((g) => g.xb)) / sum(segs.map((g) => g.nb));
      if (nearHalf(diff, 2) || Math.sign((crudeB - crudeA) * 100) === Math.sign(diff)) continue;
      return {
        prompt: 'В A/B-тесте доли сегментов в группах получились разными, из-за чего общая конверсия вводит в заблуждение. Прямая стандартизация: конверсию каждой группы пересчитывают как сумму по сегментам (доля сегмента во всём тесте × конверсия группы в сегменте). Доля сегмента во всём тесте = (пользователи A + пользователи B в сегменте) / все пользователи. Чему равна разность стандартизованных конверсий B - A, в процентных пунктах?',
        code: table(['сегмент', 'A: польз.', 'A: конв.', 'B: польз.', 'B: конв.'], segs.map((g) => [g.s, g.na, g.xa, g.nb, g.xb])),
        answerHint: 'п.п. до 2 знаков, со знаком',
        answerKey: fx(diff, 2),
        explanation: `Веса сегментов: ${segs.map((g, i) => `${g.s} ${fx(w[i]!, 3)}`).join(', ')}. Стандартизованные конверсии: A ${fx(ra * 100, 2)} %, B ${fx(rb * 100, 2)} %, разность ${fx(diff, 2)} п.п. Сырая разность (${fx((crudeB - crudeA) * 100, 2)} п.п.) имеет другой знак: это парадокс Симпсона из-за разного состава групп.`,
        params: { segs: segs.map((g) => `${g.na}:${g.xa}:${g.nb}:${g.xb}`).join('|') },
      };
    }
  },
);

export const holmRejections = family(
  { id: 'ai.holm-rejections', taskId: 'task:multiple-testing', title: 'Сколько метрик значимы по Холму', sub: SUB, grade: 'senior', catalogIds: ['ai.ab-testing'], a: 1.2, b: 1.0, space: 1e10, time: 330 },
  (rng) => {
    for (;;) {
      const m = rng.int(10, 16);
      const alpha = rng.pick([0.05, 0.1]);
      const ps = Array.from({ length: m }, () => Number((0.0005 + rng.next() ** 2.5 * 0.2).toFixed(4)));
      const sorted = [...ps].sort((a, b) => a - b);
      let holm = 0;
      for (let i = 0; i < m; i++) {
        if (sorted[i]! < alpha / (m - i)) holm++;
        else break;
      }
      const bonf = ps.filter((p) => p < alpha / m).length;
      if (holm === bonf) continue;
      return {
        prompt: `После A/B-теста проверили ${m} метрик, p-значения приведены ниже. Контролируется вероятность хотя бы одной ложной находки на уровне ${alpha}. Процедура Холма: упорядочить p по возрастанию, сравнивать i-е (с нуля) с ${alpha} / (${m} - i); остановиться на первом, которое не меньше своего порога; все предыдущие признаются значимыми. Сколько метрик значимы по Холму?`,
        code: ps.map((p, i) => `метрика ${i + 1}: p = ${p}`).join('\n'),
        answerHint: 'число метрик',
        answerKey: String(holm),
        explanation: `Отсортированные p: ${sorted.join(', ')}. Пороги ${alpha}/${m}, ${alpha}/${m - 1}, …: ${sorted.map((_, i) => fx(alpha / (m - i), 4)).join(', ')}. Значимых по Холму ${holm}; простая поправка Бонферрони (порог ${fx(alpha / m, 4)}) нашла бы только ${bonf}.`,
        params: { alpha, ps: ps.join(',') },
      };
    }
  },
);

export const AI_BANK2_DS = [
  movingAverageForecast,
  monthGrowth,
  groupTopRegion,
  seasonalNaiveMae,
  expSmoothing,
  explainedVariance,
  diffConfidenceLow,
  retentionD7,
  rollingOriginMae,
  cupedDays,
  standardizedDiff,
  holmRejections,
];
