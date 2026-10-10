// Расширение банка ai.llm-apps: +3 Junior, +5 Middle, +4 Senior (решение владельца 11.10). Ключ считает код (R-T-02).
import { family, fx, sum } from './ai-bank2-util';
import { num, table } from './ai-util';

const SUB = 'ai.llm-apps';

// ---------------------------------------------------------------------------
// Junior
// ---------------------------------------------------------------------------

export const fewShotBudget = family(
  { id: 'ai.few-shot-budget', taskId: 'task:context-budget', title: 'Сколько примеров влезет в промпт', sub: SUB, grade: 'junior', catalogIds: ['ai.prompting', 'ai.llm-cost'], a: 1.3, b: -1.2, space: 1e7, time: 150 },
  (rng) => {
    const limit = rng.pick([4096, 8192, 16384, 32768]);
    const reserve = rng.pick([500, 1000, 1500, 2000]);
    const sys = rng.int(20, 80) * 10;
    const query = rng.int(5, 40) * 10;
    const ex = rng.int(8, 30) * 10;
    const k = Math.floor((limit - reserve - sys - query) / ex);
    return {
      prompt: `Окно контекста модели - ${limit} токенов. В нём должны поместиться системный промпт (${sys} токенов), запрос пользователя (${query}), несколько few-shot примеров по ${ex} токенов каждый и резерв под ответ ${reserve} токенов. Сколько целых примеров можно добавить?`,
      answerHint: 'число примеров',
      answerKey: String(k),
      explanation: `На примеры остаётся ${limit} - ${reserve} - ${sys} - ${query} = ${limit - reserve - sys - query} токенов; ${limit - reserve - sys - query} / ${ex} с округлением вниз = ${k}.`,
      params: { limit, reserve, sys, query, ex },
    };
  },
);

type Rec = Record<string, unknown>;

export const jsonSchemaValid = family(
  { id: 'ai.json-schema-valid', taskId: 'task:structured-output', title: 'Сколько ответов пройдут схему', sub: SUB, grade: 'junior', catalogIds: ['ai.structured-output'], a: 1.3, b: -0.9, space: 1e6, time: 180 },
  (rng) => {
    const n = rng.int(7, 9);
    const recs: Rec[] = [];
    let valid = 0;
    for (let i = 0; i < n; i++) {
      const rec: Rec = { id: rng.int(1, 99), name: rng.pick(['alpha', 'beta', 'gamma', 'delta']), score: rng.int(1, 99) / 10 };
      if (rng.next() < 0.4) rec.tags = ['x'];
      const defect = rng.pick(['ok', 'ok', 'missing', 'type', 'extra', 'null'] as const);
      if (defect === 'missing') delete rec[rng.pick(['id', 'name', 'score'])];
      else if (defect === 'type') rec.id = String(rec.id);
      else if (defect === 'extra') rec.comment = 'ok';
      else if (defect === 'null') rec.name = null;
      const ok = typeof rec.id === 'number' && Number.isInteger(rec.id) && typeof rec.name === 'string' && typeof rec.score === 'number' && (rec.tags === undefined || Array.isArray(rec.tags));
      if (ok) valid++;
      recs.push(rec);
    }
    return {
      prompt: 'Схема ответа модели: id - целое число (обязательно), name - строка (обязательно), score - число (обязательно), tags - список (необязательно). Лишние поля разрешены. Сколько из ответов ниже проходят валидацию?',
      code: recs.map((r, i) => `${i + 1}. ${JSON.stringify(r)}`).join('\n'),
      answerHint: 'число валидных',
      answerKey: String(valid),
      explanation: `Валидны ответы без пропущенных обязательных полей, с id-числом и name-строкой (null и "12" вместо числа не проходят); лишние поля не мешают. Итого ${valid} из ${n}.`,
      params: { n, recs: recs.map((r) => JSON.stringify(r)).join('|') },
    };
  },
);

export const chunkOverlapCover = family(
  { id: 'ai.chunk-overlap-cover', taskId: 'task:rag-chunking', title: 'В скольких чанках окажется фраза', sub: SUB, grade: 'junior', catalogIds: ['ai.rag'], a: 1.3, b: -0.8, space: 1e6, time: 180 },
  (rng) => {
    const size = rng.pick([200, 300, 400, 500]);
    const overlap = rng.pick([50, 100, 150, 200].filter((o) => o < size));
    const step = size - overlap;
    const total = rng.int(20, 60) * 50;
    const pos = rng.int(0, total - 1);
    let count = 0;
    const hit: number[] = [];
    for (let i = 0; i * step < total; i++) {
      if (pos >= i * step && pos < i * step + size) {
        count++;
        hit.push(i + 1);
      }
    }
    return {
      prompt: `Документ длиной ${total} символов режут на чанки по ${size} символов с перекрытием ${overlap} (шаг между началами чанков ${step}). Первый чанк начинается с символа 0; последний может быть короче. В скольких чанках окажется символ с номером ${pos}?`,
      answerHint: 'число чанков',
      answerKey: String(count),
      explanation: `Чанк i (с 0) покрывает [${step}·i; ${step}·i + ${size}). Символ ${pos} попадает в чанки ${hit.join(', ')} - итого ${count}.`,
      params: { size, overlap, total, pos },
    };
  },
);

// ---------------------------------------------------------------------------
// Middle
// ---------------------------------------------------------------------------

export const mrrRanking = family(
  { id: 'ai.mrr-ranking', taskId: 'task:retrieval-eval', title: 'MRR ретривера', sub: SUB, grade: 'middle', catalogIds: ['ai.llm-eval', 'ai.rag'], a: 1.2, b: 0.3, space: 1e8, time: 240 },
  (rng) => {
    const queries = rng.int(4, 6);
    const rows: string[] = [];
    let rrSum = 0;
    for (let q = 0; q < queries; q++) {
      const docs = rng.sample(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9'], 6);
      const rel = rng.sample([...docs, 'd10', 'd11'], rng.int(1, 2));
      const first = docs.findIndex((d) => rel.includes(d));
      rrSum += first === -1 ? 0 : 1 / (first + 1);
      rows.push(`q${q + 1}: выдача [${docs.join(', ')}]; релевантные {${rel.join(', ')}}`);
    }
    const mrr = rrSum / queries;
    return {
      prompt: `Оценка ретривера на ${queries} запросах. Выдача показана в порядке ранга (первые 6). MRR - среднее по запросам от 1/ранг первого релевантного документа; если в показанных 6 релевантного нет, вклад запроса 0. Посчитайте MRR.`,
      code: rows.join('\n'),
      answerHint: 'дробь до 3 знаков',
      answerKey: fx(mrr, 3),
      explanation: `Для каждого запроса берём 1/ранг первого релевантного (или 0) и усредняем по ${queries}: ${fx(mrr, 3)}.`,
      params: { rows: rows.join(' | ') },
    };
  },
);

export const rerankRecall = family(
  { id: 'ai.rerank-recall', taskId: 'task:hybrid-search', title: 'Recall после реранкера', sub: SUB, grade: 'middle', catalogIds: ['ai.rag', 'ai.vector-search'], a: 1.2, b: 0.4, space: 1e8, time: 240 },
  (rng) => {
    const n = 8;
    const scores = rng.shuffle([91, 84, 77, 70, 63, 55, 48, 40]);
    const rows = Array.from({ length: n }, (_, i) => ({ doc: `d${i + 1}`, rel: rng.next() < 0.4, score: scores[i]! }));
    const relRetrieved = rows.filter((r) => r.rel).length;
    const totalRel = relRetrieved + rng.int(1, 3);
    const keep = rng.int(2, 4);
    const top = [...rows].sort((a, b) => b.score - a.score).slice(0, keep);
    const hits = top.filter((r) => r.rel).length;
    return {
      prompt: `Первичный поиск вернул ${n} кандидатов, реранкер выставил оценки. В LLM уходят ${keep} документа с самыми высокими оценками. Во всей базе по запросу релевантных документов ${totalRel} (часть не попала в первичную выдачу). Чему равен recall@${keep} после реранка?`,
      code: table(['doc', 'релевантный', 'оценка реранкера'], rows.map((r) => [r.doc, r.rel ? 'да' : 'нет', r.score])),
      answerHint: 'дробь до 3 знаков',
      answerKey: fx(hits / totalRel, 3),
      explanation: `В топ-${keep} по оценке: ${top.map((r) => r.doc).join(', ')}; релевантных среди них ${hits}. Делим на все ${totalRel} релевантных в базе: ${fx(hits / totalRel, 3)}.`,
      params: { rows: rows.map((r) => `${r.rel ? 1 : 0}:${r.score}`).join(','), totalRel, keep },
    };
  },
);

export const judgeKappa = family(
  { id: 'ai.judge-kappa', taskId: 'task:model-selection', title: 'Согласие LLM-судьи с экспертами', sub: SUB, grade: 'middle', catalogIds: ['ai.llm-eval'], a: 1.2, b: 0.6, space: 1e8, time: 270 },
  (rng) => {
    for (;;) {
      const both = rng.int(15, 45);
      const jOnly = rng.int(2, 15);
      const hOnly = rng.int(2, 15);
      const neither = rng.int(10, 35);
      const n = both + jOnly + hOnly + neither;
      const po = (both + neither) / n;
      const pe = ((both + jOnly) / n) * ((both + hOnly) / n) + ((hOnly + neither) / n) * ((jOnly + neither) / n);
      const kappa = (po - pe) / (1 - pe);
      if (Math.abs((((kappa * 100) % 1) + 1) % 1 - 0.5) < 0.03) continue;
      return {
        prompt: 'LLM-судья и эксперты независимо оценили одни и те же ответы бота как «годен/не годен». Посчитайте коэффициент согласия Коэна: kappa = (po - pe) / (1 - pe), где po - доля совпадений, pe - ожидаемая случайно доля совпадений по маргиналам.',
        code: table(['', 'эксперт: годен', 'эксперт: не годен'], [['судья: годен', both, jOnly], ['судья: не годен', hOnly, neither]]),
        answerHint: 'число до 2 знаков',
        answerKey: fx(kappa, 2),
        explanation: `N = ${n}; po = ${fx(po, 4)}; pe = ${fx(pe, 4)}; kappa = (${fx(po, 4)} - ${fx(pe, 4)}) / (1 - ${fx(pe, 4)}) = ${fx(kappa, 2)}.`,
        params: { both, jOnly, hOnly, neither },
      };
    }
  },
);

const SIDE_EFFECT = ['send_email', 'delete_record', 'export_all'];
const ROLE_TOOLS: Record<string, string[]> = {
  viewer: ['read_doc', 'search'],
  editor: ['read_doc', 'search', 'send_email'],
  admin: ['read_doc', 'search', 'send_email', 'delete_record', 'export_all'],
};

export const toolPolicyTrace = family(
  { id: 'ai.tool-policy-trace', taskId: 'task:prompt-injection', title: 'Какие вызовы инструментов заблокирует политика', sub: SUB, grade: 'middle', catalogIds: ['ai.prompt-injection', 'ai.tool-use'], format: 'list', a: 1.2, b: 0.5, space: 1e9, time: 300 },
  (rng) => {
    for (;;) {
      const calls = Array.from({ length: 8 }, () => ({
        role: rng.pick(['viewer', 'editor', 'admin']),
        tool: rng.pick(['read_doc', 'search', 'send_email', 'delete_record', 'export_all']),
        source: rng.pick(['user', 'user', 'doc']),
        confirm: rng.pick(['yes', 'no']),
      }));
      const blocked = calls.map((c, i) => ({ c, i: i + 1 })).filter(({ c }) => !ROLE_TOOLS[c.role]!.includes(c.tool) || (c.source === 'doc' && SIDE_EFFECT.includes(c.tool) && c.confirm === 'no')).map(({ i }) => i);
      if (blocked.length < 2 || blocked.length > 6) continue;
      return {
        prompt: 'Политика агента: (1) роль может вызывать только свои инструменты (viewer: read_doc, search; editor: ещё send_email; admin: все, включая delete_record и export_all); (2) если аргументы вызова взяты из найденного документа (source=doc), инструмент с побочным эффектом (send_email, delete_record, export_all) требует подтверждения человека (confirm=yes), иначе вызов блокируется. Перечислите номера блокируемых вызовов.',
        code: calls.map((c, i) => `${i + 1}. role=${c.role} tool=${c.tool} source=${c.source} confirm=${c.confirm}`).join('\n'),
        answerHint: 'номера через запятую',
        answerKey: blocked.join(','),
        explanation: `Блокируются вызовы ${blocked.join(', ')}: нарушено правило роли (1) или правило подтверждения для данных из документа (2). Остальные проходят обе проверки.`,
        params: { calls: calls.map((c) => `${c.role}/${c.tool}/${c.source}/${c.confirm}`).join('|') },
      };
    }
  },
);

export const contextTrim = family(
  { id: 'ai.context-trim', taskId: 'task:context-budget', title: 'Сколько ходов диалога сожмётся в резюме', sub: SUB, grade: 'middle', catalogIds: ['ai.prompting', 'ai.llm-cost'], a: 1.2, b: 0.4, space: 1e9, time: 270 },
  (rng) => {
    const sys = rng.int(10, 40) * 10;
    const summary = rng.int(10, 30) * 10;
    const turns = Array.from({ length: rng.int(7, 10) }, () => rng.int(10, 60) * 10);
    const total = sys + sum(turns);
    const minFit = sys + summary + turns[turns.length - 1]! + turns[turns.length - 2]!;
    const limit = rng.int(minFit, total - 1);
    let dropped = 0;
    while (sys + summary + sum(turns.slice(dropped)) > limit && turns.length - dropped > 2) dropped++;
    return {
      prompt: `Бот хранит историю диалога. Если вся история вместе с системным промптом (${sys} токенов) не влезает в лимит ${limit} токенов, самые старые ходы по одному удаляются, а вместо них в историю добавляется резюме фиксированного размера ${summary} токенов. Два последних хода не удаляются никогда. Сколько ходов будет удалено (заменено резюме)?`,
      code: turns.map((t, i) => `ход ${i + 1}: ${t} токенов`).join('\n'),
      answerHint: 'число удалённых ходов',
      answerKey: String(dropped),
      explanation: `Без сжатия ${total} > ${limit}. Удаляем с начала, пока ${sys} + ${summary} + остаток ходов не станет ≤ ${limit}: нужно удалить ${dropped}.`,
      params: { sys, summary, limit, turns: turns.join(',') },
    };
  },
);

// ---------------------------------------------------------------------------
// Senior
// ---------------------------------------------------------------------------

export const embeddingMigration = family(
  { id: 'ai.embedding-migration', taskId: 'task:vector-storage', title: 'За сколько часов переиндексируется база', sub: SUB, grade: 'senior', catalogIds: ['ai.vector-search', 'ai.rag'], a: 1.2, b: 1.0, space: 1e10, time: 300 },
  (rng) => {
    const chunks = rng.int(20, 200) * 10_000;
    const tokens = rng.int(10, 50) * 10;
    const rpm = rng.pick([500, 1000, 2000, 3000]);
    const batch = rng.pick([16, 32, 64, 128]);
    const tpm = rng.pick([500_000, 1_000_000, 2_000_000, 4_000_000]);
    const share = rng.pick([50, 60, 70, 80]);
    const byRequests = rpm * batch;
    const byTokens = Math.floor(tpm / tokens);
    const bottleneck = byRequests < byTokens ? 'rpm' : 'tpm';
    const perMin = Math.floor((Math.min(byRequests, byTokens) * share) / 100);
    const hours = Math.ceil(chunks / perMin / 60);
    return {
      prompt: `Команда меняет модель эмбеддингов и переиндексирует базу: ${chunks} чанков по ${tokens} токенов. Лимиты провайдера: ${rpm} запросов в минуту (в запрос входит ${batch} чанков) и ${tpm} токенов в минуту. Живой трафик занимает часть лимитов, миграции доступно ${share} % от лимита (узкого места), результат округляется вниз до целых чанков в минуту. За сколько полных часов (округление вверх) закончится переиндексация?`,
      answerHint: 'часы, целое',
      answerKey: String(hours),
      explanation: `По запросам: ${rpm} × ${batch} = ${byRequests} чанков/мин, по токенам: ${tpm} / ${tokens} = ${byTokens}. Узкое место - ${bottleneck}; ${share} % даёт ${perMin} чанков/мин. ${chunks} / ${perMin} / 60 ≈ ${num(Number((chunks / perMin / 60).toFixed(2)))} ч → ${hours}.`,
      params: { chunks, tokens, rpm, batch, tpm, share },
    };
  },
);

export const evalSampleSize = family(
  { id: 'ai.eval-sample-size', taskId: 'task:eval-release-gate', title: 'Сколько кейсов нужно для сравнения промптов', sub: SUB, grade: 'senior', catalogIds: ['ai.llm-eval', 'ai.prompting'], a: 1.3, b: 1.2, space: 1e3, time: 300 },
  (rng) => {
    const p1 = rng.pick([60, 65, 70, 75, 80, 85, 90]);
    const delta = rng.pick([3, 4, 5, 6, 8, 10]);
    const alpha = rng.pick([{ pct: 5, z: 1.96 }, { pct: 1, z: 2.58 }]);
    const power = rng.pick([{ pct: 80, z: 0.84 }, { pct: 90, z: 1.28 }]);
    const p2 = p1 + delta;
    const q1 = p1 / 100;
    const q2 = p2 / 100;
    const zz = (alpha.z + power.z) ** 2;
    const raw = (zz * (q1 * (1 - q1) + q2 * (1 - q2))) / (delta / 100) ** 2;
    const n = Math.ceil(raw - 1e-9);
    return {
      prompt: `Сейчас промпт A проходит ${p1} % кейсов оценки. Нужно надёжно увидеть, что новый промпт B лучше на ${delta} п.п. (то есть проходит ${p2} %). Критерий: двусторонний уровень значимости ${alpha.pct} % (z = ${alpha.z}) и мощность ${power.pct} % (z = ${power.z}); на каждый промпт отдельная выборка. Используйте n = (z₁ + z₂)² · (p₁(1-p₁) + p₂(1-p₂)) / (p₂ - p₁)². Сколько кейсов нужно на один промпт (округление вверх)?`,
      answerHint: 'число кейсов',
      answerKey: String(n),
      explanation: `(${alpha.z} + ${power.z})² = ${fx(zz, 4)}; p₁(1-p₁) + p₂(1-p₂) = ${fx(q1 * (1 - q1) + q2 * (1 - q2), 4)}; делим на ${fx((delta / 100) ** 2, 4)}: ${fx(raw, 2)} → ${n}.`,
      params: { p1, delta, alpha: alpha.pct, power: power.pct },
    };
  },
);

export const guardrailCascade = family(
  { id: 'ai.guardrail-cascade', taskId: 'task:semantic-cache', title: 'Порог каскада проверок', sub: SUB, grade: 'senior', catalogIds: ['ai.llm-cost', 'ai.vector-search'], format: 'number', a: 1.2, b: 1.3, space: 1e9, time: 330 },
  (rng) => {
    for (;;) {
      const thr = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
      const esc = rng.sample([5, 8, 12, 17, 23, 30, 38, 46, 55, 62], 6).sort((a, b) => b - a);
      const miss = rng.sample([14, 12, 10, 9, 7, 6, 5, 4, 3, 2, 1], 6).sort((a, b) => a - b);
      const c1x100 = rng.pick([50, 100, 200]);
      const c2 = rng.pick([8, 12, 20]);
      const rows = thr.map((t, i) => ({ t, e: esc[i]!, m: miss[i]!, cost100: c1x100 + esc[i]! * c2 }));
      const budget100 = rng.int(c1x100 + 20 * c2, c1x100 + 60 * c2);
      const maxMiss = rng.int(2, 10);
      const ok = rows.filter((r) => r.cost100 <= budget100 && r.m <= maxMiss).sort((a, b) => a.cost100 - b.cost100);
      if (ok.length === 0 || ok.length === rows.length) continue;
      const best = ok[0]!;
      return {
        prompt: `Вход проверяется каскадом: дешёвый классификатор оценивает каждый запрос (${num(c1x100 / 100)} $ за 1000 запросов), и запросы, где его уверенность ниже порога, уходят на проверку LLM (${c2} $ за 1000 таких вызовов). Для каждого порога в таблице - доля эскалаций и доля пропущенных нарушений. Бюджет - не больше ${num(budget100 / 100)} $ за 1000 запросов, допустимая доля пропусков - не больше ${maxMiss} %. Какой порог выбрать, чтобы уложиться в оба ограничения при минимальной стоимости?`,
        code: table(['порог', 'эскалаций, %', 'пропусков, %'], rng.shuffle(rows).map((r) => [r.t, r.e, r.m])),
        answerHint: 'порог, например 0.7',
        answerKey: num(best.t),
        explanation: `Стоимость порога = ${num(c1x100 / 100)} + эскалации × ${c2}/100 $. Подходят по обоим ограничениям пороги ${ok.map((r) => r.t).join(', ')}; дешевле всех - ${best.t}.`,
        params: { budget100, maxMiss, c1x100, c2, rows: rows.map((r) => `${r.t}:${r.e}:${r.m}`).join(',') },
      };
    }
  },
);

export const agentStepBudget = family(
  { id: 'ai.agent-step-budget', taskId: 'task:agent-trace', title: 'Сколько шагов агента влезет в бюджет', sub: SUB, grade: 'senior', catalogIds: ['ai.tool-use', 'ai.llm-eval'], a: 1.2, b: 1.4, space: 1e9, time: 330 },
  (rng) => {
    for (;;) {
      const base = rng.int(15, 40) * 100;
      const delta = rng.int(4, 12) * 100;
      const price = rng.pick([1, 3, 5]); // $ за 1 млн входных токенов
      const budgetCents = rng.int(10, 120);
      const limit = budgetCents * 100_000; // в единицах 1e-7 $
      let spent = 0;
      let steps = 0;
      for (let i = 1; i <= 80; i++) {
        const cost = i === 1 ? base * price * 10 : base * price + (i - 1) * delta * price * 10;
        if (spent + cost > limit) break;
        spent += cost;
        steps = i;
      }
      if (steps < 3 || steps >= 80) continue;
      return {
        prompt: `Агент делает шаги: на каждом шаге в модель уходит весь накопленный контекст. На 1-м шаге - ${base} входных токенов (системный промпт и задача), после каждого шага контекст растёт на ${delta} токенов (ответ инструмента). Начиная со 2-го шага первые ${base} токенов читаются из кеша промпта и стоят 10 % цены, остальное - полная цена ${price} $ за 1 млн токенов. Выходные токены не считаем. Агент останавливается, если следующий шаг не укладывается в бюджет ${num(budgetCents / 100)} $ на задачу. Сколько шагов он успеет сделать?`,
        answerHint: 'число шагов',
        answerKey: String(steps),
        explanation: `Шаг i ≥ 2 стоит (${base} × 0,1 + ${delta}·(i-1)) × ${price} / 1e6 $; шаг 1 - ${base} × ${price} / 1e6 $. Накопленные затраты ${fx(spent / 1e7, 4)} $ после ${steps} шагов, следующий шаг уже не влезает в ${num(budgetCents / 100)} $.`,
        params: { base, delta, price, budgetCents },
      };
    }
  },
);

export const AI_BANK2_LLM = [
  fewShotBudget,
  jsonSchemaValid,
  chunkOverlapCover,
  mrrRanking,
  rerankRecall,
  judgeKappa,
  toolPolicyTrace,
  contextTrim,
  embeddingMigration,
  evalSampleSize,
  guardrailCascade,
  agentStepBudget,
];
