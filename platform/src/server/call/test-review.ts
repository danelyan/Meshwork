// Связь теста и созвона (11.10): текстовый тест от нейросети защитить нельзя (docs/research/competitors/anti-ai.md,
// раздел 5), поэтому в конце квалифицирующего созвона интервьюер просит объяснить 1–2 задания, которые кандидат
// решал в тесте. Выбор заданий и состояние этапа – чистые функции; чтение попытки из БД – loadTestReview.
// Результат – сигнал testOwnership в вердикте (не меняет категорию; «объяснил сам» снимает понижение категории при индексе high – employer/integrity-ranking.ts).
import { checkQuoteLoose } from '../defense/evaluator';
import { prisma } from '../db';
import { responseJsonSchema } from '../llm/schema';
import type { ChatMessage, LlmProvider } from '../llm/types';
import { GRADE_CUT } from '../test/policy';
import { rankingHoldOf } from '../test/ranking-hold';
import type { Grade } from '../../lib/grades';
import { INTERVIEWER_TIMEOUT_MS, withRefusal } from './plan';
import { contextBlock, loadCallPrompt } from './prompt-utils';
import { CallOwnershipOutput, CallReviewQuestionOutput } from './schemas';
import { OWNERSHIP_LABEL, type TestOwnership, type TestOwnershipStatus, type TranscriptEntry } from './types';

/** Сколько реплик ИИ добавляет этап: объяснить ход решения + один вопрос на изменение условия. */
export const REVIEW_QUESTIONS = 2;
const PROMPT_CHARS = 500;
const CODE_CHARS = 600;

/** Задание теста для разбора: условие коротко, ответ кандидата, верно ли, эталон (эталон – только модели). */
export interface ReviewItem {
  /** Попытка, из которой взято задание: вердикт хранит её id, чтобы разбор не приписали другой попытке с теми же шаблонами. */
  attemptId?: string;
  templateId: string;
  title: string;
  catalogIds: string[];
  prompt: string;
  code: string | null;
  candidateAnswer: string;
  correct: boolean;
  answerKey: string;
  explanation: string;
}

/** Ответ на задание теста, как он хранится в TestItem + шаблон. */
export interface AnsweredRow {
  index: number;
  templateId: string;
  title: string;
  catalogIds: string[];
  irtB: number;
  prompt: string;
  code: string | null;
  answer: string | null;
  correct: boolean | null;
  answerKey: string;
  explanation: string;
}

const clip = (t: string, n: number) => {
  const s = t.trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/**
 * Детерминированный выбор ≤ 2 заданий. Первое – верно решённое, ближайшее по сложности (b) к порогу заявленного
 * грейда (самое показательное: «почему именно так»); нет верных – ближайшее к порогу из решённых неверно.
 * Второе – любое другое: сначала неверное (объяснить свою ошибку), затем верное; снова ближайшее к порогу.
 * Ничья – по порядку показа. Без ответов – пустой список.
 */
export function pickReviewItems(rows: readonly AnsweredRow[], grade: Grade): ReviewItem[] {
  const cut = GRADE_CUT[grade];
  const answered = rows.filter((r) => r.answer !== null && r.correct !== null);
  const byCut = (a: AnsweredRow, b: AnsweredRow) => Math.abs(a.irtB - cut) - Math.abs(b.irtB - cut) || a.index - b.index;
  const right = answered.filter((r) => r.correct).sort(byCut);
  const wrong = answered.filter((r) => !r.correct).sort(byCut);
  const first = right[0] ?? wrong[0];
  if (!first) return [];
  const second = (wrong.find((r) => r !== first) ?? right.find((r) => r !== first)) as AnsweredRow | undefined;
  return [first, ...(second ? [second] : [])].map((r) => ({
    templateId: r.templateId,
    title: r.title,
    catalogIds: r.catalogIds,
    prompt: clip(r.prompt, PROMPT_CHARS),
    code: r.code ? clip(r.code, CODE_CHARS) : null,
    candidateAnswer: clip(r.answer ?? '', 200),
    correct: Boolean(r.correct),
    answerKey: clip(r.answerKey, 200),
    explanation: clip(r.explanation, 400),
  }));
}

/** Задания последней завершённой попытки теста по той же подкатегории; нет попытки – []. */
export async function loadTestReview(candidateId: string, specialization: string, subcategoryId: string | null): Promise<ReviewItem[]> {
  const scope = { candidateId, specialization: specialization as never, ...(subcategoryId ? { subcategoryId } : {}) };
  // Если категория не учитывается в выдаче из-за индекса (test/ranking-hold.ts), разбираем именно ту попытку, которая
  // её держит: «объяснил сам» снимает ограничение только по ней, а последней завершённой может оказаться проваленная
  // подтверждающая попытка (Codex-ревью 11.10). Иначе – последняя завершённая попытка.
  const hold = await rankingHoldOf(candidateId);
  const held = hold ? await prisma.testAttempt.findFirst({ where: { ...scope, id: hold.attemptId }, select: { id: true, grade: true } }) : null;
  const attempt =
    held ??
    (await prisma.testAttempt.findFirst({
      where: { ...scope, status: { in: ['passed', 'not_confirmed'] } },
      orderBy: [{ finishedAt: { sort: 'desc', nulls: 'last' } }, { startedAt: 'desc' }],
      select: { id: true, grade: true },
    }));
  if (!attempt) return [];
  const items = await prisma.testItem.findMany({
    where: { attemptId: attempt.id, answer: { not: null } },
    orderBy: { index: 'asc' },
    select: {
      index: true,
      templateId: true,
      prompt: true,
      code: true,
      answer: true,
      correct: true,
      answerKey: true,
      explanation: true,
      template: { select: { title: true, irtB: true, catalogIds: true } },
    },
  });
  return pickReviewItems(
    items.map((i) => ({ ...i, title: i.template.title, irtB: i.template.irtB, catalogIds: i.template.catalogIds })),
    attempt.grade as Grade,
  ).map((r) => ({ ...r, attemptId: attempt.id }));
}

// ---------------------------------------------------------------------------
// Состояние этапа по транскрипту
// ---------------------------------------------------------------------------
/** Сколько вопросов этапа уже задано и есть ли ответ хотя бы на один. */
export function reviewState(transcript: readonly TranscriptEntry[]): { asked: number; answered: number } {
  let asked = 0;
  let answered = 0;
  let open = false;
  for (const e of transcript) {
    if (e.role === 'ai') {
      open = Boolean(e.meta?.testReview);
      if (open) asked++;
    } else if (e.role === 'candidate' && open) {
      answered++;
      open = false;
    }
  }
  return { asked, answered };
}

/**
 * Какой шаг этапа задавать сейчас: шаг 1 – только когда обычные вопросы закончились (allowStart), шаг 2 – сразу
 * после ответа на шаг 1; null – этап пройден или шаг ещё не наступил. Общая логика видов qualifying и interview.
 */
export function reviewStepDue(transcript: readonly TranscriptEntry[], allowStart: boolean): 1 | 2 | null {
  const st = reviewState(transcript);
  if (st.asked >= REVIEW_QUESTIONS) return null;
  if (st.asked === 0) return allowStart ? 1 : null;
  return st.answered >= st.asked ? ((st.asked + 1) as 1 | 2) : null;
}

/** Сколько реплик ИИ этапа ещё впереди (0 – этапа нет или он пройден). */
export function reviewRemaining(items: readonly ReviewItem[], transcript: readonly TranscriptEntry[]): number {
  return items.length === 0 ? 0 : Math.max(0, REVIEW_QUESTIONS - reviewState(transcript).asked);
}

/** Пары вопрос-ответ этапа, по порядку. */
export function reviewDialog(transcript: readonly TranscriptEntry[]): { question: string; answer: string | null }[] {
  const out: { question: string; answer: string | null }[] = [];
  let cur: { question: string; answer: string | null } | null = null;
  for (const e of transcript) {
    if (e.role === 'ai') {
      cur = e.meta?.testReview ? { question: e.text, answer: null } : null;
      if (cur) out.push(cur);
    } else if (e.role === 'candidate' && cur) {
      cur.answer = cur.answer === null ? e.text : `${cur.answer}\n${e.text}`;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Вопросы интервьюера
// ---------------------------------------------------------------------------
export interface ReviewPayload {
  kind: 'test_review';
  step: 1 | 2;
  items: Pick<ReviewItem, 'title' | 'prompt' | 'code' | 'candidateAnswer' | 'correct' | 'answerKey'>[];
  dialog: { question: string; answer: string | null }[];
}

const toPayloadItem = (i: ReviewItem) => ({ title: i.title, prompt: i.prompt, code: i.code, candidateAnswer: i.candidateAnswer, correct: i.correct, answerKey: i.answerKey });

/** Запасной вопрос без модели. */
export function templateReviewQuestion(item: ReviewItem, step: 1 | 2): string {
  return step === 1
    ? `Теперь вернёмся к заданию из теста «${item.title}». Расскажи своими словами, как ты его решал и почему получился именно твой ответ.`
    : 'А что изменилось бы в твоём ответе, если в условии поменять одно число или одно условие? Покажи, как бы пересчитал.';
}

const firstSentence = (t: string) => (/^[^.!?]*[.!?]/.exec(t.trim())?.[0] ?? '').trim();

/**
 * Шаг 2 не повторяет вступление шага 1 («Теперь вернёмся к тесту.»): модель иногда копирует связку (живая отладка
 * 11.10). Первое предложение срезается, если оно совпадает с первым предложением шага 1 и после него есть вопрос.
 */
export function dropRepeatedLead(question: string, stepOne: string): string {
  const lead = firstSentence(question);
  if (!lead || lead.length > 60 || lead.toLowerCase() !== firstSentence(stepOne).toLowerCase()) return question;
  const rest = question.slice(question.indexOf(lead) + lead.length).trim();
  return rest.length >= 15 ? rest.charAt(0).toUpperCase() + rest.slice(1) : question;
}

export async function nextReviewQuestion(
  items: readonly ReviewItem[],
  step: 1 | 2,
  dialog: ReviewPayload['dialog'],
  llm: LlmProvider,
  signal?: AbortSignal,
): Promise<{ question: string; fallback: boolean }> {
  const main = items[0]!;
  const lastAnswer = dialog[dialog.length - 1]?.answer ?? null;
  const refuse = (q: string) => withRefusal(q, lastAnswer, 'Подсказать не могу, мне важно твоё рассуждение.');
  const payload: ReviewPayload = { kind: 'test_review', step, items: items.map(toPayloadItem), dialog };
  try {
    const res = await llm.complete(
      {
        purpose: 'call_interviewer', timeoutMs: INTERVIEWER_TIMEOUT_MS,
        system: loadCallPrompt('test-review'),
        messages: [{ role: 'user', content: `${contextBlock(payload)}\n\nЗадай вопрос этапа, шаг ${step}. Ответ – только JSON по схеме.` }],
        schema: { name: 'call_review_question', jsonSchema: responseJsonSchema(CallReviewQuestionOutput) as object },
        temperature: 0.4,
        maxTokens: 300,
      },
      signal,
    );
    const parsed = CallReviewQuestionOutput.safeParse(res.kind === 'json' ? res.json : undefined);
    if (parsed.success) {
      const q = step === 2 ? dropRepeatedLead(parsed.data.question.trim(), dialog[0]?.question ?? '') : parsed.data.question.trim();
      const leaksKey = main.answerKey.length >= 5 && q.includes(main.answerKey);
      if (/[а-яё]/i.test(q) && q.length <= 400 && !leaksKey) return { question: refuse(q), fallback: false };
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('[call] test-review fallback:', err instanceof Error ? err.message : err);
  }
  return { question: refuse(templateReviewQuestion(main, step)), fallback: true };
}

// ---------------------------------------------------------------------------
// Оценка «решил сам»
// ---------------------------------------------------------------------------
export interface OwnershipPayload {
  kind: 'ownership';
  items: ReviewPayload['items'];
  explanations: { title: string; explanation: string }[];
  dialog: ReviewPayload['dialog'];
}

/** id разобранной попытки – в вердикт: по нему employer/integrity-ranking.ts привязывает созвон, шаблоны – запасной путь для старых вердиктов. */
const reviewedAttempt = (items: readonly ReviewItem[]): { attemptId?: string } => (items[0]?.attemptId ? { attemptId: items[0].attemptId } : {});
const NOT_CHECKED = (items: ReviewItem[], reason: string): TestOwnership => ({ status: 'not_checked', reason, ...reviewedAttempt(items), items: items.map((i) => ({ templateId: i.templateId, title: i.title, correct: i.correct })) });

/**
 * Один прогон оценщика (temperature 0). «Объяснил» без дословной цитаты кандидата понижается до «частично»:
 * модель не может засчитать объяснение, которого нет в ответах. Сбой LLM → not_checked, созвон не падает.
 */
export async function evaluateOwnership(items: readonly ReviewItem[], dialog: ReviewPayload['dialog'], llm: LlmProvider, signal?: AbortSignal): Promise<TestOwnership> {
  const list = [...items];
  const answers = dialog.map((d) => d.answer).filter((a): a is string => a !== null && a.trim() !== '');
  if (list.length === 0) return NOT_CHECKED(list, 'В тесте нет решённых заданий.');
  if (dialog.length === 0) return NOT_CHECKED(list, 'Этап разбора задания теста не проводился.');
  if (answers.length === 0) return NOT_CHECKED(list, 'Кандидат не ответил на вопросы о задании теста.');
  const payload: OwnershipPayload = {
    kind: 'ownership',
    items: list.map(toPayloadItem),
    explanations: list.map((i) => ({ title: i.title, explanation: i.explanation })),
    dialog: dialog.map((d) => ({ question: d.question, answer: d.answer ?? '(кандидат не ответил)' })),
  };
  const messages: ChatMessage[] = [{ role: 'user', content: `${contextBlock(payload)}\n\nОцени, объяснил ли кандидат решение сам. Ответ – только JSON по схеме.` }];
  try {
    const res = await llm.complete(
      {
        purpose: 'call_evaluator',
        system: loadCallPrompt('ownership'),
        messages,
        schema: { name: 'call_ownership', jsonSchema: responseJsonSchema(CallOwnershipOutput) as object },
        temperature: 0,
        maxTokens: 600,
      },
      signal,
    );
    const parsed = CallOwnershipOutput.safeParse(res.kind === 'json' ? res.json : undefined);
    if (!parsed.success) return NOT_CHECKED(list, 'Оценщик вернул невалидный ответ.');
    let status: TestOwnershipStatus = parsed.data.status;
    if (status === 'explained' && !checkQuoteLoose(parsed.data.quote, answers).valid) status = 'partial';
    return { status, reason: parsed.data.reason.trim().slice(0, 240), ...reviewedAttempt(list), items: list.map((i) => ({ templateId: i.templateId, title: i.title, correct: i.correct })) };
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('[call] ownership evaluator failed:', err instanceof Error ? err.message : err);
    return NOT_CHECKED(list, 'Оценка недоступна.');
  }
}

/** Фраза для итога созвона; пусто, если этапа не было. */
export function ownershipSentence(o: TestOwnership | undefined): string {
  return o && o.status !== 'not_checked' ? ` Решения теста: ${OWNERSHIP_LABEL[o.status]}.` : '';
}
