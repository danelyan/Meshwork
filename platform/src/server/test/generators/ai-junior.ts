// Генераторы AI, добавленные под банк подкатегории 6 Junior + 4 Middle + 4 Senior (ADR 0003, дополнение 10.10 16:15):
// недостающие Junior (и одно Middle) по подкатегориям. Правила те же, что в ai.ts: ключ считает код (R-T-02),
// несущественные параметры — от seed (R-T-01), a и b — ПРЕДЛОЖЕНИЕ (экспертные), проверены персонами.
import { createRng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';

import { num, table } from './ai-util';

// ===========================================================================
// ai.llm-apps
// ===========================================================================

/** Nucleus sampling: сколько токенов останется в выборке при top_p. */
export const topPNucleus: TaskGenerator = {
  id: 'ai.top-p-nucleus',
  taskId: 'task:sampling-params',
  title: 'Сколько токенов в выборке top_p',
  specialization: 'ai',
  subcategoryId: 'ai.llm-apps',
  grade: 'junior',
  catalogIds: ['ai.prompting'],
  format: 'number',
  a: 1.4,
  b: -0.9,
  paramSpace: 1e6,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      // Вероятности в процентах, по убыванию, сумма 100.
      const raw = Array.from({ length: 7 }, () => rng.int(1, 40));
      const sum = raw.reduce((s, x) => s + x, 0);
      const ps = raw.map((x) => Math.round((x / sum) * 100)).sort((a, b) => b - a);
      ps[ps.length - 1]! += 100 - ps.reduce((s, x) => s + x, 0);
      if (ps.some((p) => p <= 0)) continue;
      ps.sort((a, b) => b - a);
      const topP = rng.pick([50, 70, 80, 90]);
      let acc = 0;
      let k = 0;
      // Как в популярных реализациях: берём токены по убыванию, пока накопленная сумма < top_p; токен, на котором
      // сумма достигла порога, входит в выборку.
      for (const p of ps) {
        k++;
        acc += p;
        if (acc >= topP) break;
      }
      const tokens = ['«да»', '«нет»', '«возможно»', '«конечно»', '«нужно»', '«уже»', '«пока»'];
      return {
        prompt: `Модель предсказывает следующий токен. Генерация идёт с top_p = ${topP / 100}: токены берутся по убыванию вероятности, пока накопленная сумма меньше ${topP / 100}; токен, на котором сумма достигла порога, тоже входит. Сколько токенов попадёт в выборку?`,
        code: ps.map((p, i) => `${tokens[i]}: ${(p / 100).toFixed(2)}`).join('\n'),
        answerHint: 'число токенов',
        answerKey: String(k),
        explanation: `Накопленные суммы: ${ps.map((_, i) => (ps.slice(0, i + 1).reduce((s, x) => s + x, 0) / 100).toFixed(2)).join(', ')}. Порог ${topP / 100} достигнут на ${k}-м токене.`,
        params: { topP, ps: ps.join(',') },
      };
    }
  },
};

/** Объём векторного индекса: чанки × размерность × байты. */
export const vectorIndexSize: TaskGenerator = {
  id: 'ai.vector-index-size',
  taskId: 'task:vector-storage',
  title: 'Сколько памяти займут эмбеддинги',
  specialization: 'ai',
  subcategoryId: 'ai.llm-apps',
  grade: 'junior',
  catalogIds: ['ai.vector-search', 'ai.rag'],
  format: 'number',
  a: 1.4,
  b: -1.1,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const docs = rng.pick([1000, 2000, 5000, 10000, 20000]);
    const chunksPer = rng.int(2, 12);
    const dim = rng.pick([256, 384, 512, 768, 1024, 1536]);
    const dtype = rng.pick([
      { name: 'float32', bytes: 4 },
      { name: 'float16', bytes: 2 },
      { name: 'int8', bytes: 1 },
    ]);
    const bytes = docs * chunksPer * dim * dtype.bytes;
    const mb = bytes / 1_000_000;
    return {
      prompt: `База знаний - ${docs} документов, каждый режется в среднем на ${chunksPer} чанков. Эмбеддинг чанка - вектор размерности ${dim}, хранится в ${dtype.name}. Сколько мегабайт (1 МБ = 1 000 000 байт) займут сами векторы, без индекса и метаданных?`,
      answerHint: 'МБ, до 3 знаков',
      answerKey: num(Number(mb.toFixed(3))),
      explanation: `${docs} × ${chunksPer} = ${docs * chunksPer} векторов × ${dim} × ${dtype.bytes} байт = ${bytes} байт ≈ ${num(Number(mb.toFixed(3)))} МБ.`,
      params: { docs, chunksPer, dim, bytes: dtype.bytes },
    };
  },
};

// ===========================================================================
// ai.ai-integration
// ===========================================================================

/** Время ответа при стриминге: первый токен + генерация. */
export const streamingLatency: TaskGenerator = {
  id: 'ai.streaming-latency',
  taskId: 'task:streaming-latency',
  title: 'Через сколько придёт полный ответ',
  specialization: 'ai',
  subcategoryId: 'ai.ai-integration',
  grade: 'junior',
  catalogIds: ['ai.llm-api'],
  format: 'number',
  a: 1.4,
  b: -0.6,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ttft = rng.pick([200, 300, 400, 500, 800]);
    const tps = rng.pick([20, 25, 40, 50, 80, 100]);
    const tokens = rng.int(2, 20) * 20;
    const ask = rng.pick(['full', 'first'] as const);
    const genMs = (tokens / tps) * 1000;
    const total = ttft + genMs;
    const firstWords = rng.int(2, 5) * 5;
    const firstMs = ttft + (firstWords / tps) * 1000;
    const value = ask === 'full' ? total : firstMs;
    return {
      prompt:
        ask === 'full'
          ? `Чат-бот стримит ответ LLM. Время до первого токена - ${ttft} мс, дальше модель выдаёт ${tps} токенов в секунду. Ответ - ${tokens} токенов. Через сколько миллисекунд после запроса пользователь увидит ответ целиком?`
          : `Чат-бот стримит ответ LLM. Время до первого токена - ${ttft} мс, дальше модель выдаёт ${tps} токенов в секунду. Через сколько миллисекунд после запроса на экране будет ${firstWords + 1} токенов (первый и ещё ${firstWords})?`,
      answerHint: 'мс',
      answerKey: num(Number(value.toFixed(1))),
      explanation:
        ask === 'full'
          ? `${ttft} + ${tokens} / ${tps} × 1000 = ${num(Number(total.toFixed(1)))} мс. Пользователь начинает читать через ${ttft} мс - поэтому стриминг.`
          : `${ttft} + ${firstWords} / ${tps} × 1000 = ${num(Number(firstMs.toFixed(1)))} мс.`,
      params: { ttft, tps, tokens, ask, firstWords },
    };
  },
};

/** Повторная доставка вебхука от LLM-задачи: идемпотентность по ключу. */
export const webhookIdempotency: TaskGenerator = {
  id: 'ai.webhook-idempotency',
  taskId: 'task:llm-webhook',
  title: 'Сколько раз спишутся токены',
  specialization: 'ai',
  subcategoryId: 'ai.ai-integration',
  grade: 'middle',
  catalogIds: ['ai.llm-fallback', 'ai.llm-cost'],
  format: 'number',
  a: 1.2,
  b: 0.5,
  paramSpace: 1e8,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const jobs = ['job-1', 'job-2', 'job-3', 'job-4'];
    const keyed = rng.int(0, 1) === 1;
    const events = Array.from({ length: rng.int(7, 10) }, () => ({ job: rng.pick(jobs), ok: rng.next() < 0.75 }));
    // Обработчик: при ok=true задача запускает LLM (списание). Без ключа идемпотентности — каждая успешная доставка
    // запускает заново; с ключом — только первая успешная по job_id. Неуспешная доставка (500) ничего не списывает.
    const seen = new Set<string>();
    let charges = 0;
    for (const e of events) {
      if (!e.ok) continue;
      if (keyed && seen.has(e.job)) continue;
      seen.add(e.job);
      charges++;
    }
    return {
      prompt: `Очередь присылает вебхук «запусти обработку письма LLM». Доставка at-least-once: один job приходит повторно. Обработчик ${keyed ? 'хранит job_id обработанных задач и повтор игнорирует (ключ идемпотентности)' : 'ключ идемпотентности не хранит'}. Доставка с 500 (обработчик упал до вызова LLM) ничего не списывает. Сколько раз будет вызвана LLM (списаны токены)?`,
      code: events.map((e, i) => `${i + 1}. ${e.job} → ${e.ok ? '200' : '500'}`).join('\n'),
      answerHint: 'число вызовов',
      answerKey: String(charges),
      explanation: keyed
        ? `Считаются уникальные job_id с успешной доставкой: ${charges}.`
        : `Без ключа каждая успешная доставка - новый вызов: ${charges}. С ключом было бы ${new Set(events.filter((e) => e.ok).map((e) => e.job)).size}.`,
      params: { keyed, events: events.map((e) => `${e.job}:${e.ok ? 1 : 0}`).join(',') },
    };
  },
};

// ===========================================================================
// ai.ml-engineering
// ===========================================================================

/** Матрица ошибок по предсказаниям. */
export const confusionCount: TaskGenerator = {
  id: 'ai.confusion-count',
  taskId: 'task:confusion-matrix',
  title: 'Посчитать ошибки классификатора',
  specialization: 'ai',
  subcategoryId: 'ai.ml-engineering',
  grade: 'junior',
  catalogIds: ['ai.ml-metrics'],
  format: 'number',
  a: 1.4,
  b: -0.8,
  paramSpace: 1e6,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = rng.int(10, 14);
    const yTrue = Array.from({ length: n }, () => (rng.next() < 0.45 ? 1 : 0));
    const yPred = yTrue.map((y) => (rng.next() < 0.7 ? y : 1 - y));
    const ask = rng.pick(['FP', 'FN', 'TP', 'TN'] as const);
    const count = (t: number, p: number) => yTrue.filter((y, i) => y === t && yPred[i] === p).length;
    const value = { TP: count(1, 1), FP: count(0, 1), FN: count(1, 0), TN: count(0, 0) }[ask];
    const ru = { TP: 'верно найденных положительных (TP)', FP: 'ложных срабатываний (FP)', FN: 'пропусков (FN)', TN: 'верно отвергнутых (TN)' }[ask];
    return {
      prompt: `Классификатор мошеннических операций (1 - мошенничество). Сколько ${ru}?`,
      code: [`y_true = [${yTrue.join(', ')}]`, `y_pred = [${yPred.join(', ')}]`].join('\n'),
      answerHint: 'число',
      answerKey: String(value),
      explanation: `TP ${count(1, 1)}, FP ${count(0, 1)}, FN ${count(1, 0)}, TN ${count(0, 0)}.`,
      params: { ask, yTrue: yTrue.join(''), yPred: yPred.join('') },
    };
  },
};

/** Стандартизация признака статистиками train. */
export const scalerTransform: TaskGenerator = {
  id: 'ai.scaler-transform',
  taskId: 'task:scaler-transform',
  title: 'Значение признака после StandardScaler',
  specialization: 'ai',
  subcategoryId: 'ai.ml-engineering',
  grade: 'junior',
  catalogIds: ['ai.feature-pipeline', 'ai.data-leakage'],
  format: 'number',
  a: 1.4,
  b: -0.4,
  paramSpace: 1e6,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const mean = rng.int(20, 80) * 10;
    const std = rng.pick([10, 20, 25, 40, 50, 100]);
    const k = rng.pick([-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2, 2.5]);
    const x = mean + k * std;
    const allMean = mean + rng.pick([-30, -20, 20, 30, 50]);
    const allStd = std + rng.pick([5, 10, 15]);
    return {
      prompt: 'Пайплайн: StandardScaler обучен (fit) на train и применяется (transform) к тестовому объекту. Чему равно значение признака «сумма заказа» у объекта после преобразования?',
      code: [
        `train: mean = ${mean}, std = ${std}`,
        `train + test вместе: mean = ${allMean}, std = ${allStd}`,
        `объект из test: сумма заказа = ${x}`,
      ].join('\n'),
      answerHint: 'число',
      answerKey: num(k),
      explanation: `(x − mean_train) / std_train = (${x} − ${mean}) / ${std} = ${num(k)}. Статистики train + test - утечка: их здесь не берут.`,
      params: { mean, std, k, allMean, allStd },
    };
  },
};

/** Число столбцов после one-hot. */
export const oneHotWidth: TaskGenerator = {
  id: 'ai.one-hot-width',
  taskId: 'task:one-hot',
  title: 'Сколько столбцов после one-hot',
  specialization: 'ai',
  subcategoryId: 'ai.ml-engineering',
  grade: 'junior',
  catalogIds: ['ai.feature-pipeline'],
  format: 'number',
  a: 1.4,
  b: -0.7,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const cats = rng.sample(
      [
        { name: 'city', n: rng.int(3, 12) },
        { name: 'device', n: rng.int(2, 4) },
        { name: 'tariff', n: rng.int(3, 6) },
        { name: 'channel', n: rng.int(2, 5) },
        { name: 'segment', n: rng.int(2, 6) },
      ],
      rng.int(2, 3),
    );
    const numeric = rng.int(2, 8);
    const drop = rng.int(0, 1) === 1;
    const cols = numeric + cats.reduce((s, c) => s + c.n - (drop ? 1 : 0), 0);
    return {
      prompt: `Таблица: ${numeric} числовых признаков (проходят без изменений) и категориальные ниже. Категориальные кодируются OneHotEncoder(${drop ? "drop='first'" : 'без drop'}). Сколько столбцов получит модель?`,
      code: cats.map((c) => `${c.name}: ${c.n} уникальных значений`).join('\n'),
      answerHint: 'число столбцов',
      answerKey: String(cols),
      explanation: `${numeric} + ${cats.map((c) => (drop ? `(${c.n} − 1)` : String(c.n))).join(' + ')} = ${cols}.`,
      params: { numeric, drop, cats: cats.map((c) => `${c.name}:${c.n}`).join(',') },
    };
  },
};

// ===========================================================================
// ai.mlops
// ===========================================================================

/** Пакетный инференс: время прогона. */
export const batchInference: TaskGenerator = {
  id: 'ai.batch-inference',
  taskId: 'task:batch-inference',
  title: 'Сколько займёт ночной прогон модели',
  specialization: 'ai',
  subcategoryId: 'ai.mlops',
  grade: 'junior',
  catalogIds: ['ai.model-serving'],
  format: 'number',
  a: 1.4,
  b: -1.0,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const items = rng.int(2, 60) * 10000;
    const batch = rng.pick([32, 64, 128, 256, 512]);
    const perBatchMs = rng.pick([50, 80, 100, 120, 200, 250]);
    const workers = rng.int(1, 4);
    const batches = Math.ceil(items / batch);
    const rounds = Math.ceil(batches / workers);
    const minutes = (rounds * perBatchMs) / 60000;
    return {
      prompt: `Ночной скоринг ${items} клиентов. Модель обрабатывает батч из ${batch} объектов за ${perBatchMs} мс; последний батч может быть неполным, но занимает столько же. Работают ${workers} одинаковых воркера параллельно, батчи делятся поровну. Сколько минут займёт прогон? Ответ округлите до 0,1.`,
      answerHint: 'минут, до 0,1',
      answerKey: num(Number(minutes.toFixed(1))),
      explanation: `Батчей ⌈${items} / ${batch}⌉ = ${batches}; на воркер ⌈${batches} / ${workers}⌉ = ${rounds}; ${rounds} × ${perBatchMs} мс = ${rounds * perBatchMs} мс ≈ ${num(Number(minutes.toFixed(1)))} мин.`,
      params: { items, batch, perBatchMs, workers },
    };
  },
};

/** Память под веса модели. */
export const modelMemory: TaskGenerator = {
  id: 'ai.model-memory',
  taskId: 'task:model-memory',
  title: 'Сколько памяти займут веса',
  specialization: 'ai',
  subcategoryId: 'ai.mlops',
  grade: 'junior',
  catalogIds: ['ai.model-serving'],
  format: 'number',
  a: 1.4,
  b: -0.9,
  paramSpace: 1e4,
  timeLimitSec: 120,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const params = rng.pick([0.5, 1, 1.5, 3, 7, 8, 13, 14, 32, 70]);
    const dtype = rng.pick([
      { name: 'fp32', bytes: 4 },
      { name: 'fp16', bytes: 2 },
      { name: 'bf16', bytes: 2 },
      { name: 'int8', bytes: 1 },
      { name: 'int4', bytes: 0.5 },
    ]);
    const gb = params * dtype.bytes;
    return {
      prompt: `Модель - ${params} млрд параметров, веса загружены в ${dtype.name}. Сколько гигабайт (1 ГБ = 10⁹ байт) видеопамяти займут только веса, без KV-кэша и активаций?`,
      answerHint: 'ГБ',
      answerKey: num(gb),
      explanation: `${params} × 10⁹ × ${dtype.bytes} байт = ${num(gb)} ГБ. На инференс нужно больше: KV-кэш растёт с длиной контекста и батчем.`,
      params: { params, bytes: dtype.bytes },
    };
  },
};

// ===========================================================================
// ai.data-science
// ===========================================================================

/** Средний чек: взвешенное среднее против среднего средних. */
export const weightedMean: TaskGenerator = {
  id: 'ai.weighted-mean',
  taskId: 'task:weighted-mean',
  title: 'Средний чек по всем магазинам',
  specialization: 'ai',
  subcategoryId: 'ai.data-science',
  grade: 'junior',
  catalogIds: ['ai.pandas-sql'],
  format: 'number',
  a: 1.4,
  b: -0.7,
  paramSpace: 1e8,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      const shops = rng.sample(['Север', 'Юг', 'Центр', 'Запад', 'Восток'], 3);
      const orders = shops.map(() => rng.int(1, 40) * 10);
      const avg = shops.map(() => rng.int(5, 40) * 100);
      const revenue = orders.reduce((s, o, i) => s + o * avg[i]!, 0);
      const total = orders.reduce((s, o) => s + o, 0);
      const mean = revenue / total;
      const naive = avg.reduce((s, a) => s + a, 0) / avg.length;
      if (Math.abs(mean - naive) < 50) continue;
      return {
        prompt: 'Отчёт по магазинам сети. Какой средний чек по сети в целом (выручка / число заказов)? Ответ округлите до рубля.',
        code: table(['магазин', 'заказов', 'средний чек, ₽'], shops.map((s, i) => [s, orders[i]!, avg[i]!])),
        answerHint: '₽, целое',
        answerKey: String(Math.round(mean)),
        explanation: `Выручка ${revenue} ₽ / ${total} заказов = ${Math.round(mean)} ₽. Среднее средних (${Math.round(naive)} ₽) не учитывает число заказов.`,
        params: { orders: orders.join(','), avg: avg.join(',') },
      };
    }
  },
};

/** dropna по подмножеству столбцов: сколько строк останется. */
export const dropnaRows: TaskGenerator = {
  id: 'ai.dropna-rows',
  taskId: 'task:dropna',
  title: 'Сколько строк останется после dropna',
  specialization: 'ai',
  subcategoryId: 'ai.data-science',
  grade: 'junior',
  catalogIds: ['ai.pandas-sql'],
  format: 'number',
  a: 1.4,
  b: -0.8,
  paramSpace: 1e8,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const cols = ['age', 'income', 'city', 'score'];
    const rows = Array.from({ length: rng.int(7, 9) }, () => cols.map(() => rng.next() < 0.22));
    const subset = rng.sample(cols, rng.int(1, 2)).sort((a, b) => cols.indexOf(a) - cols.indexOf(b));
    const how = rng.pick(['any', 'all'] as const);
    const idx = subset.map((c) => cols.indexOf(c));
    const keep = rows.filter((r) => (how === 'any' ? !idx.some((i) => r[i]) : !idx.every((i) => r[i]))).length;
    const values = ['34', '120000', 'Пермь', '0.7'];
    return {
      prompt: `Сколько строк останется после df.dropna(subset=[${subset.map((c) => `'${c}'`).join(', ')}], how='${how}')?`,
      code: table(cols, rows.map((r) => r.map((na, i) => (na ? 'NaN' : values[i]!)))),
      answerHint: 'число строк',
      answerKey: String(keep),
      explanation: `how='${how}': строка удаляется, если ${how === 'any' ? 'хотя бы в одном' : 'во всех'} из столбцов ${subset.join(', ')} NaN. Пропуски в других столбцах не учитываются. Остаётся ${keep}.`,
      params: { how, subset: subset.join(','), na: rows.map((r) => r.map((x) => (x ? 1 : 0)).join('')).join('|') },
    };
  },
};

export const AI_JUNIOR_GENERATORS: TaskGenerator[] = [
  topPNucleus,
  vectorIndexSize,
  streamingLatency,
  webhookIdempotency,
  confusionCount,
  scalerTransform,
  oneHotWidth,
  batchInference,
  modelMemory,
  weightedMean,
  dropnaRows,
];
