// Слепой оценщик созвона (ADR 0003): видит только специализацию и пары вопрос-ответ по темам —
// без резюме, утверждений профиля, уровней вопросов и сигналов интервьюера. Рубрика A-02 (0–2 по
// четырём признакам) на каждую тему; 3 независимых прогона, итог — медиана; баллы без дословной
// цитаты обнуляет код (defense/evaluator checkQuote).
import { CRITERIA, type Criterion, type Score } from '../defense/types';
import { checkQuote, decidePassed, THRESHOLD } from '../defense/evaluator';
import { responseJsonSchema } from '../llm/schema';
import { type ChatMessage, LlmError, type LlmProvider } from '../llm/types';
import { contextBlock, loadCallPrompt } from './prompt-utils';
import { CallEvaluatorOutput } from './schemas';
import type { DepthMapItem, QuestionLevel, TopicScores } from './types';

const JSON_SCHEMA = responseJsonSchema(CallEvaluatorOutput) as object;

/** Прогонов оценщика на созвон и минимум валидных для вердикта. */
export const EVALUATOR_RUNS = 3;
export const MIN_VALID_RUNS = 2;

export interface EvalTopic {
  topic: string;
  catalogId: string | null;
  claimed: boolean;
  claimStatement: string | null;
  maxLevel: QuestionLevel;
  qa: { question: string; answer: string }[];
}

/** Что видит оценщик: только темы и пары вопрос-ответ (уровни, catalogId, утверждения — нет). */
export interface EvaluatorPayload {
  specialization: string;
  topics: { topic: string; qa: { question: string; answer: string }[] }[];
}

const REDACTED = '[фрагмент профиля скрыт от оценщика]';

/** Вырезать из вопросов факты резюме, которые интервьюер мог процитировать. */
export function redactFacts(text: string, facts: readonly string[]): string {
  let out = text;
  for (const f of facts) {
    const s = f.trim();
    if (s.length >= 8) out = out.split(s).join(REDACTED);
  }
  return out;
}

export function buildEvaluatorPayload(specialization: string, topics: readonly EvalTopic[], redact: readonly string[] = []): EvaluatorPayload {
  return {
    specialization,
    topics: topics.map((t) => ({
      topic: t.topic,
      qa: t.qa.map((p) => ({ question: redactFacts(p.question, redact), answer: p.answer.trim() === '' ? '(кандидат не ответил)' : p.answer })),
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
type RunTopic = Record<Criterion, RunCriterion>;

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

/** Сведение прогонов в карту глубины: медиана по каждому признаку, порог — как у защиты утверждения. */
export function aggregateRuns(topics: readonly EvalTopic[], runs: readonly RunTopic[][]): DepthMapItem[] {
  return topics.map((t, i) => {
    const per = runs.map((r) => r[i]!);
    const scores = Object.fromEntries(CRITERIA.map((c) => [c, medianScore(per.map((p) => p[c].score))])) as unknown as TopicScores;
    const total = CRITERIA.reduce((s, c) => s + scores[c], 0);
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
      confirmed: decidePassed(scores),
      scores,
      total,
      quote: (depthRun?.depth.quote ?? anyValid?.quote ?? '').trim(),
      runs: per.map((p) => Object.fromEntries(CRITERIA.map((c) => [c, p[c].score])) as unknown as TopicScores),
    };
  });
}

export interface CallEvaluation {
  depthMap: DepthMapItem[];
  runs: number;
  validRuns: number;
  thresholdVersion: string;
}

/**
 * 3 независимых прогона параллельно (семафор клиента LLM ограничивает одновременность).
 * Валидных меньше двух → LlmError: ответы сохранены, finish можно повторить.
 */
export async function evaluateCall(
  specialization: string,
  topics: readonly EvalTopic[],
  llm: LlmProvider,
  opts: { redact?: readonly string[]; signal?: AbortSignal } = {},
): Promise<CallEvaluation> {
  if (topics.length === 0) return { depthMap: [], runs: 0, validRuns: 0, thresholdVersion: THRESHOLD.version };
  const payload = buildEvaluatorPayload(specialization, topics, opts.redact ?? []);
  const settled = await Promise.allSettled(Array.from({ length: EVALUATOR_RUNS }, () => oneRun(payload, topics, llm, opts.signal)));
  const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  if (ok.length < MIN_VALID_RUNS) {
    const reason = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined;
    throw new LlmError('invalid_output', `Оценщик созвона: валидных прогонов ${ok.length} из ${EVALUATOR_RUNS}`, undefined, { cause: reason?.reason });
  }
  return { depthMap: aggregateRuns(topics, ok), runs: EVALUATOR_RUNS, validRuns: ok.length, thresholdVersion: THRESHOLD.version };
}
