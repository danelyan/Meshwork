import { z } from 'zod';

import { responseJsonSchema } from '../llm/schema';
import { LlmError, type ChatMessage, type LlmProvider } from '../llm/types';
import { loadPrompt, normalizeWs, tag } from './prompt-utils';
import {
  CRITERIA,
  type Criterion,
  type CriterionResult,
  type DefenseScores,
  type Score,
} from './types';

/**
 * Отдельный оценщик защиты (research/06 § 4.2). Видит только утверждение,
 * рубрику и пары вопрос-ответ — без резюме, без цитаты из резюме, без истории
 * и промпта интервьюера. Модель ставит баллы, код проверяет цитаты и решает
 * по порогу.
 */

// ---------------------------------------------------------------------------
// Порог — в коде, не в модели. ПРЕДЛОЖЕНИЕ: калибровать на разметке A-03.
// ---------------------------------------------------------------------------
export const THRESHOLD = {
  version: 'v0-proposal-2026-10-09',
  minTotal: 5,
  minWhy: 1,
  maxZeros: 1,
} as const;

export function scoreTotal(s: DefenseScores): number {
  return s.depth + s.why + s.boundary + s.completion;
}

/** passed: сумма ≥ 5 из 8, why ≥ 1, нулей не больше одного. */
export function decidePassed(s: DefenseScores): boolean {
  const zeros = CRITERIA.filter((c) => s[c] === 0).length;
  return scoreTotal(s) >= THRESHOLD.minTotal && s.why >= THRESHOLD.minWhy && zeros <= THRESHOLD.maxZeros;
}

// ---------------------------------------------------------------------------
// Схема вывода модели
// ---------------------------------------------------------------------------
const ScoreSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
// Порядок полей — цитата → обоснование → балл: модель сначала находит опору в ответе
// и формулирует вывод, потом ставит число (structured output генерирует поля по порядку схемы).
const CriterionSchema = z.object({
  quote: z.string().max(600),
  rationale: z.string().max(600),
  score: ScoreSchema,
});
export const EvaluatorOutput = z.object({
  depth: CriterionSchema,
  why: CriterionSchema,
  boundary: CriterionSchema,
  completion: CriterionSchema,
  advice: z.string().max(800),
});
export type EvaluatorOutput = z.infer<typeof EvaluatorOutput>;

const EVALUATOR_JSON_SCHEMA = responseJsonSchema(EvaluatorOutput) as object;

// ---------------------------------------------------------------------------
// Проверка цитат
// ---------------------------------------------------------------------------
const MIN_QUOTE_CHARS = 5;

/** Фразы-обращения к оценщику: такая «цитата» не доказывает ни один признак. */
// Узкие шаблоны: широкие («инструкци», «prompt», «score») ловят законные
// технические ответы (SIMD-инструкции, credit score). \w в JS без флага u
// не матчит кириллицу — везде \p{L} с флагом u.
const INSTRUCTION_RE = [
  /(постав|выстав|дай|начисл)\p{L}*\s+(мне|ему|кандидату|нам)\s/iu,
  /балл/iu,
  /\bscore\s*[=:]\s*\d/iu,
  /по\s+всем\s+(признакам|критериям|пунктам)/iu,
  /(игнорир|забуд|отмени)\p{L}*\s+(все|предыдущ|инструкц|правил|указан)/iu,
  /ignore\s+(all|previous|the\s+above)/iu,
  /(системн\p{L}*|system)\s+(промпт|prompt|сообщени|message)/iu,
  /оценщик|рубрик|rubric/iu,
  /\b(system|assistant)\s*:/iu,
  /<\/?\s*(candidate_answer|system|transcript|claim)/iu,
];

function unescapeData(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Нормализация для сравнения: пробелы, регистр, ё→е, внешние кавычки и многоточия. */
export function normalizeForQuote(text: string): string {
  return normalizeWs(unescapeData(text))
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/^[\s"'«»“”„.…]+|[\s"'«»“”„.…]+$/g, '');
}

export function checkQuote(
  quote: string,
  answers: string[],
): { valid: true } | { valid: false; reason: NonNullable<CriterionResult['quoteRejection']> } {
  const q = normalizeForQuote(quote);
  if (!q) return { valid: false, reason: 'missing' };
  if (q.replace(/\s/g, '').length < MIN_QUOTE_CHARS) return { valid: false, reason: 'too_short' };
  if (!answers.some((a) => normalizeForQuote(a).includes(q))) return { valid: false, reason: 'not_verbatim' };
  if (INSTRUCTION_RE.some((re) => re.test(q))) return { valid: false, reason: 'instruction_like' };
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Вызов модели
// ---------------------------------------------------------------------------
export interface EvaluatorInput {
  /** Формулировка утверждения в профиле. */
  claimStatement: string;
  /** Формулировка каталога (что именно утверждается). */
  catalogStatement: string;
  turns: { question: string; answer: string }[];
  /**
   * Фрагменты, которые нельзя показывать оценщику (цитата из резюме):
   * интервьюер вставляет её в первый вопрос — здесь она вырезается.
   */
  redact?: string[];
}

const REDACTED = '[фрагмент резюме скрыт от оценщика]';

function redact(text: string, parts: string[]): string {
  let out = text;
  for (const p of parts) {
    const s = p.trim();
    if (s.length >= 8) out = out.split(s).join(REDACTED);
  }
  return out;
}

export function buildEvaluatorMessages(input: EvaluatorInput): ChatMessage[] {
  const parts = input.redact ?? [];
  const transcript = input.turns
    .map(
      (t, i) =>
        `<turn n="${i + 1}">\n${tag('question', redact(t.question, parts))}\n${tag(
          'candidate_answer',
          t.answer.trim() === '' ? '(кандидат не ответил)' : t.answer,
        )}\n</turn>`,
    )
    .join('\n');
  const claim = `<claim>\n${tag('statement', input.claimStatement)}\n${tag('catalog', input.catalogStatement)}\n</claim>`;
  return [
    {
      role: 'user',
      content: `${claim}\n\n<transcript>\n${transcript}\n</transcript>\n\nОцени по рубрике. Ответ — только JSON по схеме.`,
    },
  ];
}

export interface EvaluationResult {
  criteria: CriterionResult[];
  scores: DefenseScores;
  advice: string;
  /** Сколько вызовов модели ушло (1 или 2 с ремонтом). */
  attempts: number;
}

/**
 * Один вызов + один ремонт при невалидном JSON. Не прошёл и ремонт →
 * LlmError('invalid_output'): уровень не меняется, сессию можно оценить повторно.
 */
export async function evaluateDefense(
  input: EvaluatorInput,
  llm: LlmProvider,
  signal?: AbortSignal,
): Promise<EvaluationResult> {
  const system = loadPrompt('evaluator');
  const messages = buildEvaluatorMessages(input);
  const schema = { name: 'defense_evaluation', jsonSchema: EVALUATOR_JSON_SCHEMA };

  let parsed: EvaluatorOutput | undefined;
  let lastError = '';
  let attempts = 0;
  for (let i = 0; i < 2 && !parsed; i++) {
    attempts++;
    const msgs: ChatMessage[] =
      i === 0
        ? messages
        : [
            ...messages,
            {
              role: 'user',
              content: `Предыдущий ответ не прошёл проверку схемы: ${lastError.slice(0, 500)}. Верни только JSON строго по схеме.`,
            },
          ];
    const res = await llm.complete(
      { purpose: 'evaluator', system, messages: msgs, schema, temperature: 0, maxTokens: 1500 },
      signal,
    );
    const raw = res.kind === 'json' ? res.json : tryParse(res.text);
    const r = EvaluatorOutput.safeParse(raw);
    if (r.success) parsed = r.data;
    else lastError = r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ');
  }
  if (!parsed) throw new LlmError('invalid_output', `Оценщик вернул невалидный ответ: ${lastError.slice(0, 300)}`);

  const answers = input.turns.map((t) => t.answer);
  const criteria: CriterionResult[] = CRITERIA.map((c: Criterion) => {
    const out = parsed[c];
    const modelScore = out.score as Score;
    const check = checkQuote(out.quote, answers);
    const quoteValid = check.valid;
    // Балл > 0 без дословной цитаты не засчитывается.
    const score: Score = quoteValid ? modelScore : 0;
    return {
      criterion: c,
      score,
      modelScore,
      quote: out.quote,
      quoteValid,
      ...(check.valid ? {} : { quoteRejection: check.reason }),
      rationale: out.rationale,
    };
  });
  const scores = Object.fromEntries(criteria.map((r) => [r.criterion, r.score])) as unknown as DefenseScores;
  return { criteria, scores, advice: parsed.advice, attempts };
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

// ---------------------------------------------------------------------------
// Объяснение для кандидата (строит код)
// ---------------------------------------------------------------------------
const LABEL: Record<Criterion, string> = {
  depth: 'глубина деталей',
  why: '«почему так» - альтернативы и их цена',
  boundary: 'честность на границе знаний',
  completion: 'доводит до результата',
};

const HINT: Record<Criterion, string> = {
  depth: 'рассказывай конкретику: механизмы, параметры, цифры, что именно делал сам',
  why: 'объясняй выбор: какие были альтернативы и чем заплатили за решение',
  boundary: 'если не уверен - так и скажи и порассуждай, как бы выяснил',
  completion: 'называй результат, как его проверил и за что отвечал лично',
};

export function buildExplanation(
  criteria: CriterionResult[],
  passed: boolean,
  advice: string,
): string {
  const total = criteria.reduce((s, c) => s + c.score, 0);
  const head = passed
    ? `Защита пройдена: ${total} из 8. Утверждение получает уровень «проверено платформой».`
    : `Защита не пройдена: ${total} из 8 (нужно ≥ 5, «почему так» ≥ 1 и не больше одного нуля). Уровень утверждения не изменился.`;
  const weak = criteria.filter((c) => c.score < 2);
  const lines = weak.map((c) => {
    const note = !c.quoteValid && c.modelScore > 0 ? ' (оценка не засчитана: нет дословной цитаты из ответа)' : '';
    return `• ${LABEL[c.criterion]} - ${c.score}/2${note}: ${HINT[c.criterion]}.`;
  });
  const tail =
    'Интервью проверяет понимание сейчас, а не подлинность истории из резюме; грамотность и стиль не оцениваются.';
  return [head, ...(lines.length ? ['Что подтянуть:', ...lines] : []), advice.trim() ? `Совет: ${advice.trim()}` : '', tail]
    .filter(Boolean)
    .join('\n');
}
