// Расширение банка ai.ml-engineering: +3 Junior, +5 Middle, +4 Senior (решение владельца 11.10).
// Закрывает пробел «воспроизводимый пайплайн» (seed, версии данных, перезапуск стадий, point-in-time признаки).
import { family, fx, sum } from './ai-bank2-util';
import { table } from './ai-util';

const SUB = 'ai.ml-engineering';

function nearHalf2(x: number): boolean {
  return Math.abs(Math.abs((x * 100) % 1) - 0.5) < 0.03;
}

// ---------------------------------------------------------------------------
// Junior
// ---------------------------------------------------------------------------

export const kFoldTrainSize = family(
  { id: 'ai.kfold-train-size', taskId: 'task:model-selection', title: 'Сколько строк обучения на фолде', sub: SUB, grade: 'junior', catalogIds: ['ai.validation'], a: 1.3, b: -1.0, space: 1e4, time: 180 },
  (rng) => {
    for (;;) {
      const k = rng.pick([3, 4, 5, 6, 7]);
      const n = rng.int(40, 400) + rng.int(0, 6);
      if (n % k === 0) continue;
      const idx = rng.int(1, k);
      const rem = n % k;
      const sizes = Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < rem ? 1 : 0));
      return {
        prompt: `Датасет из ${n} строк делят на ${k} фолдов подряд без перемешивания так, чтобы размеры отличались не больше чем на 1; более крупные фолды идут первыми (первые ${rem} фолд${rem === 1 ? '' : 'ов'} на строку больше). На итерации кросс-валидации фолд №${idx} - валидационный, остальные - обучающие. Сколько строк в обучении на этой итерации?`,
        answerHint: 'число строк',
        answerKey: String(n - sizes[idx - 1]!),
        explanation: `Размеры фолдов: ${sizes.join(', ')}. Валидация - ${sizes[idx - 1]} строк, обучение: ${n} - ${sizes[idx - 1]} = ${n - sizes[idx - 1]!}.`,
        params: { n, k, idx },
      };
    }
  },
);

export const seedReproCount = family(
  { id: 'ai.seed-repro-count', taskId: 'task:split-sizes', title: 'Какие запуски воспроизводят эталон', sub: SUB, grade: 'junior', catalogIds: ['ai.ml-baseline'], a: 1.3, b: -0.9, space: 1e7, time: 180 },
  (rng) => {
    const ref = { seed: 42, data: 'a1f3', commit: 'c09e', lib: '1.4.2' };
    const alt = { seed: [7, 13, 99], data: ['b2c4', 'a1f0'], commit: ['d51a', 'c09f'], lib: ['1.5.0', '1.4.1'] };
    const runs = Array.from({ length: rng.int(10, 15) }, () => {
      const r = { ...ref };
      if (rng.next() < 0.5) {
        const f = rng.pick(['seed', 'data', 'commit', 'lib'] as const);
        if (f === 'seed') r.seed = rng.pick(alt.seed);
        if (f === 'data') r.data = rng.pick(alt.data);
        if (f === 'commit') r.commit = rng.pick(alt.commit);
        if (f === 'lib') r.lib = rng.pick(alt.lib);
      }
      return r;
    });
    const same = runs.filter((r) => r.seed === ref.seed && r.data === ref.data && r.commit === ref.commit && r.lib === ref.lib).length;
    return {
      prompt: `Эталонный запуск: seed ${ref.seed}, версия данных ${ref.data}, коммит кода ${ref.commit}, версия библиотеки ${ref.lib}. Обучение детерминировано: результат повторяется только при совпадении всех четырёх параметров. Сколько из запусков ниже гарантированно воспроизведут результат эталона?`,
      code: table(['запуск', 'seed', 'данные', 'коммит', 'библиотека'], runs.map((r, i) => [i + 1, r.seed, r.data, r.commit, r.lib])),
      answerHint: 'число запусков',
      answerKey: String(same),
      explanation: `Совпадают по всем четырём параметрам ${same} запусков; любое отличие - в seed, данных, коде или версии библиотеки - снимает гарантию.`,
      params: { runs: runs.map((r) => `${r.seed}/${r.data}/${r.commit}/${r.lib}`).join('|') },
    };
  },
);

export const regressionError = family(
  { id: 'ai.regression-error', taskId: 'task:classification-metrics', title: 'Ошибка регрессии по таблице', sub: SUB, grade: 'junior', catalogIds: ['ai.ml-metrics'], a: 1.3, b: -1.1, space: 1e7, time: 180 },
  (rng) => {
    for (;;) {
      const n = rng.int(5, 6);
      const rows = Array.from({ length: n }, () => {
        const y = rng.int(10, 60);
        return { y, p: y + rng.int(-9, 9) };
      });
      const metric = rng.pick(['MAE', 'RMSE'] as const);
      const abs = rows.map((r) => Math.abs(r.y - r.p));
      const v = metric === 'MAE' ? sum(abs) / n : Math.sqrt(sum(abs.map((x) => x * x)) / n);
      if (Math.abs(((v * 100) % 1) - 0.5) < 0.03) continue;
      return {
        prompt: `Модель предсказывает цену. Посчитайте ${metric === 'MAE' ? 'MAE - среднюю абсолютную ошибку' : 'RMSE - корень из средней квадратичной ошибки'} по таблице.`,
        code: table(['факт', 'прогноз'], rows.map((r) => [r.y, r.p])),
        answerHint: 'до 2 знаков',
        answerKey: fx(v, 2),
        explanation: `Ошибки: ${rows.map((r) => r.p - r.y).join(', ')}. ${metric === 'MAE' ? `Среднее модулей = ${sum(abs)} / ${n}` : `Среднее квадратов = ${sum(abs.map((x) => x * x))} / ${n}, корень`} = ${fx(v, 2)}.`,
        params: { metric, rows: rows.map((r) => `${r.y}:${r.p}`).join(',') },
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Middle
// ---------------------------------------------------------------------------

export const groupLeakCount = family(
  { id: 'ai.group-leak-count', taskId: 'task:data-leakage', title: 'Сколько тестовых строк затронуто групповой утечкой', sub: SUB, grade: 'middle', catalogIds: ['ai.data-leakage', 'ai.validation'], a: 1.2, b: 0.3, space: 1e8, time: 240 },
  (rng) => {
    const n = rng.int(20, 34);
    const rows = Array.from({ length: n }, () => ({ client: rng.pick(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12']), part: rng.pick(['train', 'train', 'test']) }));
    const byClient = new Map<string, Set<string>>();
    for (const r of rows) byClient.set(r.client, (byClient.get(r.client) ?? new Set()).add(r.part));
    const leaked = [...byClient.entries()].filter(([, s]) => s.size === 2).map(([c]) => c);
    const leakedRows = rows.filter((r) => r.part === 'test' && leaked.includes(r.client)).length;
    return {
      prompt: 'Строки датасета (по одной на покупку) случайно разложили в train и test. Все покупки одного клиента похожи, поэтому модель не должна видеть клиента в обучении, если он есть в тесте. Клиент, встречающийся и в train, и в test, - групповая утечка. Сколько строк test принадлежат таким клиентам?',
      code: rows.map((r, i) => `${i + 1}. клиент ${r.client} → ${r.part}`).join('\n'),
      answerHint: 'число строк',
      answerKey: String(leakedRows),
      explanation: `В обеих частях встречаются: ${leaked.length ? leaked.join(', ') : 'никто'}; в test их строк - ${leakedRows}. Для таких данных нужно делить по клиентам (GroupKFold), а не по строкам.`,
      params: { rows: rows.map((r) => `${r.client}/${r.part}`).join(',') },
    };
  },
);

export const pipelineRerun = family(
  { id: 'ai.pipeline-rerun', taskId: 'task:feature-pipeline', title: 'Какие стадии пайплайна перезапустятся', sub: SUB, grade: 'middle', catalogIds: ['ai.feature-pipeline', 'ai.ml-baseline'], a: 1.2, b: 0.4, space: 1e9, time: 270 },
  (rng) => {
    const n = 8;
    const names = ['load', 'clean', 'split', 'encode', 'scale', 'select', 'train', 'report'];
    const deps: number[][] = names.map((_, i) => (i === 0 ? [] : rng.sample(Array.from({ length: i }, (_, j) => j), Math.min(i, rng.int(1, 2)))));
    const changed = rng.int(0, 4);
    const dirty = new Set([changed]);
    for (let i = changed + 1; i < n; i++) if (deps[i]!.some((d) => dirty.has(d))) dirty.add(i);
    return {
      prompt: `Пайплайн обучения воспроизводим: каждая стадия кешируется по хешу входов (как в DVC) и перезапускается, только если изменился её вход или вход любой стадии, от которой она зависит. Изменился код стадии ${names[changed]}. Сколько стадий будет перезапущено (включая саму ${names[changed]})?`,
      code: table(['стадия', 'зависит от'], names.map((nm, i) => [nm, deps[i]!.length ? deps[i]!.map((d) => names[d]).join(', ') : '-'])),
      answerHint: 'число стадий',
      answerKey: String(dirty.size),
      explanation: `Перезапускаются ${[...dirty].map((i) => names[i]).join(', ')} - сама изменённая стадия и все, кто зависит от неё прямо или через другие стадии: ${dirty.size}.`,
      params: { changed, deps: deps.map((d) => d.join('+')).join('|') },
    };
  },
);

export const cvModelChoice = family(
  { id: 'ai.cv-model-choice', taskId: 'task:model-selection', title: 'Какую модель выбрать по кросс-валидации', sub: SUB, grade: 'middle', catalogIds: ['ai.validation', 'ai.ml-baseline'], a: 1.2, b: 0.5, space: 1e9, time: 300 },
  (rng) => {
    for (;;) {
      const names = ['linear', 'forest', 'boost'];
      const models = names.map((m, i) => {
        const base = [78, 83, 85][i]! + rng.int(-2, 2);
        return { m, scores: Array.from({ length: 5 }, () => base + rng.int(-4, 4)), cost: [2, 15, 40][i]! + rng.int(0, 3) };
      });
      const stat = models.map((x) => {
        const mean = sum(x.scores) / x.scores.length;
        const sd = Math.sqrt(sum(x.scores.map((s) => (s - mean) ** 2)) / (x.scores.length - 1));
        return { ...x, mean, sd };
      });
      const best = [...stat].sort((a, b) => b.mean - a.mean)[0]!;
      const ok = stat.filter((x) => x.mean >= best.mean - best.sd).sort((a, b) => a.cost - b.cost);
      if (ok[0]!.m === best.m && rng.next() < 0.6) continue;
      if (nearHalf2(ok[0]!.mean)) continue;
      return {
        prompt: 'Три модели оценены 5-фолдовой кросс-валидацией (метрика - accuracy, %). Правило одного стандартного отклонения: берём лучшую по среднему модель, затем выбираем самую дешёвую по времени обучения среди тех, чьё среднее не ниже (среднее лучшей - стандартное отклонение лучшей). Отклонение - выборочное (деление на 4). Модель выбрана по этому правилу. Чему равна её средняя accuracy по фолдам, % (до 2 знаков)?',
        code: table(['модель', 'accuracy по фолдам', 'обучение, мин'], models.map((x) => [x.m, x.scores.join(' '), x.cost])),
        answerHint: '% до 2 знаков',
        answerKey: fx(ok[0]!.mean, 2),
        explanation: `Лучшая по среднему - ${best.m} (${fx(best.mean, 2)}, σ = ${fx(best.sd, 2)}); порог ${fx(best.mean - best.sd, 2)}. Подходят: ${ok.map((x) => `${x.m} (${fx(x.mean, 2)})`).join(', ')}; самая дешёвая - ${ok[0]!.m} со средним ${fx(ok[0]!.mean, 2)}.`,
        params: { models: models.map((x) => `${x.scores.join('.')}/${x.cost}`).join('|') },
      };
    }
  },
);

export const classWeight = family(
  { id: 'ai.class-weight', taskId: 'task:majority-baseline', title: 'Вес класса при дисбалансе', sub: SUB, grade: 'middle', catalogIds: ['ai.ml-metrics', 'ai.ml-baseline'], a: 1.2, b: 0.2, space: 1e6, time: 210 },
  (rng) => {
    for (;;) {
      const counts = [rng.int(5, 40) * 50, rng.int(2, 20) * 50, rng.int(1, 8) * 50];
      const names = rng.shuffle(['A', 'B', 'C']);
      const n = sum(counts);
      const which = rng.int(0, 2);
      const w = n / (3 * counts[which]!);
      if (Math.abs(((w * 100) % 1) - 0.5) < 0.03) continue;
      return {
        prompt: `В обучающей выборке ${n} объектов, классов три. Веса классов задают формулой n / (K · n_c): n - число объектов, K - число классов, n_c - число объектов класса. Чему равен вес класса ${names[which]}?`,
        code: table(['класс', 'объектов'], names.map((nm, i) => [nm, counts[i]!])),
        answerHint: 'до 2 знаков',
        answerKey: fx(w, 2),
        explanation: `${n} / (3 · ${counts[which]}) = ${fx(w, 2)}. Редкий класс получает вес больше 1, частый - меньше 1.`,
        params: { counts: counts.join(','), which },
      };
    }
  },
);

export const oofTargetEncoding = family(
  { id: 'ai.oof-target-encoding', taskId: 'task:feature-pipeline', title: 'Target encoding без утечки', sub: SUB, grade: 'middle', catalogIds: ['ai.feature-pipeline', 'ai.data-leakage'], a: 1.2, b: 0.6, space: 1e9, time: 300 },
  (rng) => {
    for (;;) {
      const rows = Array.from({ length: 20 }, () => ({ cat: rng.pick(['msk', 'spb']), fold: rng.int(1, 3), y: rng.int(0, 1) }));
      const i = rng.int(0, rows.length - 1);
      const peers = rows.filter((r, j) => j !== i && r.cat === rows[i]!.cat && r.fold !== rows[i]!.fold);
      if (peers.length < 4) continue;
      const mean = sum(peers.map((r) => r.y)) / peers.length;
      if (Math.abs(((mean * 100) % 1) - 0.5) < 0.03) continue;
      return {
        prompt: `Категориальный признак «город» кодируют средним значением цели. Чтобы не было утечки, значение для строки считается только по строкам этого же города из других фолдов (out-of-fold). Чему равно закодированное значение для строки ${i + 1}?`,
        code: table(['строка', 'город', 'фолд', 'цель'], rows.map((r, j) => [j + 1, r.cat, r.fold, r.y])),
        answerHint: 'до 2 знаков',
        answerKey: fx(mean, 2),
        explanation: `Строки города ${rows[i]!.cat} из фолдов, отличных от ${rows[i]!.fold}: ${peers.length} шт., цель в среднем ${fx(mean, 2)}. Своя строка и своя фолд-группа в среднее не входят.`,
        params: { rows: rows.map((r) => `${r.cat}:${r.fold}:${r.y}`).join(','), i },
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Senior
// ---------------------------------------------------------------------------

export const nestedCvTime = family(
  { id: 'ai.nested-cv-time', taskId: 'task:model-selection', title: 'Сколько займёт вложенная кросс-валидация', sub: SUB, grade: 'senior', catalogIds: ['ai.validation', 'ai.ml-baseline'], a: 1.2, b: 1.0, space: 1e5, time: 300 },
  (rng) => {
    const outer = rng.pick([3, 5, 10]);
    const inner = rng.pick([3, 4, 5]);
    const grid = rng.int(4, 40);
    const fit = rng.pick([2, 3, 5, 8, 12]);
    const workers = rng.pick([2, 3, 4, 6, 8]);
    const fits = outer * (inner * grid + 1);
    const minutes = Math.ceil(fits / workers) * fit;
    return {
      prompt: `Оценка модели с подбором гиперпараметров идёт вложенной кросс-валидацией: внешних фолдов ${outer}; на каждом внешнем обучении внутренняя ${inner}-фолдовая кросс-валидация перебирает сетку из ${grid} комбинаций, после чего модель с лучшей комбинацией один раз переобучается на всём внешнем обучении. Одно обучение занимает ${fit} мин, параллельно работает ${workers} воркеров (обучения независимы и распределяются без простоев). Сколько минут займёт вся процедура?`,
      answerHint: 'минуты',
      answerKey: String(minutes),
      explanation: `Обучений: ${outer} × (${inner} × ${grid} + 1) = ${fits}. Волн по ${workers}: ceil(${fits} / ${workers}) = ${Math.ceil(fits / workers)}; ${Math.ceil(fits / workers)} × ${fit} = ${minutes} мин.`,
      params: { outer, inner, grid, fit, workers },
    };
  },
);

export const mcnemarMinB = family(
  { id: 'ai.mcnemar-min-b', taskId: 'task:model-selection', title: 'Когда одна модель значимо лучше другой', sub: SUB, grade: 'senior', catalogIds: ['ai.ml-metrics', 'ai.validation'], a: 1.2, b: 1.3, space: 1e3, time: 330 },
  (rng) => {
    const c = rng.int(5, 70);
    const crit = rng.pick([{ z: 3.84, p: '5 %' }, { z: 6.63, p: '1 %' }]);
    let b = c + 1;
    while ((b - c - 1) ** 2 / (b + c) <= crit.z) b++;
    return {
      prompt: `Две модели сравнивают на одном тестовом наборе. Модель B ошиблась там, где A права, в c = ${c} объектах; A ошиблась там, где B права, - в b объектах (на остальных они согласны). Критерий Мак-Немара с поправкой на непрерывность: χ² = (|b - c| - 1)² / (b + c); различие значимо на уровне ${crit.p}, если χ² > ${crit.z}. При каком наименьшем целом b > c различие значимо?`,
      answerHint: 'наименьшее b',
      answerKey: String(b),
      explanation: `Для b = ${b - 1}: χ² = ${fx((b - 1 - c - 1) ** 2 / (b - 1 + c), 2)} ≤ ${crit.z}; для b = ${b}: χ² = ${fx((b - c - 1) ** 2 / (b + c), 2)} > ${crit.z}.`,
      params: { c, z: crit.z },
    };
  },
);

export const alertThresholdCapacity = family(
  { id: 'ai.alert-threshold-capacity', taskId: 'task:threshold-choice', title: 'Порог при ограниченной команде разметчиков', sub: SUB, grade: 'senior', catalogIds: ['ai.ml-metrics'], a: 1.3, b: 1.2, space: 1e10, time: 360 },
  (rng) => {
    for (;;) {
      const thr = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
      const tpr = rng.sample([97, 94, 91, 88, 84, 80, 75, 70, 64, 58], 6).sort((a, b) => b - a);
      const fpr = rng.sample([30, 22, 16, 11, 8, 6, 4, 3, 2, 1], 6).sort((a, b) => b - a);
      const events = rng.int(5, 30) * 1000;
      const prev = rng.pick([1, 2, 5]);
      const cap = rng.int(2, 30) * 50;
      const rows = thr.map((t, i) => ({ t, tpr: tpr[i]!, fpr: fpr[i]!, alerts: events * ((prev * tpr[i]!) / 10000 + ((100 - prev) * fpr[i]!) / 10000) }));
      if (rows.some((r) => Math.abs(r.alerts - cap) < 5)) continue;
      const ok = rows.filter((r) => r.alerts <= cap);
      if (ok.length === 0 || ok.length === rows.length) continue;
      const best = [...ok].sort((a, b) => b.tpr - a.tpr)[0]!;
      return {
        prompt: `Антифрод-модель оценивает ${events} событий в сутки, доля настоящих нарушений - ${prev} %. Команда может проверить вручную не больше ${cap} сработавших алертов в сутки. Для каждого порога в таблице известны TPR и FPR (в %). Выберите порог, при котором ловится как можно больше нарушений и команда не перегружена. Сколько алертов в сутки придётся проверять при этом пороге (округлите до целого)?`,
        code: table(['порог', 'TPR, %', 'FPR, %'], rows.map((r) => [r.t, r.tpr, r.fpr])),
        answerHint: 'алертов в сутки',
        answerKey: String(Math.round(best.alerts)),
        explanation: `Алертов в сутки = события × (доля нарушений × TPR + (1 - доля) × FPR): ${rows.map((r) => `${r.t} → ${Math.round(r.alerts)}`).join(', ')}. В лимит ${cap} укладываются ${ok.map((r) => r.t).join(', ')}; максимальный TPR у ${best.t} (алертов ${Math.round(best.alerts)}). Из-за редкости класса почти все алерты - ложные, поэтому важна именно FPR.`,
        params: { events, prev, cap, rows: rows.map((r) => `${r.t}:${r.tpr}:${r.fpr}`).join(',') },
      };
    }
  },
);

export const pointInTimeFeature = family(
  { id: 'ai.point-in-time-feature', taskId: 'task:temporal-split', title: 'Значение признака без заглядывания в будущее', sub: SUB, grade: 'senior', catalogIds: ['ai.data-leakage', 'ai.feature-pipeline'], a: 1.2, b: 1.1, space: 1e9, time: 300 },
  (rng) => {
    for (;;) {
      const label = rng.int(30, 60);
      const window = rng.pick([7, 14, 21]);
      const events = Array.from({ length: rng.int(10, 14) }, () => rng.int(label - 30, label + 8)).sort((a, b) => a - b);
      const asOf = events.filter((d) => d >= label - window && d < label).length;
      const naive = events.filter((d) => d >= label - window && d <= label + window).length;
      if (asOf === naive) continue;
      return {
        prompt: `Признак «число покупок клиента за последние ${window} дней» считают для обучающего примера с меткой на дне ${label} (метка известна к началу этого дня, покупки в сам день ${label} и позже ещё не произошли). Признак должен совпадать с тем, что видел бы сервис в момент предсказания (point-in-time). Каково значение признака?`,
        code: `дни покупок клиента: ${events.join(', ')}`,
        answerHint: 'число покупок',
        answerKey: String(asOf),
        explanation: `Подходят дни из [${label - window}; ${label - 1}] - ${asOf} шт. События с дня ${label} и позже в признак попадать не должны: иначе офлайн-метрика завышена, а в продакшене такого значения не будет.`,
        params: { label, window, events: events.join(',') },
      };
    }
  },
);

export const AI_BANK2_ML = [
  kFoldTrainSize,
  seedReproCount,
  regressionError,
  groupLeakCount,
  pipelineRerun,
  cvModelChoice,
  classWeight,
  oofTargetEncoding,
  nestedCvTime,
  mcnemarMinB,
  alertThresholdCapacity,
  pointInTimeFeature,
];
