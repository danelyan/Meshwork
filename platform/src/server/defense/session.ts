import type { Prisma } from '@prisma/client';

import { PLATFORM_UPGRADABLE } from '../claims/levels';
import type { EvidenceLevel } from '../claims/types';
import { prisma } from '../db';
import { assertAiAssessmentConsent } from '../consent/service';
import { AppError, errors } from '../errors';
import type { LlmProvider } from '../llm/types';
import { buildExplanation, decidePassed, EVALUATOR_PROMPT_VERSION, evaluateDefense, scoreTotal, THRESHOLD } from './evaluator';
import { nextQuestion, type InterviewerContext } from './interviewer';
import type {
  AnswerResult,
  DefenseLimits,
  DefenseQuestion,
  DefenseSessionView,
  DefenseVerdict,
} from './types';

/**
 * Защита утверждения коротким текстовым интервью (фаза 5 E-01).
 * Единственный путь, кроме задания, поднять уровень утверждения до `platform`.
 * Уровень меняет только `finishWithVerdict` — после вердикта оценщика и порога в коде.
 */

export const DEFENSE_LIMITS: DefenseLimits = {
  minQuestions: 3,
  maxQuestions: 5,
  maxAnswerChars: 4000,
  // ПРЕДЛОЖЕНИЕ: 2 попытки на утверждение за 30 дней (ADR-0001 «потолок попыток» открыт).
  maxAttemptsPerWindow: 2,
  windowDays: 30,
};

export const DEFENSE_DISCLAIMER =
  'Защита проверяет, понимаешь ли ты то, что утверждаешь, сейчас. Она не доказывает, что история из резюме подлинная. Грамотность, стиль и акцент не оцениваются.';

const ELIGIBLE_STATUSES = new Set(['confirmed', 'edited']);

type ClaimRow = {
  id: string;
  candidateId: string;
  statement: string;
  level: EvidenceLevel;
  status: string;
  quote: string;
  sourceRef: string;
  limits: string;
  catalog: { statement: string; limits: string };
};

const claimSelect = {
  id: true,
  candidateId: true,
  statement: true,
  level: true,
  status: true,
  quote: true,
  sourceRef: true,
  limits: true,
  catalog: { select: { statement: true, limits: true } },
} as const;

function assertEligible(claim: Pick<ClaimRow, 'status' | 'level'>): void {
  if (!ELIGIBLE_STATUSES.has(claim.status)) {
    throw new AppError(
      'claim_not_eligible',
      'Защищать можно только подтверждённое тобой утверждение (подтверди или отредактируй его в профиле).',
      409,
    );
  }
  if (!PLATFORM_UPGRADABLE.has(claim.level)) {
    throw new AppError('claim_already_verified', 'Утверждение уже проверено платформой.', 409);
  }
}

function windowStart(now: Date): Date {
  return new Date(now.getTime() - DEFENSE_LIMITS.windowDays * 24 * 60 * 60 * 1000);
}

function attemptsExhausted(recent: { createdAt: Date }[], now: Date): AppError {
  const oldest = recent.reduce((m, s) => (s.createdAt < m ? s.createdAt : m), now);
  const nextAt = new Date(oldest.getTime() + DEFENSE_LIMITS.windowDays * 24 * 60 * 60 * 1000);
  return new AppError(
    'defense_attempts_exhausted',
    `Не больше ${DEFENSE_LIMITS.maxAttemptsPerWindow} попыток защиты утверждения за ${DEFENSE_LIMITS.windowDays} дней.`,
    429,
    { nextAttemptAt: nextAt.toISOString() },
  );
}

function interviewerContext(claim: ClaimRow, turns: { question: string; answer: string | null }[]): InterviewerContext {
  return {
    claimStatement: claim.statement,
    catalogStatement: claim.catalog.statement,
    quote: claim.quote,
    sourceRef: claim.sourceRef,
    limits: [claim.limits, claim.catalog.limits].filter((x, i, a) => x && a.indexOf(x) === i).join(' '),
    turns,
  };
}

/** Блокировка строки утверждения до конца транзакции: старт и финал сессий по нему идут по очереди. */
async function lockClaim(tx: Prisma.TransactionClient, claimId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Claim" WHERE id = ${claimId} FOR UPDATE`;
}

// ---------------------------------------------------------------------------
// Старт
// ---------------------------------------------------------------------------
export async function startDefense(
  candidateId: string,
  claimId: string,
  llm: LlmProvider,
): Promise<{ sessionId: string; question: DefenseQuestion; resumed: boolean }> {
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, select: claimSelect });
  // Чужое утверждение — 404, не раскрываем, что оно существует.
  if (!claim || claim.candidateId !== candidateId) throw errors.notFound('Утверждение не найдено');
  assertEligible(claim);
  await assertAiAssessmentConsent(candidateId); // Г3 (ADR 0005): защиту оценивает ИИ

  const existing = await resumeActive(candidateId, claimId);
  if (existing) return existing;

  const now = new Date();
  const recent = await prisma.defenseSession.findMany({
    where: { claimId, createdAt: { gte: windowStart(now) } },
    select: { createdAt: true },
  });
  if (recent.length >= DEFENSE_LIMITS.maxAttemptsPerWindow) throw attemptsExhausted(recent, now);

  // Вопрос генерируется вне транзакции (LLM медленная); проверки повторяются под блокировкой.
  const first = await nextQuestion(interviewerContext(claim, []), llm);

  const created = await prisma.$transaction(async (tx) => {
    await lockClaim(tx, claimId);
    const fresh = await tx.claim.findUnique({ where: { id: claimId }, select: { status: true, level: true } });
    if (!fresh) throw errors.notFound('Утверждение не найдено');
    assertEligible(fresh);
    const active = await tx.defenseSession.findFirst({
      where: { claimId, candidateId, status: 'active' },
      select: { id: true },
    });
    if (active) return { resumedId: active.id } as const;
    const recentTx = await tx.defenseSession.findMany({
      where: { claimId, createdAt: { gte: windowStart(new Date()) } },
      select: { createdAt: true },
    });
    if (recentTx.length >= DEFENSE_LIMITS.maxAttemptsPerWindow) throw attemptsExhausted(recentTx, new Date());
    const s = await tx.defenseSession.create({
      data: { claimId, candidateId, status: 'active', turns: { create: { index: 0, question: first.question } } },
      select: { id: true },
    });
    return { sessionId: s.id } as const;
  });

  if ('resumedId' in created) {
    const r = await resumeActive(candidateId, claimId);
    if (r) return r;
    throw errors.conflict('Сессия защиты изменилась, повтори запрос');
  }
  return { sessionId: created.sessionId, question: { index: 0, question: first.question }, resumed: false };
}

/** Активная сессия по утверждению → продолжаем её (одна активная на утверждение). */
async function resumeActive(
  candidateId: string,
  claimId: string,
): Promise<{ sessionId: string; question: DefenseQuestion; resumed: boolean } | null> {
  const active = await prisma.defenseSession.findFirst({
    where: { claimId, candidateId, status: 'active' },
    select: { id: true, turns: { orderBy: { index: 'asc' }, select: { index: true, question: true, answer: true } } },
  });
  if (!active) return null;
  const pending = active.turns.find((t) => t.answer === null) ?? active.turns[active.turns.length - 1];
  if (!pending) return null;
  return { sessionId: active.id, question: { index: pending.index, question: pending.question }, resumed: true };
}

// ---------------------------------------------------------------------------
// Ответ
// ---------------------------------------------------------------------------
export function normalizeAnswer(answer: unknown): string {
  if (typeof answer !== 'string') throw errors.badRequest('Ответ должен быть строкой');
  const text = answer.replace(/\r\n/g, '\n').trim();
  if (text.length > DEFENSE_LIMITS.maxAnswerChars) {
    throw new AppError('answer_too_long', `Ответ длиннее ${DEFENSE_LIMITS.maxAnswerChars} символов`, 400);
  }
  return text;
}

async function loadOwnSession(candidateId: string, sessionId: string) {
  const session = await prisma.defenseSession.findUnique({
    where: { id: sessionId },
    include: {
      claim: { select: claimSelect },
      turns: { orderBy: { index: 'asc' } },
    },
  });
  if (!session || session.candidateId !== candidateId) throw errors.notFound('Сессия защиты не найдена');
  return session;
}

/**
 * Сохраняет ответ на текущий вопрос и возвращает следующий вопрос или вердикт.
 * Пустой ответ и «не знаю» допустимы — оцениваются честно.
 * Если все вопросы отвечены, а вердикта нет (оценщик упал), вызов повторяет
 * оценку; `answer` в этом случае не используется.
 */
export async function answerDefense(
  candidateId: string,
  sessionId: string,
  answer: string,
  llm: LlmProvider,
): Promise<AnswerResult> {
  const text = normalizeAnswer(answer);
  const session = await loadOwnSession(candidateId, sessionId);
  if (session.status !== 'active') throw errors.conflict('Сессия защиты уже завершена');
  await assertAiAssessmentConsent(candidateId); // Г3 (ADR 0005): отзыв посреди сессии останавливает её

  const turns = session.turns.map((t) => ({ index: t.index, question: t.question, answer: t.answer }));
  const pending = turns.find((t) => t.answer === null);
  if (pending) {
    const upd = await prisma.defenseTurn.updateMany({
      where: { id: session.turns.find((t) => t.index === pending.index)!.id, answer: null },
      data: { answer: text },
    });
    if (upd.count !== 1) throw errors.conflict('Ответ на этот вопрос уже принят');
    pending.answer = text;
  }

  const answered = turns.filter((t) => t.answer !== null).length;
  const { minQuestions, maxQuestions } = DEFENSE_LIMITS;

  if (answered >= maxQuestions || (!pending && answered >= minQuestions)) {
    return { verdict: await finishWithVerdict(candidateId, sessionId, llm) };
  }

  const q = await nextQuestion(interviewerContext(session.claim, turns), llm);
  if (answered >= minQuestions && q.enough) {
    return { verdict: await finishWithVerdict(candidateId, sessionId, llm) };
  }
  try {
    await prisma.defenseTurn.create({ data: { sessionId, index: answered, question: q.question } });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw errors.conflict('Следующий вопрос уже задан');
    throw err;
  }
  return { next: { index: answered, question: q.question } };
}

// ---------------------------------------------------------------------------
// Вердикт — единственное место, где меняется уровень утверждения
// ---------------------------------------------------------------------------
async function finishWithVerdict(candidateId: string, sessionId: string, llm: LlmProvider): Promise<DefenseVerdict> {
  const session = await loadOwnSession(candidateId, sessionId);
  if (session.status !== 'active') {
    if (session.verdict) return session.verdict as unknown as DefenseVerdict;
    throw errors.conflict('Сессия защиты уже завершена');
  }
  const answeredTurns = session.turns.filter((t) => t.answer !== null);
  if (answeredTurns.length < DEFENSE_LIMITS.minQuestions) {
    throw errors.conflict('Мало ответов для вердикта');
  }

  let evaluation;
  try {
    evaluation = await evaluateDefense(
      {
        claimStatement: session.claim.statement,
        catalogStatement: session.claim.catalog.statement,
        turns: answeredTurns.map((t) => ({ question: t.question, answer: t.answer ?? '' })),
        redact: [session.claim.quote],
      },
      llm,
    );
  } catch (err) {
    console.warn('[defense] evaluator failed:', err instanceof Error ? err.message : err);
    throw new AppError(
      'llm_unavailable',
      'Оценщик сейчас недоступен. Ответы сохранены - повтори запрос, чтобы получить вердикт.',
      503,
    );
  }

  const passed = decidePassed(evaluation.scores);
  const total = scoreTotal(evaluation.scores);

  return prisma.$transaction(async (tx) => {
    await lockClaim(tx, session.claimId);
    const claim = await tx.claim.findUnique({ where: { id: session.claimId }, select: { level: true, status: true } });
    if (!claim) throw errors.notFound('Утверждение не найдено');
    const canUpgrade = passed && ELIGIBLE_STATUSES.has(claim.status) && PLATFORM_UPGRADABLE.has(claim.level);
    const levelAfter = canUpgrade ? 'platform' : claim.level;
    const now = new Date();
    const verdict: DefenseVerdict = {
      scores: evaluation.scores,
      total,
      passed,
      quotes: evaluation.criteria.filter((c) => c.quoteValid).map((c) => c.quote),
      explanation: buildExplanation(evaluation.criteria, passed, evaluation.advice),
      criteria: evaluation.criteria,
      source: 'interview',
      evaluatedAt: now.toISOString(),
      levelBefore: claim.level,
      levelAfter,
      thresholdVersion: THRESHOLD.version,
      promptVersion: EVALUATOR_PROMPT_VERSION,
    };
    const done = await tx.defenseSession.updateMany({
      where: { id: sessionId, status: 'active' },
      data: { status: 'completed', completedAt: now, verdict: verdict as unknown as Prisma.InputJsonValue },
    });
    if (done.count !== 1) {
      const stored = await tx.defenseSession.findUnique({ where: { id: sessionId }, select: { verdict: true } });
      if (stored?.verdict) return stored.verdict as unknown as DefenseVerdict;
      throw errors.conflict('Сессия защиты уже завершена');
    }
    if (canUpgrade) {
      await tx.claim.update({ where: { id: session.claimId }, data: { level: 'platform' } });
    }
    return verdict;
  });
}

// ---------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------
export async function getDefenseSession(candidateId: string, sessionId: string): Promise<DefenseSessionView> {
  const s = await loadOwnSession(candidateId, sessionId);
  const turns = s.turns.map((t) => ({ index: t.index, question: t.question, answer: t.answer }));
  return {
    id: s.id,
    claimId: s.claimId,
    claimStatement: s.claim.statement,
    status: s.status,
    awaitingAnswer: s.status === 'active' && turns.some((t) => t.answer === null),
    turns,
    verdict: (s.verdict as unknown as DefenseVerdict | null) ?? null,
    limits: DEFENSE_LIMITS,
    createdAt: s.createdAt.toISOString(),
    completedAt: s.completedAt?.toISOString() ?? null,
    disclaimer: DEFENSE_DISCLAIMER,
  };
}
