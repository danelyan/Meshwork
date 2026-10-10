import { z } from 'zod';

import { checkQuoteLoose, decidePassed, scoreTotal, THRESHOLD } from '../defense/evaluator';
import { CRITERIA, type DefenseScores, type Score } from '../defense/types';
import { contextBlock } from '../call/prompt-utils';
import { AppError } from '../errors';
import { responseJsonSchema } from '../llm/schema';
import { type ChatMessage, LlmError, type LlmProvider } from '../llm/types';
import { loadRoomPrompt } from './prompts';
import type { DefenseFlag, DefenseItemVerdict, DefenseRoomVerdict, PlanItem, QlcType, TranscriptEntry } from './types';

/**
 * Вердикт защиты проекта: слепой оценщик по рубрике A-02 **по каждому вопросу** (пункту плана QLC или
 * вопросу работодателя), прогоны адаптивные (3, при расхождении — ещё 2), медиана по каждому признаку
 * внутри вопроса; общий балл — среднее по вопросам. Так «понимает часть проекта» отличается от «не
 * понимает ничего» (валидация 10.10: при одном балле на весь транскрипт AUC (b)/(c) был 0,67).
 * Оценщик видит только вопросы и ответы кандидата: ни кода, ни результата тестов, ни ожидаемых пунктов.
 * Слабая защита при сильном проекте — флаг работодателю, не понижение; вердикта «фейк» нет
 * (ст. 16 152-ФЗ: решение, порождающее последствия, не принимается только автоматически).
 */

export const VERDICT_RUNS = 3;
export const VERDICT_EXTRA_RUNS = 2;
export const VERDICT_RULES = {
  /** Проект «сильный»: доля скрытых тестов не ниже. Валидация 10.10: разделяет полностью, оставлен. */
  strongProjectScore: 0.8,
  /** Ответов меньше — флаг short_defense. */
  minAnswers: 3,
  /** Разброс общего балла прогонов не меньше — флаг evaluator_disagreement. */
  disagreementSpread: 3,
  /** Разброс суммы по вопросу между прогонами больше — добавочные прогоны. */
  extraRunsSpread: 2,
  /** Доля прогонов, согласных с медианой по решению порога вопроса; меньше — вопрос «разошёлся». */
  minAgreement: 0.75,
  /**
   * uneven_understanding: разброс сумм по вопросам ≥ unevenSpread, либо ≥ unevenSpread − 1 при вопросе с суммой
   * ≤ lowItemTotal. Подобрано на 9 транскриптах валидации 10.10 (переоценка): «понимает частично» 3/3, «сделал сам»
   * и «ИИ целиком» 0/3; выборка маленькая — порог предварительный.
   */
  unevenSpread: 3,
  lowItemTotal: 2,
  version: 'defense-room-v1-2026-10-10-items',
} as const;

const QLC_LABEL: Record<QlcType | 'employer', string> = {
  what: 'что делает',
  why: 'почему так',
  what_breaks: 'что сломается',
  change: 'измени поведение',
  constraint: 'смени ограничение',
  employer: 'вопрос работодателя',
};

/**
 * Пары для оценщика: ответ кандидата и вопросы ИИ перед ним (по плану: QLC, вопросы работодателя из
 * очереди, уточнения). Живые реплики работодателя (`say`) оценщику не отдаются: это не вопросы рубрики,
 * и в них может быть что угодно (зарплата, условия, оценки кандидата). Ответ на такую реплику
 * дописывается к предыдущему ответу.
 */
export function transcriptTurns(transcript: TranscriptEntry[]): { question: string; answer: string }[] {
  return itemTurns(transcript).flatMap((g) => g.qa);
}

export interface ItemTurns {
  itemId: string;
  /** Подпись из meta реплики ИИ (если плана нет). */
  topic: string;
  qa: { question: string; answer: string }[];
}

/** Те же пары, сгруппированные по пункту плана (`defense.itemId` реплики ИИ), в порядке первого вопроса. */
export function itemTurns(transcript: TranscriptEntry[]): ItemTurns[] {
  const groups: ItemTurns[] = [];
  const byId = new Map<string, ItemTurns>();
  let asked: string[] = [];
  let askedItem: string | null = null;
  let askedTopic = '';
  let lastGroup: ItemTurns | null = null;
  for (const e of transcript) {
    if (e.role === 'candidate') {
      if (asked.length) {
        const id = askedItem ?? `t${groups.length + 1}`;
        let g = byId.get(id);
        if (!g) {
          g = { itemId: id, topic: askedTopic, qa: [] };
          byId.set(id, g);
          groups.push(g);
        }
        g.qa.push({ question: asked.join('\n'), answer: e.text });
        lastGroup = g;
      } else if (lastGroup) {
        const last = lastGroup.qa[lastGroup.qa.length - 1]!;
        last.answer += `\n${e.text}`;
      }
      asked = [];
    } else if (e.role === 'ai' && e.defense?.kind !== 'closing') {
      asked.push(e.text);
      askedItem = e.defense?.itemId ?? askedItem;
      askedTopic = e.meta?.topic ?? askedTopic;
    }
  }
  return groups;
}

export function median3(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? 0;
}

export function medianScores(runs: DefenseScores[]): DefenseScores {
  return Object.fromEntries(CRITERIA.map((c) => [c, median3(runs.map((r) => r[c])) as Score])) as unknown as DefenseScores;
}

export interface FlagInput {
  passed: boolean | null;
  projectScore: number | null;
  answered: number;
  runTotals: number[];
  employerAsked: number;
  employerAnswered: number;
  /** Баллы по вопросам (для uneven_understanding и расхождения прогонов по вопросу). */
  items?: Pick<DefenseItemVerdict, 'total' | 'passed' | 'agreement'>[];
}

export function computeFlags(i: FlagInput): DefenseFlag[] {
  const flags: DefenseFlag[] = [];
  if (i.projectScore === null) flags.push('no_project_result');
  else if (i.projectScore >= VERDICT_RULES.strongProjectScore && i.passed === false) flags.push('strong_project_weak_defense');
  if (i.answered < VERDICT_RULES.minAnswers) flags.push('short_defense');
  const runSpread = i.runTotals.length > 1 ? Math.max(...i.runTotals) - Math.min(...i.runTotals) : 0;
  const itemSplit = (i.items ?? []).some((x) => x.agreement.of > 1 && x.agreement.same / x.agreement.of < VERDICT_RULES.minAgreement);
  if (runSpread >= VERDICT_RULES.disagreementSpread || itemSplit) flags.push('evaluator_disagreement');
  if (i.employerAsked > i.employerAnswered) flags.push('employer_questions_unanswered');
  const items = i.items ?? [];
  if (items.length >= 2) {
    const totals = items.map((x) => x.total);
    const sp = Math.max(...totals) - Math.min(...totals);
    if (sp >= VERDICT_RULES.unevenSpread || (sp >= VERDICT_RULES.unevenSpread - 1 && Math.min(...totals) <= VERDICT_RULES.lowItemTotal)) flags.push('uneven_understanding');
  }
  return flags;
}

const FLAG_TEXT: Record<DefenseFlag, string> = {
  strong_project_weak_defense:
    'Проект прошёл автопроверку хорошо, а на защите кандидат объяснил свой код слабее порога. Это повод поговорить, а не вывод о подлинности: посмотрите транскрипт или задайте свои вопросы.',
  short_defense: 'Ответов мало - оценка неустойчива.',
  evaluator_disagreement: 'Прогоны оценщика заметно разошлись - лучше прочитать транскрипт.',
  employer_questions_unanswered: 'Не на все вопросы работодателя есть ответ - они остаются в очереди до следующего входа кандидата.',
  no_project_result: 'Результата автопроверки проекта нет - сравнить проект и защиту нельзя.',
  uneven_understanding: 'Понимание неровное: одни части кода кандидат объясняет заметно лучше других - посмотрите баллы по вопросам.',
};

const fmt1 = (x: number) => x.toFixed(1).replace('.', ',');

export function buildSummary(v: Pick<DefenseRoomVerdict, 'total' | 'passed' | 'flags' | 'projectScore' | 'answered'> & { totalMean?: number | null; items?: DefenseItemVerdict[] }): string {
  const exact = v.totalMean ?? v.total;
  const head =
    v.total === null || exact === null
      ? 'Оценки нет: кандидат не ответил ни на один вопрос.'
      : `Защита по рубрике A-02: ${fmt1(exact)} из 8 в среднем по ${v.items?.length ?? 0} вопросам - ${v.passed ? 'понимание своего кода показано' : 'ниже порога (≥ 5, «почему так» ≥ 1, не больше одного нуля)'}.`;
  const map = v.items?.length ? `По вопросам: ${v.items.map((i) => `${i.label} - ${i.total}`).join('; ')}.` : '';
  const project = v.projectScore === null ? '' : `Автопроверка проекта: ${Math.round(v.projectScore * 100)}% скрытых тестов.`;
  const flags = v.flags.map((f) => `• ${FLAG_TEXT[f]}`);
  const tail = 'Защита проверяет понимание кода сейчас, а не авторство; автоматического решения о кандидате платформа не принимает.';
  return [head, map, project, ...flags, tail].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Оценщик по вопросам
// ---------------------------------------------------------------------------
const ScoreSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
// Цитата → обоснование → балл: модель сначала находит опору, потом ставит число.
const CriterionSchema = z.object({ quote: z.string().max(600), rationale: z.string().max(600), score: ScoreSchema });
export const DefenseItemsOutput = z.object({
  items: z
    .array(z.object({ id: z.string().max(80), depth: CriterionSchema, why: CriterionSchema, boundary: CriterionSchema, completion: CriterionSchema }))
    .max(16),
});
export type DefenseItemsOutput = z.infer<typeof DefenseItemsOutput>;
const ITEMS_JSON_SCHEMA = responseJsonSchema(DefenseItemsOutput) as object;

/** Что видит оценщик: название проекта и вопросы с ответами; тип вопроса и место в коде — только подписи. */
export interface DefenseEvaluatorPayload {
  kind: 'defense';
  project: string;
  items: { id: string; kind: string; where: string | null; qa: { question: string; answer: string }[] }[];
}

interface EvalItem {
  itemId: string;
  source: 'qlc' | 'employer';
  type: QlcType | 'employer';
  ref: string | null;
  label: string;
  question: string;
  qa: { question: string; answer: string }[];
}

/** Вопросы с ответами → пункты оценки (подписи из плана; без плана — из meta реплики). */
export function evalItems(transcript: TranscriptEntry[], plan: readonly PlanItem[] = []): EvalItem[] {
  return itemTurns(transcript).map((g) => {
    const p = plan.find((x) => x.id === g.itemId);
    const source = p?.source ?? (g.topic.startsWith('вопрос работодателя') ? 'employer' : 'qlc');
    const type: QlcType | 'employer' = p ? (p.source === 'employer' ? 'employer' : p.type) : source === 'employer' ? 'employer' : ((g.topic.split(' · ')[0] as QlcType) in QLC_LABEL ? (g.topic.split(' · ')[0] as QlcType) : 'what');
    const ref = p?.source === 'qlc' ? p.ref : p ? null : (g.topic.split(' · ')[1] ?? null);
    const where = p?.source === 'employer' ? p.companyName : ref;
    return {
      itemId: g.itemId,
      source,
      type,
      ref,
      label: where ? `${QLC_LABEL[type]} · ${where}` : QLC_LABEL[type],
      question: p?.question ?? g.qa[0]?.question ?? '',
      qa: g.qa.map((x) => ({ question: x.question, answer: x.answer.trim() === '' || x.answer === '(молчание)' ? '(кандидат не ответил)' : x.answer })),
    };
  });
}

export function buildItemsPayload(projectTitle: string, items: readonly EvalItem[]): DefenseEvaluatorPayload {
  return {
    kind: 'defense',
    project: projectTitle,
    items: items.map((i) => ({ id: i.itemId, kind: QLC_LABEL[i.type], where: i.source === 'qlc' ? i.ref : null, qa: i.qa })),
  };
}

interface RunCriterion {
  score: Score;
  quote: string;
  valid: boolean;
}
type RunItem = Record<(typeof CRITERIA)[number], RunCriterion>;

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

/** Один прогон по всем вопросам: вызов + один ремонт при невалидном JSON; цитаты проверяются по ответам этого вопроса. */
async function oneItemsRun(payload: DefenseEvaluatorPayload, items: readonly EvalItem[], llm: LlmProvider, signal?: AbortSignal): Promise<RunItem[]> {
  const system = loadRoomPrompt('evaluator');
  const messages: ChatMessage[] = [{ role: 'user', content: `${contextBlock(payload)}\n\nОцени каждый вопрос по рубрике. Ответ — только JSON по схеме.` }];
  let parsed: DefenseItemsOutput | undefined;
  let lastError = '';
  for (let i = 0; i < 2 && !parsed; i++) {
    const msgs: ChatMessage[] =
      i === 0 ? messages : [...messages, { role: 'user', content: `Предыдущий ответ не прошёл проверку схемы: ${lastError.slice(0, 400)}. Верни только JSON строго по схеме.` }];
    const res = await llm.complete(
      { purpose: 'call_evaluator', system, messages: msgs, schema: { name: 'defense_items_evaluation', jsonSchema: ITEMS_JSON_SCHEMA }, temperature: 0, maxTokens: 3500 },
      signal,
    );
    const r = DefenseItemsOutput.safeParse(res.kind === 'json' ? res.json : tryParse(res.text));
    if (r.success) parsed = r.data;
    else lastError = r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ');
  }
  if (!parsed) throw new LlmError('invalid_output', `Оценщик защиты вернул невалидный ответ: ${lastError.slice(0, 300)}`);
  const out = parsed;
  return items.map((it, idx) => {
    const row = out.items.find((x) => x.id.trim() === it.itemId) ?? out.items[idx];
    const answers = it.qa.map((p) => p.answer);
    return Object.fromEntries(
      CRITERIA.map((c) => {
        const cr = row?.[c];
        if (!cr) return [c, { score: 0, quote: '', valid: false }];
        const valid = checkQuoteLoose(cr.quote, answers).valid;
        return [c, { score: (valid ? cr.score : 0) as Score, quote: cr.quote, valid }];
      }),
    ) as RunItem;
  });
}

const scoresOf = (r: RunItem): DefenseScores => Object.fromEntries(CRITERIA.map((c) => [c, r[c].score])) as unknown as DefenseScores;
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Добавочные прогоны: по какому-то вопросу разброс суммы > extraRunsSpread или прогоны разошлись в решении порога. */
export function itemsNeedExtraRuns(runs: readonly RunItem[][]): boolean {
  if (runs.length < 2) return false;
  const n = runs[0]?.length ?? 0;
  for (let i = 0; i < n; i++) {
    const per = runs.map((r) => scoresOf(r[i]!));
    const totals = per.map(scoreTotal);
    if (Math.max(...totals) - Math.min(...totals) > VERDICT_RULES.extraRunsSpread) return true;
    if (new Set(per.map((p) => decidePassed(p))).size > 1) return true;
  }
  return false;
}

/** Сведение прогонов: медиана по признаку внутри вопроса; общий балл — среднее по вопросам. */
export function aggregateItems(items: readonly EvalItem[], runs: readonly RunItem[][]): { items: DefenseItemVerdict[]; scores: DefenseScores; totalMean: number; runTotals: number[] } {
  const out: DefenseItemVerdict[] = items.map((it, i) => {
    const per = runs.map((r) => r[i]!);
    const runScores = per.map(scoresOf);
    const scores = medianScores(runScores);
    const passed = decidePassed(scores);
    const quoteRun = per.find((p) => p.depth.valid && p.depth.score === scores.depth);
    const anyValid = per.flatMap((p) => CRITERIA.map((c) => p[c])).find((x) => x.valid && x.score > 0);
    return {
      itemId: it.itemId,
      source: it.source,
      type: it.type,
      ref: it.ref,
      label: it.label,
      question: it.question,
      scores,
      total: scoreTotal(scores),
      passed,
      runs: runScores.map(scoreTotal),
      agreement: { same: runScores.filter((r) => decidePassed(r) === passed).length, of: runScores.length },
      answers: it.qa.length,
      quote: (quoteRun?.depth.quote ?? anyValid?.quote ?? '').trim(),
    };
  });
  const scores = Object.fromEntries(CRITERIA.map((c) => [c, Math.round(mean(out.map((x) => x.scores[c]))) as Score])) as unknown as DefenseScores;
  const totalMean = round1(mean(out.map((x) => x.total)));
  const runTotals = runs.map((r) => round1(mean(r.map((x) => scoreTotal(scoresOf(x))))));
  return { items: out, scores, totalMean, runTotals };
}

/** Порог общего балла: среднее по вопросам ≥ minTotal, «почему так» ≥ minWhy, нулей по признакам ≤ maxZeros. */
export function decideOverall(scores: DefenseScores, totalMean: number): boolean {
  const zeros = CRITERIA.filter((c) => scores[c] === 0).length;
  return totalMean >= THRESHOLD.minTotal && scores.why >= THRESHOLD.minWhy && zeros <= THRESHOLD.maxZeros;
}

export interface VerdictInput {
  projectTitle: string;
  transcript: TranscriptEntry[];
  /** Пункты плана — подписи вопросов (тип, файл); без плана — из meta реплик. */
  plan?: readonly PlanItem[];
  projectScore: number | null;
  employerAsked: number;
  employerAnswered: number;
}

export async function evaluateDefenseRoom(input: VerdictInput, llm: LlmProvider, runs = VERDICT_RUNS): Promise<DefenseRoomVerdict> {
  const items = evalItems(input.transcript, input.plan ?? []);
  const answered = items.reduce((s, i) => s + i.qa.length, 0);
  const now = new Date().toISOString();
  const thresholdVersion = `${THRESHOLD.version}+${VERDICT_RULES.version}`;
  if (items.length === 0) {
    const flags = computeFlags({ passed: null, projectScore: input.projectScore, answered: 0, runTotals: [], employerAsked: input.employerAsked, employerAnswered: input.employerAnswered });
    const base = { total: null, totalMean: null, passed: null, flags, projectScore: input.projectScore, answered: 0 };
    return {
      ...base,
      scores: null,
      items: [],
      runs: [],
      summary: buildSummary(base),
      quotes: [],
      employerQuestions: { asked: input.employerAsked, answered: input.employerAnswered },
      thresholdVersion,
      evaluatedAt: now,
    };
  }
  const payload = buildItemsPayload(input.projectTitle, items);
  const batch = (n: number) => Promise.allSettled(Array.from({ length: n }, () => oneItemsRun(payload, items, llm)));
  let ok = (await batch(runs)).flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  if (ok.length === 0) {
    throw new AppError('llm_unavailable', 'Оценщик сейчас недоступен. Транскрипт сохранён - повтори завершение, чтобы получить оценку.', 503);
  }
  if (itemsNeedExtraRuns(ok)) ok = [...ok, ...(await batch(VERDICT_EXTRA_RUNS)).flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))];
  const agg = aggregateItems(items, ok);
  const total = Math.round(agg.totalMean);
  const passed = decideOverall(agg.scores, agg.totalMean);
  const flags = computeFlags({
    passed,
    projectScore: input.projectScore,
    answered,
    runTotals: agg.runTotals,
    employerAsked: input.employerAsked,
    employerAnswered: input.employerAnswered,
    items: agg.items,
  });
  const base = { total, totalMean: agg.totalMean, passed, flags, projectScore: input.projectScore, answered, items: agg.items };
  return {
    ...base,
    scores: agg.scores,
    runs: agg.runTotals,
    summary: buildSummary(base),
    quotes: agg.items.map((i) => i.quote).filter(Boolean),
    employerQuestions: { asked: input.employerAsked, answered: input.employerAnswered },
    thresholdVersion,
    evaluatedAt: now,
  };
}
