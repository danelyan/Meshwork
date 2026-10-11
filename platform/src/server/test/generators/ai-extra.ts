// Генераторы AI, добавленные под тест на подкатегорию (ADR 0003, дополнение 10.10 15:50): до 8 семейств на
// каждую из llm-apps, ai-integration, ml-engineering, mlops, data-science. Правила те же, что в ai.ts: ключ
// считает код (R-T-02), несущественные параметры – от seed (R-T-01), a и b – ПРЕДЛОЖЕНИЕ (экспертные).
import { createRng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';

import { CITIES, num, table } from './ai-util';

const SECONDS = (s: number) => `${s} с`;

// ===========================================================================
// ai.llm-apps
// ===========================================================================

/** Окно контекста: сколько последних сообщений истории поместится. */
export const contextBudget: TaskGenerator = {
  id: 'ai.context-budget',
  taskId: 'task:context-budget',
  title: 'Сколько истории влезет в контекст',
  specialization: 'ai',
  subcategoryId: 'ai.llm-apps',
  grade: 'junior',
  catalogIds: ['ai.prompting', 'ai.llm-cost'],
  format: 'number',
  a: 1.4,
  b: -0.7,
  paramSpace: 1e8,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const window = rng.pick([4000, 8000, 16000, 32000]);
    const sys = rng.int(3, 12) * 100;
    const reserve = rng.pick([500, 1000, 2000]);
    const n = rng.int(6, 9);
    const msgs = Array.from({ length: n }, () => rng.int(2, Math.floor(window / 2000) * 6 + 4) * 100);
    const budget = window - sys - reserve;
    let used = 0;
    let fit = 0;
    for (let i = n - 1; i >= 0; i--) {
      if (used + msgs[i]! > budget) break;
      used += msgs[i]!;
      fit++;
    }
    return {
      prompt: `Окно модели - ${window} токенов. Системный промпт - ${sys} токенов, под ответ резервируется ${reserve}. История добавляется с самых новых сообщений, пока помещается целиком (сообщение не режется; первое не поместившееся останавливает сборку). Сколько сообщений истории попадёт в запрос?`,
      code: msgs.map((t, i) => `сообщение ${i + 1}${i === n - 1 ? ' (самое новое)' : ''}: ${t} токенов`).join('\n'),
      answerHint: 'число сообщений',
      answerKey: String(fit),
      explanation: `Под историю остаётся ${window} − ${sys} − ${reserve} = ${budget}. С конца помещается ${fit} сообщений (${used} токенов).`,
      params: { window, sys, reserve, msgs: msgs.join(',') },
    };
  },
};

/** Гибридный поиск: слияние двух выдач через Reciprocal Rank Fusion. */
export const rrfFusion: TaskGenerator = {
  id: 'ai.rrf-fusion',
  taskId: 'task:hybrid-search',
  title: 'Гибридный поиск: кто первый после RRF',
  specialization: 'ai',
  subcategoryId: 'ai.llm-apps',
  grade: 'middle',
  catalogIds: ['ai.rag', 'ai.vector-search'],
  format: 'text',
  a: 1.2,
  b: 0.5,
  paramSpace: 1e6,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const docs = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'];
    for (;;) {
      const bm25 = rng.sample(docs, 5);
      const dense = rng.sample(docs, 5);
      const score = new Map<string, number>();
      bm25.forEach((d, i) => score.set(d, (score.get(d) ?? 0) + 1 / (60 + i + 1)));
      dense.forEach((d, i) => score.set(d, (score.get(d) ?? 0) + 1 / (60 + i + 1)));
      const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked[0]![1] - ranked[1]![1] < 1e-5) continue;
      // Ловушка: лидер RRF не совпадает с первым местом ни одной из выдач – в половине seed это так.
      return {
        prompt: 'Гибридный поиск сливает выдачу BM25 и векторную через Reciprocal Rank Fusion: score(d) = Σ 1 / (60 + rank), rank с 1; документ, которого нет в выдаче, слагаемого не получает. Какой документ будет первым?',
        code: [`BM25:    ${bm25.join(', ')}`, `векторы: ${dense.join(', ')}`].join('\n'),
        answerHint: 'имя документа, например d3',
        answerKey: ranked[0]![0],
        explanation: `RRF: ${ranked.slice(0, 3).map(([d, v]) => `${d} ${v.toFixed(5)}`).join(', ')}. Документ из обеих выдач обычно обгоняет лидера одной.`,
        params: { bm25: bm25.join(','), dense: dense.join(',') },
      };
    }
  },
};

// ===========================================================================
// ai.ai-integration
// ===========================================================================

/** Ретраи с экспоненциальной задержкой при 429. */
export const retryBackoff: TaskGenerator = {
  id: 'ai.retry-backoff',
  taskId: 'task:llm-retry',
  title: 'Сколько ждать при 429',
  specialization: 'ai',
  subcategoryId: 'ai.ai-integration',
  grade: 'junior',
  catalogIds: ['ai.llm-api', 'ai.llm-fallback'],
  format: 'number',
  a: 1.4,
  b: -0.7,
  paramSpace: 1e3,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const base = rng.pick([1, 2, 3]);
    const retries = rng.int(3, 5);
    const okAt = rng.int(2, retries + 2); // номер попытки, на которой придёт 200; > retries + 1 – не придёт
    const attempts = Math.min(okAt, retries + 1);
    let wait = 0;
    for (let k = 1; k < attempts; k++) wait += base * 2 ** (k - 1);
    const success = okAt <= retries + 1;
    return {
      prompt: `Клиент LLM API при ответе 429 повторяет запрос: задержка перед k-м повтором = ${base} × 2^(k−1) с, повторов не больше ${retries}. Провайдер отвечает 429 на все попытки${success ? `, кроме ${okAt}-й (по счёту с первой), на которую приходит 200` : ''}. Сколько секунд клиент суммарно прождёт в задержках?`,
      answerHint: 'секунд',
      answerKey: String(wait),
      explanation: `Попыток: ${attempts}${success ? '' : ' (повторы кончились, ошибка уходит выше)'}; задержек ${attempts - 1}: ${Array.from({ length: attempts - 1 }, (_, i) => SECONDS(base * 2 ** i)).join(' + ') || '0'} = ${wait} с.`,
      params: { base, retries, okAt },
    };
  },
};

/** Лимиты провайдера: RPM и TPM одновременно. */
export const rateLimits: TaskGenerator = {
  id: 'ai.rate-limits',
  taskId: 'task:llm-rate-limit',
  title: 'Сколько запросов в минуту пропустит лимит',
  specialization: 'ai',
  subcategoryId: 'ai.ai-integration',
  grade: 'junior',
  catalogIds: ['ai.llm-cost', 'ai.llm-api'],
  format: 'number',
  a: 1.4,
  b: -0.4,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const rpm = rng.int(2, 30) * 10;
    const tpm = rng.int(2, 40) * 10000;
    const tin = rng.int(4, 30) * 100;
    const tout = rng.int(1, 8) * 100;
    const per = tin + tout;
    const byTokens = Math.floor(tpm / per);
    const max = Math.min(rpm, byTokens);
    return {
      prompt: `Лимиты провайдера LLM на ключ: ${rpm} запросов в минуту и ${tpm.toLocaleString('ru-RU')} токенов в минуту (вход + выход). Запрос - ${tin} входных и ${tout} выходных токенов. Сколько запросов в минуту можно отправить без 429?`,
      answerHint: 'запросов в минуту',
      answerKey: String(max),
      explanation: `По токенам: ⌊${tpm} / ${per}⌋ = ${byTokens}; по запросам: ${rpm}. Действует меньший: ${max}.`,
      params: { rpm, tpm, tin, tout },
    };
  },
};

/** Извлечение полей LLM для CRM: что уходит на ручную проверку. */
export const extractionReview: TaskGenerator = {
  id: 'ai.extraction-review',
  taskId: 'task:extraction-review',
  title: 'Что отправить на ручную проверку',
  specialization: 'ai',
  subcategoryId: 'ai.ai-integration',
  grade: 'junior',
  catalogIds: ['ai.structured-output', 'ai.llm-fallback'],
  format: 'list',
  a: 1.4,
  b: -0.3,
  paramSpace: 1e7,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const thr = rng.pick([0.6, 0.7, 0.8]);
    for (;;) {
      const rows = Array.from({ length: 6 }, () => ({
        inn: rng.next() < 0.2 ? null : String(rng.int(1000000000, 9999999999)),
        amount: rng.next() < 0.15 ? null : rng.int(1, 900) * 1000,
        conf: rng.int(40, 99) / 100,
      }));
      const review = rows.map((r, i) => (r.inn === null || r.amount === null || r.conf < thr ? i + 1 : 0)).filter(Boolean);
      if (review.length === 0 || review.length === rows.length) continue;
      return {
        prompt: `LLM извлекает из писем счёт для CRM: ИНН и сумма обязательны. Правило интеграции: запись уходит на ручную проверку, если нет обязательного поля или уверенность модели ниже ${thr}. Перечислите номера записей для ручной проверки.`,
        code: table(['№', 'inn', 'amount', 'confidence'], rows.map((r, i) => [i + 1, r.inn ?? 'null', r.amount ?? 'null', r.conf.toFixed(2)])),
        answerHint: 'номера через запятую',
        answerKey: review.join(','),
        explanation: rows.map((r, i) => `${i + 1}: ${r.inn === null ? 'нет ИНН' : r.amount === null ? 'нет суммы' : r.conf < thr ? `уверенность ${r.conf.toFixed(2)} < ${thr}` : 'автоматически'}`).join('; ') + '.',
        params: { thr },
      };
    }
  },
};

/** Цепочка отказоустойчивости: основная LLM → резервная → правила. */
export const fallbackChain: TaskGenerator = {
  id: 'ai.fallback-chain',
  taskId: 'task:llm-fallback',
  title: 'Кто ответил на запросы',
  specialization: 'ai',
  subcategoryId: 'ai.ai-integration',
  grade: 'middle',
  catalogIds: ['ai.llm-fallback', 'ai.llm-api'],
  format: 'number',
  a: 1.2,
  b: 0.3,
  paramSpace: 1e6,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const timeout = rng.pick([2, 3, 5]);
    const n = rng.int(5, 7);
    type Out = { p: number | 'err'; s: number | 'err' };
    const reqs: Out[] = Array.from({ length: n }, () => ({
      p: rng.next() < 0.3 ? 'err' : rng.int(1, 8),
      s: rng.next() < 0.3 ? 'err' : rng.int(1, 6),
    }));
    const who = reqs.map((r) => (r.p !== 'err' && r.p <= timeout ? 'primary' : r.s !== 'err' && r.s <= timeout ? 'secondary' : 'rules'));
    const ask = rng.pick(['secondary', 'rules'] as const);
    const value = who.filter((w) => w === ask).length;
    const fmt = (v: number | 'err') => (v === 'err' ? '5xx' : `${v} с`);
    return {
      prompt: `Интеграция LLM в тикет-систему: запрос идёт в основную модель, при ошибке или ответе дольше ${timeout} с (таймаут) - в резервную с тем же таймаутом, при её отказе - в ответ по правилам без LLM. Сколько запросов обработал ${ask === 'secondary' ? 'резервный провайдер' : 'сценарий по правилам'}?`,
      code: table(['запрос', 'основная', 'резервная'], reqs.map((r, i) => [i + 1, fmt(r.p), fmt(r.s)])),
      answerHint: 'число запросов',
      answerKey: String(value),
      explanation: `Ответили: ${who.map((w, i) => `${i + 1} - ${w}`).join(', ')}. Ответ ровно на таймауте укладывается, позже - отказ.`,
      params: { timeout, ask, who: who.join(',') },
    };
  },
};

/** Circuit breaker перед провайдером LLM. */
export const circuitBreaker: TaskGenerator = {
  id: 'ai.circuit-breaker',
  taskId: 'task:circuit-breaker',
  title: 'Сколько вызовов дошло до провайдера',
  specialization: 'ai',
  subcategoryId: 'ai.ai-integration',
  grade: 'middle',
  catalogIds: ['ai.llm-fallback'],
  format: 'number',
  a: 1.3,
  b: 0.6,
  paramSpace: 1e7,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const failN = rng.int(2, 3);
    const open = rng.pick([10, 20, 30]);
    const n = rng.int(9, 12);
    let t = 0;
    const calls = Array.from({ length: n }, () => {
      t += rng.int(1, 8);
      return { t, ok: rng.next() < 0.45 };
    });
    // Модель: closed → после failN подряд ошибок open на `open` с; по истечении – half-open: один пробный вызов;
    // успех закрывает, ошибка снова открывает.
    let state: 'closed' | 'open' | 'half' = 'closed';
    let fails = 0;
    let openedAt = 0;
    let reached = 0;
    const log: string[] = [];
    for (const c of calls) {
      if (state === 'open' && c.t - openedAt >= open) state = 'half';
      if (state === 'open') {
        log.push(`${c.t}: отклонён без вызова`);
        continue;
      }
      reached++;
      if (c.ok) {
        state = 'closed';
        fails = 0;
      } else if (state === 'half') {
        state = 'open';
        openedAt = c.t;
      } else if (++fails >= failN) {
        state = 'open';
        openedAt = c.t;
        fails = 0;
      }
      log.push(`${c.t}: вызван`);
    }
    return {
      prompt: `Перед провайдером LLM стоит circuit breaker: после ${failN} ошибок подряд он размыкается на ${open} с (вызовы отклоняются сразу), затем пропускает один пробный вызов: успех замыкает цепь, ошибка снова размыкает на ${open} с. Ниже - время запроса (с) и что ответил бы провайдер. Сколько запросов реально дошло до провайдера?`,
      code: calls.map((c) => `t=${c.t}: ${c.ok ? 'успех' : 'ошибка'}`).join('\n'),
      answerHint: 'число вызовов',
      answerKey: String(reached),
      explanation: log.join('; ') + '.',
      params: { failN, open, calls: calls.map((c) => `${c.t}${c.ok ? '+' : '-'}`).join(',') },
    };
  },
};

/** Кэш ответов LLM по точному ключу с TTL. */
export const promptCache: TaskGenerator = {
  id: 'ai.prompt-cache',
  taskId: 'task:llm-cache',
  title: 'Сколько вызовов LLM после кэша',
  specialization: 'ai',
  subcategoryId: 'ai.ai-integration',
  grade: 'middle',
  catalogIds: ['ai.llm-cost'],
  format: 'number',
  a: 1.1,
  b: 0.4,
  paramSpace: 1e7,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ttl = rng.pick([30, 60, 120]);
    const keys = ['Как вернуть товар?', 'как вернуть товар?', 'Где мой заказ?', 'Сменить тариф', 'Как вернуть товар? '];
    const normalize = rng.int(0, 1) === 1;
    let t = 0;
    const reqs = Array.from({ length: rng.int(7, 9) }, () => {
      t += rng.int(5, 50);
      return { t, q: rng.pick(keys) };
    });
    const key = (q: string) => (normalize ? q.trim().toLowerCase() : q);
    const cache = new Map<string, number>();
    let calls = 0;
    for (const r of reqs) {
      const k = key(r.q);
      const at = cache.get(k);
      if (at !== undefined && r.t - at < ttl) continue;
      calls++;
      cache.set(k, r.t);
    }
    return {
      prompt: `Ответы LLM кэшируются по ключу = ${normalize ? 'текст вопроса после trim() и приведения к нижнему регистру' : 'точный текст вопроса (без нормализации)'}; запись живёт ${ttl} с с момента записи, попадание срок не продлевает. Сколько раз будет вызвана LLM?`,
      code: reqs.map((r) => `t=${r.t} с: "${r.q}"`).join('\n'),
      answerHint: 'число вызовов',
      answerKey: String(calls),
      explanation: `Промах - новый ключ или запись старше ${ttl} с. ${normalize ? 'Регистр и пробелы не различаются.' : 'Без нормализации регистр и пробел в конце дают разные ключи.'} Вызовов: ${calls}.`,
      params: { ttl, normalize, reqs: reqs.map((r) => `${r.t}:${r.q}`).join('|') },
    };
  },
};

// ===========================================================================
// ai.ml-engineering
// ===========================================================================

/** Размеры выборок после двух разбиений. */
export const splitSizes: TaskGenerator = {
  id: 'ai.split-sizes',
  taskId: 'task:split-sizes',
  title: 'Сколько строк в train',
  specialization: 'ai',
  subcategoryId: 'ai.ml-engineering',
  grade: 'junior',
  catalogIds: ['ai.validation', 'ai.ml-baseline'],
  format: 'number',
  a: 1.4,
  b: -1.1,
  paramSpace: 1e4,
  timeLimitSec: 120,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = rng.int(2, 50) * 1000;
    const test = rng.pick([0.1, 0.2, 0.25]);
    const val = rng.pick([0.1, 0.2, 0.25]);
    const nTest = Math.round(n * test);
    const rest = n - nTest;
    const nVal = Math.round(rest * val);
    const train = rest - nVal;
    const ask = rng.pick(['train', 'val'] as const);
    return {
      prompt: `Датасет - ${n} строк. Сначала train_test_split(test_size=${test}), затем остаток ещё раз train_test_split(test_size=${val}) на train и validation. Сколько строк в ${ask === 'train' ? 'train' : 'validation'}?`,
      answerHint: 'число строк',
      answerKey: String(ask === 'train' ? train : nVal),
      explanation: `Тест: ${nTest}, остаток ${rest}; validation = ${val} от остатка = ${nVal}; train = ${train}.`,
      params: { n, test, val, ask },
    };
  },
};

/** Константный baseline: accuracy предсказания мажорного класса. */
export const majorityBaseline: TaskGenerator = {
  id: 'ai.majority-baseline',
  taskId: 'task:majority-baseline',
  title: 'Точность константной модели',
  specialization: 'ai',
  subcategoryId: 'ai.ml-engineering',
  grade: 'junior',
  catalogIds: ['ai.ml-baseline', 'ai.ml-metrics'],
  format: 'number',
  a: 1.4,
  b: -0.7,
  paramSpace: 1e5,
  timeLimitSec: 120,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const total = rng.pick([200, 400, 500, 1000, 2000]);
    const classes = rng.sample(['спам', 'реклама', 'жалоба', 'вопрос', 'благодарность'], 3);
    const a = Math.round((total * rng.int(45, 80)) / 100);
    const b = Math.round(((total - a) * rng.int(30, 70)) / 100);
    const counts = rng.shuffle([a, b, total - a - b]);
    const maj = Math.max(...counts);
    const acc = maj / total;
    const modelAcc = rng.int(Math.round(acc * 100) - 5, Math.round(acc * 100) + 8) / 100;
    return {
      prompt: `Тестовая выборка классификатора обращений (${total} штук) по классам ниже. Модель показала accuracy ${modelAcc.toFixed(2)}. Какая accuracy у константной модели, всегда предсказывающей самый частый класс? Ответ - дробь.`,
      code: table(['класс', 'объектов'], classes.map((c, i) => [c, counts[i]!])),
      answerHint: 'дробь от 0 до 1',
      answerKey: `${num(acc)}|${num(acc * 100)}`,
      explanation: `Самый частый класс - ${maj} из ${total}: accuracy ${num(acc)}. Модель ${modelAcc > acc ? 'лучше' : 'не лучше'} константы - без такого сравнения accuracy ничего не говорит.`,
      params: { total, counts: counts.join(',') },
    };
  },
};

/** Выбор порога классификатора по F1. */
export const thresholdChoice: TaskGenerator = {
  id: 'ai.threshold-choice',
  taskId: 'task:threshold-choice',
  title: 'Какой порог даст лучший F1',
  specialization: 'ai',
  subcategoryId: 'ai.ml-engineering',
  grade: 'middle',
  catalogIds: ['ai.ml-metrics', 'ai.validation'],
  format: 'number',
  a: 1.3,
  b: 0.6,
  paramSpace: 1e8,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const cands = [0.3, 0.5, 0.7];
    for (;;) {
      const rows = Array.from({ length: 10 }, () => ({ s: rng.int(5, 95) / 100, y: rng.next() < 0.45 ? 1 : 0 }));
      if (rows.every((r) => r.y === 0) || rows.every((r) => r.y === 1)) continue;
      const f1 = (t: number) => {
        const tp = rows.filter((r) => r.s >= t && r.y === 1).length;
        const fp = rows.filter((r) => r.s >= t && r.y === 0).length;
        const fn = rows.filter((r) => r.s < t && r.y === 1).length;
        return tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
      };
      const scores = cands.map((t) => ({ t, f: f1(t) })).sort((a, b) => b.f - a.f);
      if (scores[0]!.f - scores[1]!.f < 0.02) continue;
      return {
        prompt: `Скоры модели и истинные метки на validation. Класс 1 предсказывается при score ≥ порога. Какой из порогов ${cands.join(', ')} даёт наибольший F1?`,
        code: table(['score', 'y'], rows.map((r) => [r.s.toFixed(2), r.y])),
        answerHint: 'порог, например 0.5',
        answerKey: num(scores[0]!.t),
        explanation: `F1 = 2TP / (2TP + FP + FN): ${cands.map((t) => `${t} → ${f1(t).toFixed(3)}`).join(', ')}.`,
        params: { rows: rows.map((r) => `${r.s}:${r.y}`).join(',') },
      };
    }
  },
};

/** Early stopping: какая эпоха будет восстановлена. */
export const earlyStopping: TaskGenerator = {
  id: 'ai.early-stopping',
  taskId: 'task:early-stopping',
  title: 'Какой чекпоинт останется',
  specialization: 'ai',
  subcategoryId: 'ai.ml-engineering',
  grade: 'middle',
  catalogIds: ['ai.validation', 'ai.ml-baseline'],
  format: 'number',
  a: 1.1,
  b: 0.3,
  paramSpace: 1e8,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const patience = rng.int(2, 3);
    const epochs = 12;
    const train: number[] = [];
    const val: number[] = [];
    let tr = rng.int(60, 80) / 100;
    let v = tr + rng.int(2, 8) / 100;
    const turn = rng.int(3, 7);
    for (let e = 1; e <= epochs; e++) {
      tr = Math.max(0.05, tr - rng.int(2, 6) / 100);
      v = e <= turn ? Math.max(0.1, v - rng.int(1, 5) / 100) : v + rng.int(-1, 4) / 100;
      train.push(Number(tr.toFixed(2)));
      val.push(Number(v.toFixed(2)));
    }
    let best = 0;
    let bestE = 1;
    let since = 0;
    let stopAt = epochs;
    for (let e = 1; e <= epochs; e++) {
      if (val[e - 1]! < best || e === 1) {
        best = val[e - 1]!;
        bestE = e;
        since = 0;
      } else if (++since >= patience) {
        stopAt = e;
        break;
      }
    }
    return {
      prompt: `Обучение с EarlyStopping(monitor='val_loss', patience=${patience}, restore_best_weights=True): остановка, если val_loss не улучшался (строго меньше лучшего) ${patience} эпохи подряд. Веса какой эпохи останутся у модели?`,
      code: table(['эпоха', 'train_loss', 'val_loss'], train.map((t, i) => [i + 1, t.toFixed(2), val[i]!.toFixed(2)])),
      answerHint: 'номер эпохи',
      answerKey: String(bestE),
      explanation: `Лучший val_loss ${best.toFixed(2)} - эпоха ${bestE}; обучение остановится на эпохе ${stopAt}, веса восстановятся с эпохи ${bestE}. train_loss при этом продолжает падать - переобучение.`,
      params: { patience, stopAt, bestE },
    };
  },
};

// ===========================================================================
// ai.mlops
// ===========================================================================

/** Перцентили латентности (nearest-rank). */
export const latencyPercentile: TaskGenerator = {
  id: 'ai.latency-percentile',
  taskId: 'task:latency-percentile',
  title: 'p95 латентности сервиса модели',
  specialization: 'ai',
  subcategoryId: 'ai.mlops',
  grade: 'junior',
  catalogIds: ['ai.model-serving', 'ai.monitoring-drift'],
  format: 'number',
  a: 1.4,
  b: -0.6,
  paramSpace: 1e9,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const xs = Array.from({ length: 20 }, () => rng.int(20, 120));
    for (let i = 0; i < rng.int(1, 2); i++) xs[rng.int(0, 19)] = rng.int(400, 1500);
    const p = rng.pick([50, 90, 95]);
    const sorted = [...xs].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * xs.length);
    const v = sorted[rank - 1]!;
    return {
      prompt: `Латентность 20 запросов к сервису модели, мс. Найдите p${p} методом nearest-rank: отсортировать по возрастанию и взять элемент с номером ⌈${p}/100 × 20⌉.`,
      code: xs.join(', '),
      answerHint: 'мс',
      answerKey: String(v),
      explanation: `Ранг ⌈${p / 100} × 20⌉ = ${rank}; ${rank}-е значение по возрастанию - ${v} мс. Среднее (${num(xs.reduce((s, x) => s + x, 0) / 20)}) тянут вверх выбросы.`,
      params: { p, xs: xs.join(',') },
    };
  },
};

/** Канареечный выкат: сколько запросов увидит новая модель. */
export const canaryTraffic: TaskGenerator = {
  id: 'ai.canary-traffic',
  taskId: 'task:canary-rollout',
  title: 'Канарейка: сколько запросов на новую модель',
  specialization: 'ai',
  subcategoryId: 'ai.mlops',
  grade: 'junior',
  catalogIds: ['ai.model-serving', 'ai.model-versioning'],
  format: 'number',
  a: 1.4,
  b: -1.2,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const rpm = rng.int(1, 30) * 100;
    const stages = rng.sample([1, 5, 10, 25, 50], rng.int(2, 3)).sort((a, b) => a - b);
    const mins = stages.map(() => rng.pick([10, 20, 30]));
    const total = stages.reduce((s, w, i) => s + (rpm * w * mins[i]!) / 100, 0);
    return {
      prompt: `Канареечный выкат новой версии модели при ровной нагрузке ${rpm} запросов в минуту. Этапы: ${stages.map((w, i) => `${w} % трафика - ${mins[i]} мин`).join(', ')}. Сколько запросов всего обработает новая версия за все этапы?`,
      answerHint: 'число запросов',
      answerKey: num(total),
      explanation: stages.map((w, i) => `${rpm} × ${w}% × ${mins[i]} = ${num((rpm * w * mins[i]!) / 100)}`).join(' + ') + ` = ${num(total)}.`,
      params: { rpm, stages: stages.join(','), mins: mins.join(',') },
    };
  },
};

/** Алерт мониторинга по N окнам подряд. */
export const alertWindows: TaskGenerator = {
  id: 'ai.alert-windows',
  taskId: 'task:monitoring-alert',
  title: 'Сколько раз сработает алерт',
  specialization: 'ai',
  subcategoryId: 'ai.mlops',
  grade: 'junior',
  catalogIds: ['ai.monitoring-drift'],
  format: 'number',
  a: 1.4,
  b: -0.5,
  paramSpace: 1e9,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const thr = rng.pick([2, 3, 5]);
    const k = rng.int(2, 3);
    const xs = Array.from({ length: 14 }, () => (rng.next() < 0.4 ? rng.int(thr + 1, thr * 3) : rng.int(0, thr)));
    let run = 0;
    let fires = 0;
    for (const x of xs) {
      if (x > thr) {
        run++;
        if (run === k) fires++;
      } else run = 0;
    }
    return {
      prompt: `Мониторинг сервиса модели: доля ошибок (%) по 5-минутным окнам. Алерт срабатывает, когда доля > ${thr} % ${k} окна подряд; пока серия продолжается, повторно не срабатывает, после окна в норме - снова может. Сколько раз сработает алерт?`,
      code: xs.join(', '),
      answerHint: 'число срабатываний',
      answerKey: String(fires),
      explanation: `Серии из ≥ ${k} окон выше ${thr} %: ${fires}. Значение ровно ${thr} % порог не превышает.`,
      params: { thr, k, xs: xs.join(',') },
    };
  },
};

/** Хэш-маршрутизация A/B версий модели по user_id. */
export const versionRouting: TaskGenerator = {
  id: 'ai.version-routing',
  taskId: 'task:version-routing',
  title: 'Кто попадёт на новую модель',
  specialization: 'ai',
  subcategoryId: 'ai.mlops',
  grade: 'junior',
  catalogIds: ['ai.model-versioning', 'ai.model-serving'],
  format: 'list',
  a: 1.4,
  b: -0.8,
  paramSpace: 1e8,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const w = rng.pick([10, 20, 30, 50]);
    for (;;) {
      const ids = Array.from({ length: 6 }, () => rng.int(1000, 99999));
      const hit = ids.filter((id) => id % 100 < w);
      if (hit.length === 0 || hit.length === ids.length) continue;
      return {
        prompt: `Новая версия модели получает ${w} % пользователей: route = "v2" если user_id % 100 < ${w}, иначе "v1" (липкое назначение). Перечислите user_id, которые попадут на v2.`,
        code: ids.map((id) => `user_id = ${id}`).join('\n'),
        answerHint: 'user_id через запятую',
        answerKey: hit.join(','),
        explanation: ids.map((id) => `${id} % 100 = ${id % 100}`).join('; ') + '.',
        params: { w, ids: ids.join(',') },
      };
    }
  },
};

/** Дрейф признаков по PSI. */
export const driftPsi: TaskGenerator = {
  id: 'ai.drift-psi',
  taskId: 'task:drift-psi',
  title: 'У каких признаков дрейф',
  specialization: 'ai',
  subcategoryId: 'ai.mlops',
  grade: 'middle',
  catalogIds: ['ai.monitoring-drift'],
  format: 'list',
  a: 1.3,
  b: 0.6,
  paramSpace: 1e8,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const feats = rng.sample(['age', 'income', 'tenure', 'region_code', 'orders_30d', 'device'], 4);
    const thr = 0.2;
    for (;;) {
      const rows = feats.map((f) => {
        const e = [rng.int(15, 40), rng.int(15, 40), rng.int(15, 40)];
        e.push(100 - e[0]! - e[1]! - e[2]!);
        const shift = rng.next() < 0.45;
        const a = e.map((x) => Math.max(2, x + (shift ? rng.int(-15, 15) : rng.int(-3, 3))));
        const sa = a.reduce((s, x) => s + x, 0);
        const an = a.map((x) => Math.round((x / sa) * 100));
        an[3] = 100 - an[0]! - an[1]! - an[2]!;
        const psi = e.reduce((s, x, i) => {
          const p = Math.max(an[i]!, 1) / 100;
          const q = Math.max(x, 1) / 100;
          return s + (p - q) * Math.log(p / q);
        }, 0);
        return { f, e, a: an, psi };
      });
      if (rows.some((r) => r.a.some((x) => x <= 0)) || rows.some((r) => Math.abs(r.psi - thr) < 0.03)) continue;
      const drift = rows.filter((r) => r.psi > thr).map((r) => r.f);
      if (drift.length === 0 || drift.length === rows.length) continue;
      return {
        prompt: `Мониторинг дрейфа: доли по 4 бинам (%) на обучении и за последнюю неделю. PSI = Σ (факт − ожидание) × ln(факт / ожидание) по бинам (доли в долях единицы). Перечислите признаки с PSI > ${thr}.`,
        code: rows.map((r) => `${r.f}: обучение [${r.e.join(', ')}], неделя [${r.a.join(', ')}]`).join('\n'),
        answerHint: 'имена признаков через запятую',
        answerKey: drift.join(','),
        explanation: rows.map((r) => `${r.f}: PSI ${r.psi.toFixed(3)}`).join('; ') + '.',
        params: { rows: rows.map((r) => `${r.f}:${r.psi.toFixed(3)}`).join(',') },
      };
    }
  },
};

/** Триггер переобучения по падению метрики. */
export const retrainTrigger: TaskGenerator = {
  id: 'ai.retrain-trigger',
  taskId: 'task:retrain-trigger',
  title: 'Когда запустится переобучение',
  specialization: 'ai',
  subcategoryId: 'ai.mlops',
  grade: 'middle',
  catalogIds: ['ai.monitoring-drift', 'ai.model-versioning'],
  format: 'number',
  a: 1.2,
  b: 0.4,
  paramSpace: 1e8,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const base = rng.int(78, 90) / 100;
    const drop = rng.pick([0.03, 0.05]);
    const k = rng.int(2, 3);
    for (;;) {
      const xs = Array.from({ length: 10 }, (_, i) => Number((base - rng.int(0, Math.round(drop * 100) + 2 + Math.floor(i / 3)) / 100).toFixed(2)));
      let run = 0;
      let week = 0;
      for (let i = 0; i < xs.length; i++) {
        if (base - xs[i]! > drop + 1e-9) {
          if (++run === k) {
            week = i + 1;
            break;
          }
        } else run = 0;
      }
      if (week === 0) continue;
      return {
        prompt: `AUC модели на выкате - ${base.toFixed(2)}. Мониторинг считает AUC по неделям на размеченных данных. Переобучение запускается, когда AUC ниже выкатного больше чем на ${drop} ${k} недели подряд. На какой неделе запустится переобучение?`,
        code: xs.map((x, i) => `неделя ${i + 1}: ${x.toFixed(2)}`).join('\n'),
        answerHint: 'номер недели',
        answerKey: String(week),
        explanation: `Падение > ${drop} = AUC < ${(base - drop).toFixed(2)}; ${k}-я такая неделя подряд - ${week}. Одиночный провал без продолжения триггер не запускает.`,
        params: { base, drop, k, xs: xs.join(',') },
      };
    }
  },
};

// ===========================================================================
// ai.data-science
// ===========================================================================

/** Среднее и медиана при выбросе. */
export const meanMedian: TaskGenerator = {
  id: 'ai.mean-median',
  taskId: 'task:mean-median',
  title: 'Среднее или медиана',
  specialization: 'ai',
  subcategoryId: 'ai.data-science',
  grade: 'junior',
  catalogIds: ['ai.pandas-sql'],
  format: 'number',
  a: 1.4,
  b: -1.2,
  paramSpace: 1e9,
  timeLimitSec: 120,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = rng.pick([5, 6, 7, 8]);
    const xs = Array.from({ length: n - 1 }, () => rng.int(3, 15) * 10);
    xs.push(rng.int(10, 40) * 100);
    const shown = rng.shuffle(xs);
    const ask = rng.pick(['median', 'mean'] as const);
    const s = [...xs].sort((a, b) => a - b);
    const med = n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
    // Среднее делаем точным: подгоняем выброс так, чтобы сумма делилась на n.
    let sum = xs.reduce((a, b) => a + b, 0);
    const fix = (n - (sum % n)) % n;
    const outIdx = shown.indexOf(xs[n - 1]!);
    shown[outIdx] = xs[n - 1]! + fix;
    sum += fix;
    const mean = sum / n;
    return {
      prompt: `Чек покупки (₽) у ${n} клиентов. Чему равна ${ask === 'median' ? 'медиана' : 'среднее арифметическое'}?`,
      code: shown.join(', '),
      answerHint: 'число',
      answerKey: num(ask === 'median' ? med : mean),
      explanation: `Медиана ${num(med)}, среднее ${num(mean)}: один крупный чек тянет среднее, медиану - нет.`,
      params: { n, ask, xs: shown.join(',') },
    };
  },
};

/** Конверсия воронки. */
export const funnelConversion: TaskGenerator = {
  id: 'ai.funnel-conversion',
  taskId: 'task:funnel-conversion',
  title: 'Конверсия воронки',
  specialization: 'ai',
  subcategoryId: 'ai.data-science',
  grade: 'junior',
  catalogIds: ['ai.pandas-sql', 'ai.ab-testing'],
  format: 'number',
  a: 1.4,
  b: -1.0,
  paramSpace: 1e6,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const steps = ['зашли в каталог', 'открыли товар', 'добавили в корзину', 'оплатили'];
    const first = rng.pick([1000, 2000, 4000, 5000, 8000, 10000]);
    const c = [first];
    for (let i = 1; i < 4; i++) c.push(Math.round((c[i - 1]! * rng.pick([20, 25, 40, 50, 60, 75, 80])) / 100));
    const from = rng.int(0, 2);
    const to = rng.int(from + 1, 3);
    const value = c[to]! / c[from]!;
    return {
      prompt: `Воронка за неделю. Какая конверсия из шага «${steps[from]}» в шаг «${steps[to]}»? Ответ - дробь до 4 знаков.`,
      code: table(['шаг', 'пользователей'], steps.map((s, i) => [s, c[i]!])),
      answerHint: 'дробь, например 0.125',
      answerKey: `${num(Number(value.toFixed(4)))}|${num(Number((value * 100).toFixed(2)))}`,
      explanation: `${c[to]} / ${c[from]} = ${value.toFixed(4)}: делим на шаг, с которого считаем, а не на первый.`,
      params: { c: c.join(','), from, to },
    };
  },
};

/** SQL: GROUP BY + HAVING для аналитика. */
export const sqlCohort: TaskGenerator = {
  id: 'ai.sql-cohort',
  taskId: 'task:sql-analytics',
  title: 'Что вернёт аналитический запрос',
  specialization: 'ai',
  subcategoryId: 'ai.data-science',
  grade: 'junior',
  catalogIds: ['ai.pandas-sql', 'common.sql-queries'],
  format: 'number',
  a: 1.4,
  b: -0.7,
  paramSpace: 1e8,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const cities = rng.sample(CITIES, 3);
    const rows = Array.from({ length: rng.int(7, 9) }, (_, i) => ({ id: i + 1, user: rng.int(1, 4), city: rng.pick(cities), amount: rng.int(1, 12) * 100 }));
    const minN = rng.int(2, 3);
    const kind = rng.int(0, 1);
    let sql: string;
    let value: number;
    if (kind === 0) {
      sql = `SELECT city, COUNT(DISTINCT user_id)\nFROM orders\nGROUP BY city\nHAVING COUNT(*) >= ${minN};`;
      const byCity = new Map<string, number>();
      for (const r of rows) byCity.set(r.city, (byCity.get(r.city) ?? 0) + 1);
      value = [...byCity.values()].filter((n) => n >= minN).length;
    } else {
      const t = rng.int(3, 8) * 100;
      sql = `SELECT user_id, SUM(amount)\nFROM orders\nWHERE amount >= ${t}\nGROUP BY user_id;`;
      value = new Set(rows.filter((r) => r.amount >= t).map((r) => r.user)).size;
    }
    return {
      prompt: 'Сколько строк вернёт запрос?',
      code: [table(['id', 'user_id', 'city', 'amount'], rows.map((r) => [r.id, r.user, r.city, r.amount])), '', sql].join('\n'),
      answerHint: 'число строк',
      answerKey: String(value),
      explanation: kind === 0 ? `Строка на город, где заказов ≥ ${minN}: ${value}.` : `WHERE отсекает строки до группировки; строк - по числу пользователей с подходящими заказами: ${value}.`,
      params: { kind, minN },
    };
  },
};

/** A/B: относительный прирост конверсии. */
export const abUplift: TaskGenerator = {
  id: 'ai.ab-uplift',
  taskId: 'task:ab-uplift',
  title: 'Относительный прирост в A/B',
  specialization: 'ai',
  subcategoryId: 'ai.data-science',
  grade: 'middle',
  catalogIds: ['ai.ab-testing'],
  format: 'number',
  a: 1.2,
  b: 0.2,
  paramSpace: 1e6,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = rng.pick([2000, 4000, 5000, 10000]);
    const ca = rng.pick([4, 5, 8, 10, 20]);
    const lift = rng.pick([-20, -10, 5, 10, 20, 25, 50]);
    const cb = (ca * (100 + lift)) / 100;
    const xa = (n * ca) / 100;
    const xb = (n * cb) / 100;
    return {
      prompt: `A/B-тест новой модели рекомендаций: по ${n} пользователей в группе. Покупок: A (контроль) - ${num(xa)}, B - ${num(xb)}. На сколько процентов (относительно) конверсия B выше конверсии A? Уменьшение - с минусом.`,
      answerHint: 'проценты, например 12.5',
      answerKey: num(lift),
      explanation: `Конверсии: A ${ca} %, B ${num(cb)} %. Относительный прирост = (B − A) / A = ${lift} %; абсолютный - ${num(cb - ca)} п.п., их часто путают.`,
      params: { n, ca, lift },
    };
  },
};

/** Парадокс Симпсона. */
export const simpson: TaskGenerator = {
  id: 'ai.simpson',
  taskId: 'task:simpson',
  title: 'Суммарная доля при разных сегментах',
  specialization: 'ai',
  subcategoryId: 'ai.data-science',
  grade: 'middle',
  catalogIds: ['ai.ab-testing', 'ai.pandas-sql'],
  format: 'number',
  a: 1.2,
  b: 0.7,
  paramSpace: 1e6,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      // Два сегмента: в каждом X лучше, но Y чаще показывали в «лёгком» сегменте – суммарно Y может обогнать.
      const segs = rng.shuffle(['мобильные', 'десктоп']);
      const nx = [rng.int(1, 4) * 50, rng.int(8, 16) * 50];
      const ny = [rng.int(8, 16) * 50, rng.int(1, 4) * 50];
      const px = [rng.int(70, 95), rng.int(20, 40)];
      const py = [px[0]! - rng.int(2, 10), px[1]! - rng.int(2, 10)];
      const sx = [Math.round((nx[0]! * px[0]!) / 100), Math.round((nx[1]! * px[1]!) / 100)];
      const sy = [Math.round((ny[0]! * py[0]!) / 100), Math.round((ny[1]! * py[1]!) / 100)];
      const totX = (sx[0]! + sx[1]!) / (nx[0]! + nx[1]!);
      const totY = (sy[0]! + sy[1]!) / (ny[0]! + ny[1]!);
      const segBetter = sx[0]! / nx[0]! > sy[0]! / ny[0]! && sx[1]! / nx[1]! > sy[1]! / ny[1]!;
      if (!segBetter || Math.abs(totX - totY) < 0.02) continue;
      const diff = Number(((totX - totY) * 100).toFixed(1));
      const [lx, ly] = rng.pick([['A', 'B'], ['B', 'A']] as const);
      return {
        prompt: `Сравнивали варианты ${lx} и ${ly} по доле успешных ответов в двух сегментах. Насколько суммарная доля успехов ${lx} (по всем показам вместе) больше доли ${ly}? Ответ в процентных пунктах до 0,1, со знаком минус, если меньше.`,
        code: table(['сегмент', `${lx}: успехов / показов`, `${ly}: успехов / показов`], segs.map((s, i) => [s, `${sx[i]} / ${nx[i]}`, `${sy[i]} / ${ny[i]}`])),
        answerHint: 'п.п., например -12.3',
        answerKey: num(diff),
        explanation: `Суммарно ${lx} ${(totX * 100).toFixed(1)} %, ${ly} ${(totY * 100).toFixed(1)} % → ${num(diff)} п.п. Внутри каждого сегмента лучше ${lx}${diff < 0 ? `, но ${ly} чаще показывали в лёгком сегменте - парадокс Симпсона` : ''}. Среднее долей сегментов здесь не годится.`,
        params: { nx: nx.join(','), ny: ny.join(','), sx: sx.join(','), sy: sy.join(',') },
      };
    }
  },
};

/** Sample ratio mismatch: в каких экспериментах сплит сломан (χ², 1 степень свободы). */
export const srmCheck: TaskGenerator = {
  id: 'ai.srm-check',
  taskId: 'task:srm-check',
  title: 'В каких тестах сломан сплит',
  specialization: 'ai',
  subcategoryId: 'ai.data-science',
  grade: 'middle',
  catalogIds: ['ai.ab-testing'],
  format: 'list',
  a: 1.2,
  b: 0.6,
  paramSpace: 1e8,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const names = ['exp1', 'exp2', 'exp3', 'exp4'];
    for (;;) {
      const rows = names.map((name) => {
        const n = rng.pick([10000, 20000, 50000]);
        const skew = rng.next() < 0.5 ? rng.int(0, 60) : rng.int(150, 600);
        const a = n / 2 + (rng.int(0, 1) ? skew : -skew);
        const b = n - a;
        const e = n / 2;
        return { name, a, b, chi: ((a - e) ** 2 + (b - e) ** 2) / e };
      });
      if (rows.some((r) => Math.abs(r.chi - 3.84) < 1)) continue;
      const bad = rows.filter((r) => r.chi > 3.84).map((r) => r.name);
      if (bad.length === 0 || bad.length === rows.length) continue;
      return {
        prompt: 'Все тесты планировали 50/50. Перечислите эксперименты с sample ratio mismatch при α = 0,05 (χ² с 1 степенью свободы, критическое значение 3,84).',
        code: rows.map((r) => `${r.name}: A = ${r.a}, B = ${r.b}`).join('\n'),
        answerHint: 'имена через запятую',
        answerKey: bad.join(','),
        explanation: `χ² = Σ (факт − ожидание)² / ожидание: ${rows.map((r) => `${r.name} ${r.chi.toFixed(2)}`).join(', ')}. Выше 3,84 - сплит сломан, результат такого теста интерпретировать нельзя. Один и тот же перекос в абсолютных числах значит разное при разном n.`,
        params: { rows: rows.map((r) => `${r.name}:${r.a}/${r.b}`).join(',') },
      };
    }
  },
};

/** Множественные сравнения: поправка Бонферрони. */
export const bonferroni: TaskGenerator = {
  id: 'ai.bonferroni',
  taskId: 'task:multiple-testing',
  title: 'Сколько метрик значимы после поправки',
  specialization: 'ai',
  subcategoryId: 'ai.data-science',
  grade: 'middle',
  catalogIds: ['ai.ab-testing'],
  format: 'number',
  a: 1.2,
  b: 0.5,
  paramSpace: 1e8,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      const m = rng.int(4, 8);
      const alpha = 0.05;
      const cut = alpha / m;
      const ps = Array.from({ length: m }, () => {
        const r = rng.next();
        return r < 0.3 ? rng.int(1, 9) / 1000 : r < 0.6 ? rng.int(10, 49) / 1000 : rng.int(50, 900) / 1000;
      });
      if (ps.some((p) => Math.abs(p - cut) < 0.0005)) continue;
      const sig = ps.filter((p) => p < cut).length;
      const naive = ps.filter((p) => p < alpha).length;
      if (sig === naive) continue;
      return {
        prompt: `В A/B-тесте проверили ${m} метрик, α = 0,05, поправка Бонферрони. Сколько метрик значимы?`,
        code: ps.map((p, i) => `метрика ${i + 1}: p = ${p.toFixed(3)}`).join('\n'),
        answerHint: 'число метрик',
        answerKey: String(sig),
        explanation: `Порог Бонферрони α / m = ${cut.toFixed(4)}; ниже него ${sig} p-value. Без поправки было бы ${naive}.`,
        params: { m, ps: ps.join(',') },
      };
    }
  },
};

export const AI_EXTRA_GENERATORS: TaskGenerator[] = [
  contextBudget,
  rrfFusion,
  retryBackoff,
  rateLimits,
  extractionReview,
  fallbackChain,
  circuitBreaker,
  promptCache,
  splitSizes,
  majorityBaseline,
  thresholdChoice,
  earlyStopping,
  latencyPercentile,
  canaryTraffic,
  alertWindows,
  versionRouting,
  driftPsi,
  retrainTrigger,
  meanMedian,
  funnelConversion,
  sqlCohort,
  abUplift,
  simpson,
  srmCheck,
  bonferroni,
];
