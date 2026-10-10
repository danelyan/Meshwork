// Слепой оценщик созвона (ADR 0003): видит только специализацию и пары вопрос-ответ по темам —
// без резюме, утверждений профиля, уровней вопросов и сигналов интервьюера. Рубрика A-02 (0–2 по
// четырём признакам) на каждую тему; прогоны адаптивные (3, при разбросе — ещё 2), итог — медиана;
// баллы без дословной цитаты обнуляет код (defense/evaluator checkQuote). Тема, где прогоны разошлись
// в решении порога, получает статус inconclusive (интервьюер задаёт по ней ещё вопрос — service.ts).
import { CRITERIA, type Criterion, type Score } from '../defense/types';
import { checkQuote, decidePassed, THRESHOLD } from '../defense/evaluator';
import { responseJsonSchema } from '../llm/schema';
import { type ChatMessage, LlmError, type LlmProvider } from '../llm/types';
import { contextBlock, loadCallPrompt } from './prompt-utils';
import { CallEvaluatorOutput } from './schemas';
import type { DepthMapItem, DepthStatus, QuestionLevel, TopicScores } from './types';

const JSON_SCHEMA = responseJsonSchema(CallEvaluatorOutput) as object;

/** Прогонов оценщика на созвон (базово), добавочных при расхождении и минимум валидных для вердикта. */
export const EVALUATOR_RUNS = 3;
export const EXTRA_RUNS = 2;
export const MIN_VALID_RUNS = 2;

/**
 * Правила решения по теме (валидация 10.10, docs/validation-stages.md):
 * - разброс суммы между прогонами > extraRunsSpread или разные решения порога → ещё EXTRA_RUNS прогонов;
 * - решение темы принято, если с медианой согласны ≥ minAgreement прогонов (3 из 3, 4 из 5);
 *   иначе — inconclusive. Полосу «медиана 4–5» валидация отвергла как слишком широкую (13 из 36 тем),
 *   оставлена выключенной (inconclusiveBand = null).
 */
export const DECISION_RULES = {
  extraRunsSpread: 2,
  minAgreement: 0.75,
  inconclusiveBand: null as null | readonly [number, number],
  version: 'call-eval-v2-2026-10-10',
} as const;

/**
 * Что оценщик видит вместо текста вопроса: `question` — сам вопрос (пересказ профиля интервьюером
 * вырезается redactFacts); `type` — только уровень вопроса («база / практика / глубина»).
 * Выбор — по замеру на сохранённых транскриптах валидации (docs/validation-stages.md, раздел 10.10).
 */
export type EvaluatorView = 'question' | 'type';
export const EVALUATOR_VIEW: EvaluatorView = 'question';

export interface EvalTopic {
  topic: string;
  catalogId: string | null;
  claimed: boolean;
  claimStatement: string | null;
  maxLevel: QuestionLevel;
  qa: { question: string; answer: string; level?: QuestionLevel }[];
}

/** Что видит оценщик: только темы и пары вопрос-ответ (catalogId, утверждения, сигналы — нет). */
export interface EvaluatorPayload {
  specialization: string;
  topics: { topic: string; qa: { question?: string; questionType?: string; answer: string }[] }[];
}

const REDACTED = '[фрагмент профиля скрыт от оценщика]';

const PREFIX_CHARS = 40;
/** Пересказ: общая последовательность из стольких слов подряд с утверждением или фактом резюме. */
export const RETELL_NGRAM = 4;

const WORD_RE = /[\p{L}\p{N}]+/gu;
const normWord = (w: string) => w.toLowerCase().replace(/ё/g, 'е');

function words(text: string): { w: string; start: number; end: number }[] {
  return [...text.matchAll(WORD_RE)].map((m) => ({ w: normWord(m[0]), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}

/**
 * Участки `text`, совпадающие с источниками последовательностью из ≥ n слов подряд (регистр и ё не важны).
 * Перекрывающиеся участки сливаются. Так ловится пересказ утверждения близко к тексту.
 */
export function sharedNgramSpans(
  text: string,
  sources: readonly (string | null | undefined)[],
  n = RETELL_NGRAM,
  /** Тексты, которые произносить можно (название темы — оценщик его и так видит): их n-граммы не считаются. */
  allow: readonly string[] = [],
): [number, number][] {
  const gramsOf = (src: string) => {
    const ws = words(src).map((x) => x.w);
    return Array.from({ length: Math.max(0, ws.length - n + 1) }, (_, i) => ws.slice(i, i + n).join(' '));
  };
  const allowed = new Set(allow.flatMap(gramsOf));
  const grams = new Set<string>();
  for (const src of sources) if (src) for (const g of gramsOf(src)) if (!allowed.has(g)) grams.add(g);
  if (!grams.size) return [];
  const tw = words(text);
  const spans: [number, number][] = [];
  for (let i = 0; i + n <= tw.length; i++) {
    if (!grams.has(tw.slice(i, i + n).map((x) => x.w).join(' '))) continue;
    const s = tw[i]!.start;
    const e = tw[i + n - 1]!.end;
    const last = spans[spans.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else spans.push([s, e]);
  }
  return spans;
}

export function retellsProfile(text: string, sources: readonly (string | null | undefined)[], allow: readonly string[] = [], n = RETELL_NGRAM): boolean {
  return sharedNgramSpans(text, sources, n, allow).length > 0;
}

/**
 * Вырезать из вопросов факты профиля, которые интервьюер мог процитировать или пересказать: дословно
 * целиком, усечённым началом (≥ 40 символов) и любой общей последовательностью из ≥ 4 слов.
 * Промпт оценщика к тому же не засчитывает кандидату сказанное в вопросе.
 */
export function redactFacts(text: string, facts: readonly string[], allow: readonly string[] = []): string {
  let out = text;
  for (const f of facts) {
    const s = f.replace(/\s+/g, ' ').trim();
    if (s.length < 8) continue;
    out = out.split(s).join(REDACTED);
    if (s.length > PREFIX_CHARS) out = out.split(s.slice(0, PREFIX_CHARS)).join(REDACTED);
  }
  const spans = sharedNgramSpans(out, facts, RETELL_NGRAM, allow);
  for (let i = spans.length - 1; i >= 0; i--) {
    const [s, e] = spans[i]!;
    out = `${out.slice(0, s)}${REDACTED}${out.slice(e)}`;
  }
  return out;
}

const LEVEL_TYPE: Record<QuestionLevel, string> = {
  1: 'базовый вопрос: что это и зачем',
  2: 'рабочий вопрос: как устроено, что делал сам',
  3: 'глубокий вопрос: почему так, альтернативы и их цена, где граница подхода',
};

export function buildEvaluatorPayload(
  specialization: string,
  topics: readonly EvalTopic[],
  redact: readonly string[] = [],
  view: EvaluatorView = EVALUATOR_VIEW,
): EvaluatorPayload {
  return {
    specialization,
    topics: topics.map((t) => ({
      topic: t.topic,
      qa: t.qa.map((p) => {
        const answer = p.answer.trim() === '' ? '(кандидат не ответил)' : p.answer;
        return view === 'type' ? { questionType: LEVEL_TYPE[p.level ?? t.maxLevel], answer } : { question: redactFacts(p.question, redact, [t.topic]), answer };
      }),
    })),
  };
}

export function buildCallEvaluatorMessages(payload: EvaluatorPayload): ChatMessage[] {
  return [{ role: 'user', content: `${contextBlock(payload)}\n\nОцени каждую тему по рубрике. Ответ — только JSON по схеме.` }];
}

/** Медиана баллов; при чётном числе — нижняя из средних (консервативно: сомнение не в пользу повышения). */
export function medianScore(values: readonly Score[]): Score {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] as Score;
}

interface RunCriterion {
  score: Score;
  quote: string;
  valid: boolean;
}
export type RunTopic = Record<Criterion, RunCriterion>;

/** Один прогон: вызов + один ремонт при невалидном JSON. Баллы уже проверены по цитатам. */
async function oneRun(
  payload: EvaluatorPayload,
  topics: readonly EvalTopic[],
  llm: LlmProvider,
  signal?: AbortSignal,
): Promise<RunTopic[]> {
  const system = loadCallPrompt('evaluator');
  const messages = buildCallEvaluatorMessages(payload);
  let parsed: CallEvaluatorOutput | undefined;
  let lastError = '';
  for (let i = 0; i < 2 && !parsed; i++) {
    const msgs: ChatMessage[] =
      i === 0 ? messages : [...messages, { role: 'user', content: `Предыдущий ответ не прошёл проверку схемы: ${lastError.slice(0, 400)}. Верни только JSON строго по схеме.` }];
    const res = await llm.complete(
      { purpose: 'call_evaluator', system, messages: msgs, schema: { name: 'call_evaluation', jsonSchema: JSON_SCHEMA }, temperature: 0.3, maxTokens: 3000 },
      signal,
    );
    const r = CallEvaluatorOutput.safeParse(res.kind === 'json' ? res.json : tryParse(res.text));
    if (r.success) parsed = r.data;
    else lastError = r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ');
  }
  if (!parsed) throw new LlmError('invalid_output', `Оценщик созвона вернул невалидный ответ: ${lastError.slice(0, 300)}`);
  const out = parsed;
  return topics.map((t, i) => {
    // Тема по имени, иначе по позиции; не нашлась — нули (оценщик её пропустил).
    const row = out.topics.find((x) => x.topic.trim() === t.topic) ?? out.topics[i];
    const answers = t.qa.map((p) => p.answer);
    return Object.fromEntries(
      CRITERIA.map((c) => {
        const cr = row?.[c];
        if (!cr) return [c, { score: 0, quote: '', valid: false }];
        const valid = checkQuote(cr.quote, answers).valid;
        return [c, { score: (valid ? cr.score : 0) as Score, quote: cr.quote, valid }];
      }),
    ) as RunTopic;
  });
}

function tryParse(text: string | undefined): unknown {
  if (!text) return undefined;
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return undefined;
  try {
    return JSON.parse(m[0]);
  } catch {
    return undefined;
  }
}

const totalOf = (s: TopicScores): number => CRITERIA.reduce((acc, c) => acc + s[c], 0);

/** Нужны ли добавочные прогоны: по какой-то теме разброс суммы > порога или прогоны разошлись в решении. */
export function needsExtraRuns(runs: readonly (readonly TopicScores[])[]): boolean {
  if (runs.length < 2) return false;
  const n = runs[0]?.length ?? 0;
  for (let i = 0; i < n; i++) {
    const per = runs.map((r) => r[i]!);
    const totals = per.map(totalOf);
    if (Math.max(...totals) - Math.min(...totals) > DECISION_RULES.extraRunsSpread) return true;
    if (new Set(per.map((p) => decidePassed(p))).size > 1) return true;
  }
  return false;
}

/** Решение по теме из медианы и согласия прогонов. */
export function decideStatus(median: TopicScores, runs: readonly TopicScores[]): { status: Exclude<DepthStatus, 'not_probed'>; same: number } {
  const passed = decidePassed(median);
  const same = runs.filter((r) => decidePassed(r) === passed).length;
  const total = totalOf(median);
  const band = DECISION_RULES.inconclusiveBand;
  const split = runs.length > 0 && same / runs.length < DECISION_RULES.minAgreement;
  if (split || (band && total >= band[0] && total <= band[1])) return { status: 'inconclusive', same };
  return { status: passed ? 'confirmed' : 'not_confirmed', same };
}

/** Сведение прогонов в карту глубины: медиана по каждому признаку, порог — как у защиты утверждения. */
export function aggregateRuns(topics: readonly EvalTopic[], runs: readonly RunTopic[][]): DepthMapItem[] {
  return topics.map((t, i) => {
    const per = runs.map((r) => r[i]!);
    const scores = Object.fromEntries(CRITERIA.map((c) => [c, medianScore(per.map((p) => p[c].score))])) as unknown as TopicScores;
    const total = CRITERIA.reduce((s, c) => s + scores[c], 0);
    const runScores = per.map((p) => Object.fromEntries(CRITERIA.map((c) => [c, p[c].score])) as unknown as TopicScores);
    const { status, same } = decideStatus(scores, runScores);
    // Цитата — из прогона, где глубина совпала с медианой; иначе любая принятая.
    const depthRun = per.find((p) => p.depth.valid && p.depth.score === scores.depth);
    const anyValid = per.flatMap((p) => CRITERIA.map((c) => p[c])).find((x) => x.valid && x.score > 0);
    return {
      topic: t.topic,
      catalogId: t.catalogId,
      claimed: t.claimed,
      claimStatement: t.claimStatement,
      probed: t.qa.length,
      maxLevel: t.maxLevel,
      confirmed: status === 'confirmed',
      status,
      agreement: { same, of: per.length },
      scores,
      total,
      quote: (depthRun?.depth.quote ?? anyValid?.quote ?? '').trim(),
      runs: runScores,
    };
  });
}

/** Строка карты для темы, по которой не спрашивали: «не проверено». */
export function notProbedItem(t: { topic: string; catalogId: string | null; claimStatement: string | null }): DepthMapItem {
  return {
    topic: t.topic,
    catalogId: t.catalogId,
    claimed: Boolean(t.claimStatement),
    claimStatement: t.claimStatement,
    probed: 0,
    maxLevel: 1,
    confirmed: false,
    status: 'not_probed',
    scores: { depth: 0, why: 0, boundary: 0, completion: 0 },
    total: 0,
    quote: '',
    runs: [],
  };
}

export interface CallEvaluation {
  depthMap: DepthMapItem[];
  runs: number;
  validRuns: number;
  thresholdVersion: string;
}

async function runBatch(n: number, payload: EvaluatorPayload, topics: readonly EvalTopic[], llm: LlmProvider, signal?: AbortSignal) {
  return Promise.allSettled(Array.from({ length: n }, () => oneRun(payload, topics, llm, signal)));
}

/**
 * 3 независимых прогона параллельно (семафор клиента LLM ограничивает одновременность); при разбросе
 * суммы > 2 или расхождении в решении по какой-то теме — ещё 2. Валидных меньше двух → LlmError:
 * ответы сохранены, finish можно повторить.
 */
export async function evaluateCall(
  specialization: string,
  topics: readonly EvalTopic[],
  llm: LlmProvider,
  opts: { redact?: readonly string[]; signal?: AbortSignal; view?: EvaluatorView; adaptive?: boolean } = {},
): Promise<CallEvaluation> {
  if (topics.length === 0) return { depthMap: [], runs: 0, validRuns: 0, thresholdVersion: `${THRESHOLD.version}+${DECISION_RULES.version}` };
  const payload = buildEvaluatorPayload(specialization, topics, opts.redact ?? [], opts.view ?? EVALUATOR_VIEW);
  const settled = await runBatch(EVALUATOR_RUNS, payload, topics, llm, opts.signal);
  let ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  if (ok.length < MIN_VALID_RUNS) {
    const reason = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined;
    throw new LlmError('invalid_output', `Оценщик созвона: валидных прогонов ${ok.length} из ${EVALUATOR_RUNS}`, undefined, { cause: reason?.reason });
  }
  let runs = EVALUATOR_RUNS;
  const scoresOf = (rs: RunTopic[][]) => rs.map((r) => r.map((p) => Object.fromEntries(CRITERIA.map((c) => [c, p[c].score])) as unknown as TopicScores));
  if ((opts.adaptive ?? true) && needsExtraRuns(scoresOf(ok))) {
    const extra = await runBatch(EXTRA_RUNS, payload, topics, llm, opts.signal);
    ok = [...ok, ...extra.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))];
    runs += EXTRA_RUNS;
  }
  return { depthMap: aggregateRuns(topics, ok), runs, validRuns: ok.length, thresholdVersion: `${THRESHOLD.version}+${DECISION_RULES.version}` };
}
