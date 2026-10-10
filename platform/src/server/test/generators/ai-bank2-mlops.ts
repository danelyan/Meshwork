// Расширение банка ai.mlops: +3 Junior, +5 Middle, +4 Senior (решение владельца 11.10).
// Утверждений каталога у подкатегории всего три (serving, versioning, monitoring-drift), поэтому новые семейства
// распределены по ним равномерно: версии/реестр, дрейф/мониторинг, serving/ёмкость.
import { family, fx, sum } from './ai-bank2-util';
import { table } from './ai-util';

const SUB = 'ai.mlops';

// ---------------------------------------------------------------------------
// Junior
// ---------------------------------------------------------------------------

export const registryStage = family(
  { id: 'ai.registry-stage', taskId: 'task:model-registry', title: 'Какая версия в Production после операций', sub: SUB, grade: 'junior', catalogIds: ['ai.model-versioning'], a: 1.3, b: -0.8, space: 1e6, time: 210 },
  (rng) => {
    for (;;) {
      const ops: string[] = [];
      const stack: number[] = [];
      let registered = 0;
      for (let i = 0; i < 9; i++) {
        const can = { promote: registered > 0, rollback: stack.length >= 2 };
        const r = rng.next();
        if (registered < 2 || (r < 0.25 && registered < 5)) {
          registered++;
          ops.push(`register v${registered}`);
        } else if (can.rollback && r < 0.55) {
          stack.pop();
          ops.push('rollback');
        } else if (can.promote) {
          const cand = Array.from({ length: registered }, (_, j) => j + 1).filter((v) => v !== stack[stack.length - 1]);
          const v = rng.pick(cand);
          stack.push(v);
          ops.push(`promote v${v}`);
        }
      }
      if (stack.length < 2 || !ops.includes('rollback')) continue;
      const cur = stack[stack.length - 1]!;
      return {
        prompt: 'Реестр моделей. register vN - добавляет версию без стадии. promote vN - переводит vN в Production, а прежняя Production-версия уходит в Archived. rollback - возвращает в Production версию, которая была в Production непосредственно перед текущей, а текущую отправляет в Archived. Какая версия в Production после всех операций?',
        code: ops.map((o, i) => `${i + 1}. ${o}`).join('\n'),
        answerHint: 'номер версии, например 2',
        answerKey: String(cur),
        explanation: `История Production-версий (стек): ${stack.join(' → ')}. Откат снимает верхнюю версию, так что в конце в Production v${cur}.`,
        params: { ops: ops.join(';') },
      };
    }
  },
);

export const driftMeanShift = family(
  { id: 'ai.drift-mean-shift', taskId: 'task:monitoring-alert', title: 'Насколько сдвинулся признак', sub: SUB, grade: 'junior', catalogIds: ['ai.monitoring-drift'], a: 1.3, b: -1.0, space: 1e7, time: 180 },
  (rng) => {
    for (;;) {
      const mu = rng.int(20, 120);
      const sd = rng.int(4, 20);
      const nu = mu + rng.int(-25, 25);
      const z = Math.abs(nu - mu) / sd;
      if (Math.abs(((z * 100) % 1) - 0.5) < 0.03) continue;
      return {
        prompt: `Признак «возраст аккаунта, дни» на обучении: среднее ${mu}, стандартное отклонение ${sd}. За последнюю неделю в продакшене среднее ${nu}. На сколько стандартных отклонений обучения (по модулю) сдвинулось среднее?`,
        answerHint: 'до 2 знаков',
        answerKey: fx(z, 2),
        explanation: `|${nu} - ${mu}| / ${sd} = ${fx(z, 2)}.`,
        params: { mu, sd, nu },
      };
    }
  },
);

export const replicasNeeded = family(
  { id: 'ai.replicas-needed', taskId: 'task:batch-inference', title: 'Сколько реплик модели нужно', sub: SUB, grade: 'junior', catalogIds: ['ai.model-serving'], a: 1.3, b: -0.9, space: 1e6, time: 180 },
  (rng) => {
    const peak = rng.int(10, 80) * 10;
    const per = rng.int(3, 20) * 5;
    const util = rng.pick([50, 60, 70, 80]);
    const need = Math.ceil(peak / ((per * util) / 100) - 1e-9);
    return {
      prompt: `Пиковая нагрузка на модель - ${peak} запросов в секунду. Одна реплика выдерживает ${per} запросов в секунду, но планировать её загрузку нужно не выше ${util} %. Сверх расчёта добавляют ещё одну резервную реплику на случай отказа. Сколько реплик развернуть?`,
      answerHint: 'число реплик',
      answerKey: String(need + 1),
      explanation: `Полезная ёмкость реплики: ${per} × ${util} % = ${(per * util) / 100} rps. ${peak} / ${(per * util) / 100} с округлением вверх = ${need}, плюс резерв = ${need + 1}.`,
      params: { peak, per, util },
    };
  },
);

// ---------------------------------------------------------------------------
// Middle
// ---------------------------------------------------------------------------

export const ksDriftStat = family(
  { id: 'ai.ks-drift-stat', taskId: 'task:drift-psi', title: 'Статистика Колмогорова-Смирнова', sub: SUB, grade: 'middle', catalogIds: ['ai.monitoring-drift'], a: 1.2, b: 0.4, space: 1e12, time: 300 },
  (rng) => {
    const pool = rng.sample(Array.from({ length: 60 }, (_, i) => i + 1), 16);
    const train = pool.slice(0, 8).sort((a, b) => a - b);
    const prod = pool.slice(8).sort((a, b) => a - b);
    let d = 0;
    for (const x of [...train, ...prod]) {
      const f1 = train.filter((v) => v <= x).length / train.length;
      const f2 = prod.filter((v) => v <= x).length / prod.length;
      d = Math.max(d, Math.abs(f1 - f2));
    }
    return {
      prompt: 'Значения признака в обучении и в продакшене (по 8 наблюдений, все значения различны). Статистика Колмогорова-Смирнова - максимум модуля разности эмпирических функций распределения F_train(x) и F_prod(x), где F(x) - доля наблюдений ≤ x. Чему она равна?',
      code: `train: ${train.join(', ')}\nprod:  ${prod.join(', ')}`,
      answerHint: 'до 3 знаков',
      answerKey: fx(d, 3),
      explanation: `Проходим по объединённым значениям и берём максимум |F_train - F_prod|: ${fx(d, 3)}. Чем больше D, тем сильнее различаются распределения.`,
      params: { train: train.join(','), prod: prod.join(',') },
    };
  },
);

export const labelDelayAccuracy = family(
  { id: 'ai.label-delay-accuracy', taskId: 'task:retrain-trigger', title: 'Accuracy по уже размеченным предсказаниям', sub: SUB, grade: 'middle', catalogIds: ['ai.monitoring-drift'], a: 1.2, b: 0.5, space: 1e9, time: 300 },
  (rng) => {
    for (;;) {
      const days = Array.from({ length: 10 }, () => ({ v: rng.int(4, 20) * 100, acc: rng.int(70, 96) }));
      const delay = rng.int(2, 5);
      const today = rng.int(7, 10);
      const known = days.slice(0, today).filter((_, i) => i + 1 + delay <= today);
      if (known.length < 2) continue;
      const total = sum(known.map((d) => d.v));
      const correct = sum(known.map((d) => (d.v * d.acc) / 100));
      const acc = (correct / total) * 100;
      if (Math.abs(((acc * 10) % 1) - 0.5) < 0.03) continue;
      return {
        prompt: `Модель делает предсказания каждый день (день 1 - самый ранний). Истинные метки приходят с задержкой ${delay} дн.: метки предсказаний дня d известны к концу дня d + ${delay}. Сейчас конец дня ${today}. По таблице посчитайте accuracy модели (%, взвешенно по числу предсказаний) только по предсказаниям, для которых метки уже известны.`,
        code: table(['день', 'предсказаний', 'доля верных, % (по итогам разметки)'], days.slice(0, today).map((d, i) => [i + 1, d.v, d.acc])),
        answerHint: '% до 1 знака',
        answerKey: fx(acc, 1),
        explanation: `Метки есть у дней 1…${today - delay} (${known.length} дн.): верных ${fx(correct, 1)} из ${total}. ${fx(correct, 1)} / ${total} = ${fx(acc, 1)} %. Свежие дни пока оценить нельзя - поэтому мониторинг качества отстаёт и дополняется мониторингом входов.`,
        params: { delay, today, days: days.map((d) => `${d.v}:${d.acc}`).join(',') },
      };
    }
  },
);

export const batchVsOnline = family(
  { id: 'ai.batch-vs-online', taskId: 'task:inference-mode', title: 'Сколько стоит дешёвый режим инференса', sub: SUB, grade: 'middle', catalogIds: ['ai.model-serving'], a: 1.2, b: 0.3, space: 1e9, time: 300 },
  (rng) => {
    const price = rng.pick([2, 3, 4, 5, 8]);
    const peak = rng.int(2, 20) * 10;
    const per = rng.int(2, 8) * 5;
    const onlineN = Math.ceil(peak / per);
    const online = onlineN * price * 24 * 30;
    const daily = rng.int(1, 40) * 100_000;
    const rate = rng.int(2, 10) * 10;
    const workers = rng.int(1, 4);
    const hours = Math.ceil(daily / (workers * rate) / 3600);
    const batch = hours * workers * price * 30;
    return {
      prompt: `Есть два способа считать предсказания. Онлайн: инстансы работают круглосуточно, пик ${peak} запросов в секунду, один инстанс выдерживает ${per}. Пакетный: раз в сутки ${workers} инстанс(а) обрабатывают ${daily} записей со скоростью ${rate} записей в секунду на инстанс, оплата помесячно за часы работы (время округляется вверх до целого часа). Цена инстанса - ${price} $ в час, в месяце 30 суток. Сколько долларов в месяц стоит более дешёвый вариант?`,
      answerHint: '$ в месяц',
      answerKey: String(Math.min(online, batch)),
      explanation: `Онлайн: ceil(${peak} / ${per}) = ${onlineN} инстансов × ${price} × 24 × 30 = ${online} $. Пакетный: ${daily} / (${workers} × ${rate}) = ${fx(daily / (workers * rate) / 3600, 2)} ч → ${hours} ч × ${workers} × ${price} × 30 = ${batch} $. Дешевле ${online < batch ? 'онлайн' : 'пакетный'}: ${Math.min(online, batch)} $.`,
      params: { price, peak, per, daily, rate, workers },
    };
  },
);

export const modelLineage = family(
  { id: 'ai.model-lineage', taskId: 'task:model-registry', title: 'Какие модели затронул плохой датасет', sub: SUB, grade: 'middle', catalogIds: ['ai.model-versioning', 'ai.monitoring-drift'], format: 'list', a: 1.2, b: 0.4, space: 1e9, time: 300 },
  (rng) => {
    for (;;) {
      const rows = Array.from({ length: 6 }, (_, i) => ({
        m: `m${i + 1}`,
        data: `ds${rng.int(1, 3)}`,
        base: i >= 2 && rng.next() < 0.45 ? `m${rng.int(1, i)}` : '-',
      }));
      const bad = 'ds2';
      const tainted = new Set<string>();
      for (const r of rows) if (r.data === bad || (r.base !== '-' && tainted.has(r.base))) tainted.add(r.m);
      if (tainted.size < 2 || tainted.size > 5) continue;
      if (!rows.some((r) => r.base !== '-' && r.data !== bad && tainted.has(r.m))) continue;
      return {
        prompt: `В реестре моделей у каждой версии указаны версия датасета обучения и базовая модель (если её дообучали, база - любая более ранняя версия). Обнаружено, что датасет ${bad} испорчен. Модель считается затронутой, если обучалась на ${bad} или дообучена от затронутой модели. Перечислите затронутые версии.`,
        code: table(['модель', 'датасет', 'база'], rows.map((r) => [r.m, r.data, r.base])),
        answerHint: 'через запятую, например m1,m3',
        answerKey: [...tainted].sort().join(','),
        explanation: `Напрямую на ${bad} обучены ${rows.filter((r) => r.data === bad).map((r) => r.m).join(', ') || 'никто'}; дообучены от затронутых ещё ${rows.filter((r) => r.data !== bad && tainted.has(r.m)).map((r) => r.m).join(', ')}. Итого: ${[...tainted].sort().join(', ')}. Без хранения происхождения (lineage) такой отбор вручную неполон.`,
        params: { rows: rows.map((r) => `${r.data}/${r.base}`).join('|') },
      };
    }
  },
);

export const autoscaleSim = family(
  { id: 'ai.autoscale-sim', taskId: 'task:inference-mode', title: 'Сколько реплик после автоскейлинга', sub: SUB, grade: 'middle', catalogIds: ['ai.model-serving', 'ai.monitoring-drift'], a: 1.2, b: 0.6, space: 1e10, time: 330 },
  (rng) => {
    for (;;) {
      const start = rng.int(2, 3);
      const cpu = Array.from({ length: 12 }, () => rng.pick([20, 28, 40, 55, 68, 78, 85, 92]));
      let n = start;
      let hi = 0;
      let lo = 0;
      let cool = 0;
      let changes = 0;
      for (const c of cpu) {
        if (cool > 0) {
          cool--;
          hi = 0;
          lo = 0;
          continue;
        }
        hi = c > 75 ? hi + 1 : 0;
        lo = c < 30 ? lo + 1 : 0;
        if (hi === 2 && n < 6) {
          n++;
          changes++;
          cool = 2;
          hi = 0;
          lo = 0;
        } else if (lo === 3 && n > 1) {
          n--;
          changes++;
          cool = 2;
          hi = 0;
          lo = 0;
        }
      }
      if (changes < 2) continue;
      return {
        prompt: `Сервис модели стартует с ${start} репликами. Каждую минуту замеряется средний CPU. Правила: если CPU выше 75 % две минуты подряд - добавить реплику (максимум 6); если ниже 30 % три минуты подряд - убрать реплику (минимум 1). После любого изменения следующие 2 минуты замеры игнорируются (не считаются в «подряд», изменений нет). Сколько реплик будет после 12 минут?`,
        code: cpu.map((c, i) => `мин ${i + 1}: ${c}%`).join('\n'),
        answerHint: 'число реплик',
        answerKey: String(n),
        explanation: `Прогоняем минуты по правилам: изменений было ${changes}, итог - ${n} реплик. Окна «подряд» сбрасываются и после изменения, и во время паузы.`,
        params: { start, cpu: cpu.join(',') },
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Senior
// ---------------------------------------------------------------------------

export const driftTriageFirst = family(
  { id: 'ai.drift-triage-first', taskId: 'task:drift-psi', title: 'С какого признака разбирать дрейф', sub: SUB, grade: 'senior', catalogIds: ['ai.monitoring-drift'], format: 'text', a: 1.2, b: 1.0, space: 1e9, time: 300 },
  (rng) => {
    for (;;) {
      const names = ['age', 'income', 'region', 'tenure', 'device', 'score'];
      const imp = rng.shuffle([30, 24, 18, 12, 10, 6]);
      const feats = names.map((f, i) => ({ f, imp: imp[i]!, psi: rng.pick([2, 4, 6, 9, 12, 18, 25, 31, 44]) }));
      const risk = feats.map((x) => ({ ...x, risk: x.imp * x.psi }));
      const ranked = [...risk].sort((a, b) => b.risk - a.risk);
      const maxPsi = [...risk].sort((a, b) => b.psi - a.psi)[0]!;
      if (ranked[0]!.risk === ranked[1]!.risk || ranked[0]!.f === maxPsi.f) continue;
      return {
        prompt: 'После выкатки мониторинг показал PSI по признакам. Команде нужно сначала разобраться с признаком, дрейф которого сильнее всего влияет на прогноз: приоритет = важность признака (% вклада в модель) × PSI (в сотых долях). С какого признака начать?',
        code: table(['признак', 'важность, %', 'PSI, сотых'], feats.map((x) => [x.f, x.imp, x.psi])),
        answerHint: 'название признака',
        answerKey: ranked[0]!.f,
        explanation: `Приоритеты: ${ranked.map((x) => `${x.f} ${x.risk}`).join(', ')}. Признак с самым большим PSI (${maxPsi.f}) может быть малозначимым для модели, поэтому смотреть нужно на произведение.`,
        params: { feats: feats.map((x) => `${x.f}:${x.imp}:${x.psi}`).join(',') },
      };
    }
  },
);

export const retrainPeriod = family(
  { id: 'ai.retrain-period', taskId: 'task:retrain-trigger', title: 'Оптимальный период переобучения', sub: SUB, grade: 'senior', catalogIds: ['ai.monitoring-drift', 'ai.model-versioning'], a: 1.2, b: 1.2, space: 1e6, time: 330 },
  (rng) => {
    for (;;) {
      const decay = rng.pick([2, 3, 5, 8]); // десятые доли п.п. в неделю
      const loss = rng.pick([100, 200, 500, 1000]); // $ за 1 п.п. за неделю
      const cost = rng.int(5, 80) * 100;
      const avg = (t: number) => cost / t + (decay / 10) * loss * ((t - 1) / 2);
      const all = Array.from({ length: 26 }, (_, i) => ({ t: i + 1, v: avg(i + 1) }));
      const sorted = [...all].sort((a, b) => a.v - b.v);
      if (sorted[1]!.v - sorted[0]!.v < 1 || sorted[0]!.t === 26 || sorted[0]!.t === 1) continue;
      return {
        prompt: `Точность модели после переобучения падает линейно: на ${decay / 10} п.п. за каждую следующую неделю (в первую неделю после обучения потерь нет, во вторую - ${decay / 10} п.п., в третью - ${(decay * 2) / 10} п.п. и так далее). Каждый п.п. потери стоит ${loss} $ в неделю. Одно переобучение стоит ${cost} $. Переобучение делается каждые T недель (T от 1 до 26). При каком T средние расходы в неделю (переобучение + потери от деградации) минимальны?`,
        answerHint: 'T, недель',
        answerKey: String(sorted[0]!.t),
        explanation: `Средние расходы в неделю = ${cost} / T + ${decay / 10} × ${loss} × (T - 1) / 2. Минимум при T = ${sorted[0]!.t} (${fx(sorted[0]!.v, 1)} $/нед), для T = ${sorted[1]!.t} - ${fx(sorted[1]!.v, 1)} $/нед.`,
        params: { decay, loss, cost },
      };
    }
  },
);

export const canaryDetectMinutes = family(
  { id: 'ai.canary-detect-minutes', taskId: 'task:canary-guardrails', title: 'Сколько минут держать канарейку', sub: SUB, grade: 'senior', catalogIds: ['ai.model-versioning', 'ai.monitoring-drift'], a: 1.3, b: 1.3, space: 1e5, time: 360 },
  (rng) => {
    const p1 = rng.pick([2, 3, 4, 5, 6]);
    const rel = rng.pick([25, 50, 100]);
    const p2 = (p1 * (100 + rel)) / 100;
    const rps = rng.pick([2, 4, 5, 8, 10]);
    const share = rng.pick([5, 10, 20]);
    const q1 = p1 / 100;
    const q2 = p2 / 100;
    const n = Math.ceil((2.8 ** 2 * (q1 * (1 - q1) + q2 * (1 - q2))) / (q2 - q1) ** 2 - 1e-9);
    const perMin = (rps * 60 * share) / 100;
    const minutes = Math.ceil(n / perMin - 1e-9);
    return {
      prompt: `Новая версия модели выкатывается на ${share} % трафика (всего ${rps} запросов в секунду). Базовая доля ошибок - ${p1} %. Нужно заметить рост доли ошибок на ${rel} % относительно базы (до ${fx(p2, 2)} %) с уровнем значимости 5 % (z = 1,96) и мощностью 80 % (z = 0,84). Размер выборки на одну ветку: n = (1,96 + 0,84)² · (p₁(1-p₁) + p₂(1-p₂)) / (p₂ - p₁)²; базовая ветка достаточно большая. Сколько минут (округление вверх) канарейка должна собирать трафик, чтобы набрать n запросов?`,
      answerHint: 'минуты',
      answerKey: String(minutes),
      explanation: `n = ${n} запросов. Канарейка получает ${rps} × 60 × ${share} % = ${perMin} запросов в минуту: ${n} / ${perMin} = ${fx(n / perMin, 2)} → ${minutes} мин. Чем реже ошибки и меньше доля трафика, тем дольше надо ждать.`,
      params: { p1, rel, rps, share },
    };
  },
);

export const gpuPacking = family(
  { id: 'ai.gpu-packing', taskId: 'task:gpu-sizing', title: 'Сколько GPU нужно под набор моделей', sub: SUB, grade: 'senior', catalogIds: ['ai.model-serving'], a: 1.2, b: 1.0, space: 1e10, time: 330 },
  (rng) => {
    const cap = rng.pick([40, 48, 80]);
    const reserve = rng.pick([2, 4]);
    const over = rng.pick([1, 2]);
    const mem = Array.from({ length: rng.int(7, 10) }, () => rng.int(3, Math.floor(cap / 2)));
    const sizes = [...mem].sort((a, b) => b - a).map((m) => m + over);
    const bins: number[] = [];
    for (const s of sizes) {
      const i = bins.findIndex((b) => b + s <= cap - reserve);
      if (i === -1) bins.push(s);
      else bins[i]! += s;
    }
    return {
      prompt: `Нужно разместить модели на GPU по ${cap} ГБ. На каждой карте ${reserve} ГБ резервируется системе; каждая модель занимает свои веса плюс ${over} ГБ накладных расходов. Модель целиком помещается на одну карту. Размещайте по алгоритму first-fit decreasing: модели по убыванию размера, каждую - на первую карту, где есть место, иначе открывается новая. Сколько карт потребуется?`,
      code: `веса моделей, ГБ: ${mem.join(', ')}`,
      answerHint: 'число GPU',
      answerKey: String(bins.length),
      explanation: `Размеры с накладными: ${sizes.join(', ')}; ёмкость карты ${cap - reserve} ГБ. Раскладка first-fit decreasing: ${bins.join(' | ')} - ${bins.length} карт.`,
      params: { cap, reserve, over, mem: mem.join(',') },
    };
  },
);

export const AI_BANK2_MLOPS = [
  registryStage,
  driftMeanShift,
  replicasNeeded,
  ksDriftStat,
  labelDelayAccuracy,
  batchVsOnline,
  modelLineage,
  autoscaleSim,
  driftTriageFirst,
  retrainPeriod,
  canaryDetectMinutes,
  gpuPacking,
];
