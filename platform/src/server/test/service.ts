// Сервис теста на грейд (E-03, ADR-0002): попытки, задания, решение о категории.
// Грейд считает только код (IRT + генераторы), LLM не участвует: те же ответы → тот же итог.
import type { Prisma, TestAttempt, TestItem } from '@prisma/client';

import { PLATFORM_UPGRADABLE } from '../claims/levels';
import { prisma } from '../db';
import { getEnv } from '../env';
import { AppError, errors } from '../errors';
import { GRADE_CHANGE_INTERVAL_DAYS } from '../recommend/weights';
import type { Grade, Specialization } from '../types';

import { checkAnswer, MAX_ANSWER_CHARS } from './answers';
import { getSubcategory, specLabel } from '../../lib/directions';

import { GENERATORS, getGenerator, hasTestFor, poolFor, unavailableReason } from './generators';
import { estimateTheta, type Response } from './irt';
import { decide, explainDecision, MAX_ITEMS, MIN_ITEMS, nextStep, phasePool, selectNext, type AttemptPhase, type SelectableTemplate, type Step } from './policy';
import { deriveSeed, randomSeed } from './rng';
import type {
  AnsweredItemView,
  AttemptResult,
  AttemptSummary,
  AttemptView,
  EligibilityView,
  ItemView,
  StartResult,
  TaskGenerator,
} from './types';

/**
 * v2 (10.10): порог Junior −0,7 и дозадавание Junior-заданий при заявке Middle (ADR-0002, дополнения 10.10).
 * v3 (10.10): дозадавание и при заявке Junior (ADR-0002, «Заявка Junior»).
 * v4 (10.10): тест на подкатегорию — пул попытки только из семейств подкатегории кандидата
 * (ADR 0003, дополнение 10.10 15:50; ADR-0002, дополнение «Направления»).
 */
export const POLICY_VERSION = 'adr-0002-v4';
/** Версии с дозадаванием Junior (v3 и новее): правило фазы не меняется задним числом для v1–v2. */
const PROBE_VERSIONS = new Set(['adr-0002-v3', 'adr-0002-v4']);

/**
 * ПРЕДЛОЖЕНИЕ (R-C-09, решение владельца 09.10): смена грейда — раз в 30 дней
 * (GRADE_CHANGE_INTERVAL_DAYS), пересдача того же грейда — через 14 дней.
 * В демо-режиме (TEST_DEMO_INTERVALS=true) — минуты, чтобы жюри увидело правило и повтор.
 */
export const RETAKE_SAME_GRADE_DAYS = 14;
export const DEMO_GRADE_CHANGE_MIN = 2;
export const DEMO_RETAKE_MIN = 1;
/** Незавершённая попытка живёт сутки: вкладку можно закрыть и вернуться (R-C-07). */
export const ATTEMPT_TTL_HOURS = 24;

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;

export interface Intervals {
  demo: boolean;
  gradeChangeMs: number;
  retakeMs: number;
}

export function intervals(demo: boolean = getEnv().TEST_DEMO_INTERVALS): Intervals {
  return demo
    ? { demo, gradeChangeMs: DEMO_GRADE_CHANGE_MIN * MIN_MS, retakeMs: DEMO_RETAKE_MIN * MIN_MS }
    : { demo, gradeChangeMs: GRADE_CHANGE_INTERVAL_DAYS * DAY_MS, retakeMs: RETAKE_SAME_GRADE_DAYS * DAY_MS };
}

export function describeIntervals(iv: Intervals = intervals()): string {
  return iv.demo
    ? `Демо-режим: смена грейда - через ${DEMO_GRADE_CHANGE_MIN} мин, пересдача того же грейда - через ${DEMO_RETAKE_MIN} мин (на проде - ${GRADE_CHANGE_INTERVAL_DAYS} и ${RETAKE_SAME_GRADE_DAYS} дней).`
    : `Смена грейда - не чаще раза в ${GRADE_CHANGE_INTERVAL_DAYS} дней, пересдача того же грейда - через ${RETAKE_SAME_GRADE_DAYS} дней.`;
}

// ---------------------------------------------------------------------------
// Шаблоны: параметры IRT живут в БД (калибровка правит их без деплоя)
// ---------------------------------------------------------------------------

/** Идемпотентно заводит TaskTemplate для всех генераторов кода (сид и первый запуск). */
export async function ensureTemplates(db: Prisma.TransactionClient | typeof prisma = prisma): Promise<void> {
  const existing = new Set((await db.taskTemplate.findMany({ select: { id: true } })).map((t) => t.id));
  for (const g of GENERATORS) {
    if (existing.has(g.id)) continue;
    await db.taskTemplate.create({
      data: { id: g.id, taskId: g.taskId, title: g.title, specialization: g.specialization, grade: g.grade, catalogIds: g.catalogIds, format: g.format, irtA: g.a, irtB: g.b },
    });
  }
}

/**
 * Пул попытки. С подкатегорией — семейства подкатегории (poolFor; переходное направление — всё направление);
 * без неё (попытки до v4) — всё направление, как при их старте.
 */
async function loadPool(spec: Specialization, subcategoryId: string | null): Promise<(SelectableTemplate & { generator: TaskGenerator })[]> {
  await ensureTemplates();
  const ids = subcategoryId ? poolFor(spec, subcategoryId)?.generators.map((g) => g.id) : undefined;
  const rows = await prisma.taskTemplate.findMany({ where: { specialization: spec, ...(ids ? { id: { in: ids } } : {}) }, orderBy: { id: 'asc' } });
  const out: (SelectableTemplate & { generator: TaskGenerator })[] = [];
  for (const r of rows) {
    const generator = getGenerator(r.id);
    if (!generator) continue; // шаблон выведен из кода — из оборота
    out.push({ id: r.id, a: r.irtA, b: r.irtB, catalogIds: r.catalogIds, grade: r.grade, exposure: r.exposure, generator });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Допуск к попытке (R-C-08, R-C-09)
// ---------------------------------------------------------------------------

/** Подкатегория теста: явная (из запроса) или из профиля кандидата; чужая направлению — null. */
async function resolveSubcategory(candidateId: string, spec: Specialization, explicit?: string | null): Promise<string | null> {
  const id = explicit ?? (await prisma.candidate.findUnique({ where: { id: candidateId }, select: { subcategoryId: true } }))?.subcategoryId ?? null;
  return getSubcategory(id)?.specialization === spec ? id : null;
}

/**
 * Допуск к попытке. Тест — на подкатегорию (ADR 0003, дополнение 10.10 15:50): без выбранной подкатегории
 * направления — subcategory_required; подкатегория без банка (< 8 семейств) — no_test. `subcategoryId`
 * не передан — берётся из профиля кандидата.
 */
export async function checkEligibility(
  candidateId: string,
  spec: Specialization,
  grade: Grade,
  now: Date = new Date(),
  subcategoryId?: string | null,
): Promise<EligibilityView> {
  const sub = await resolveSubcategory(candidateId, spec, subcategoryId);
  if (!hasTestFor(spec)) return { allowed: false, code: 'no_test', reason: unavailableReason(spec, null)!, subcategoryId: sub };
  if (!sub) {
    return { allowed: false, code: 'subcategory_required', reason: `Выберите подкатегорию направления ${specLabel(spec)}: тест на грейд идёт по подкатегории.`, subcategoryId: null };
  }
  const reason = unavailableReason(spec, sub);
  if (reason) return { allowed: false, code: 'no_test', reason, subcategoryId: sub };
  const iv = intervals();
  const [category, lastSame] = await Promise.all([
    prisma.candidateCategory.findFirst({ where: { candidateId }, orderBy: { confirmedAt: 'desc' } }),
    prisma.testAttempt.findFirst({
      where: { candidateId, specialization: spec, subcategoryId: sub, grade, status: { in: ['passed', 'not_confirmed'] } },
      orderBy: { finishedAt: 'desc' },
    }),
  ]);
  // Смена грейда (категория есть и целевой грейд другой) — не чаще интервала. Понижение после
  // провала тоже смена: уже подтверждённая категория не снимается, но менять её часто нельзя.
  if (category && category.grade !== grade) {
    const next = new Date(category.confirmedAt.getTime() + iv.gradeChangeMs);
    if (now < next) {
      return { allowed: false, code: 'grade_change_too_soon', nextAllowedAt: next.toISOString(), reason: `Сменить грейд можно с ${next.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}. ${describeIntervals(iv)}` };
    }
  }
  if (lastSame?.finishedAt) {
    const next = new Date(lastSame.finishedAt.getTime() + iv.retakeMs);
    if (now < next) {
      return { allowed: false, code: 'retake_too_soon', nextAllowedAt: next.toISOString(), reason: `Пересдать этот грейд можно с ${next.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}. ${describeIntervals(iv)}` };
    }
  }
  return { allowed: true, subcategoryId: sub };
}

// ---------------------------------------------------------------------------
// Попытка
// ---------------------------------------------------------------------------

type AttemptWithItems = TestAttempt & { items: TestItem[] };

async function loadAttempt(candidateId: string, attemptId: string): Promise<AttemptWithItems> {
  const a = await prisma.testAttempt.findFirst({ where: { id: attemptId, candidateId }, include: { items: { orderBy: { index: 'asc' } } } });
  if (!a) throw errors.notFound('Попытка не найдена');
  return a;
}

function responsesOf(items: TestItem[], pool: Map<string, SelectableTemplate>): Response[] {
  const out: Response[] = [];
  for (const it of items) {
    if (it.correct === null) continue;
    const t = pool.get(it.templateId);
    if (!t) continue;
    out.push({ a: t.a, b: t.b, correct: it.correct });
  }
  return out;
}

/**
 * Решение о продолжении по отвеченным заданиям попытки (фаза выводится из ответов, в БД не хранится).
 * Попытка другой версии политики (policyVersion ≠ POLICY_VERSION) дозадавания не получает: только
 * основная фаза, как при её старте, — иначе обновление политики меняло бы длину и фазу задним числом.
 */
function stepOf(a: AttemptWithItems, byId: Map<string, SelectableTemplate>): Step {
  const shown: SelectableTemplate[] = [];
  const responses: Response[] = [];
  for (const it of a.items) {
    if (it.correct === null) continue;
    const t = byId.get(it.templateId);
    if (!t) continue;
    shown.push(t);
    responses.push({ a: t.a, b: t.b, correct: it.correct });
  }
  return nextStep({ pool: [...byId.values()], shown, responses, grade: a.grade, probe: PROBE_VERSIONS.has(a.policyVersion) });
}

async function poolMap(a: Pick<TestAttempt, 'specialization' | 'subcategoryId'>): Promise<Map<string, SelectableTemplate & { generator: TaskGenerator }>> {
  return new Map((await loadPool(a.specialization, a.subcategoryId)).map((t) => [t.id, t]));
}

/** Сгенерировать и записать следующее задание попытки; null — банк исчерпан. */
async function pushNextItem(attempt: AttemptWithItems, theta: number, phase: AttemptPhase = 'main'): Promise<TestItem | null> {
  const pool = await loadPool(attempt.specialization, attempt.subcategoryId);
  const byId = new Map(pool.map((t) => [t.id, t]));
  const shown = attempt.items.map((i) => byId.get(i.templateId)).filter((t): t is NonNullable<typeof t> => Boolean(t));
  const index = attempt.items.length;
  const next = selectNext(phasePool(pool, phase), { shown, theta, seed: deriveSeed(attempt.seed, 1000 + index) });
  if (!next) return null;
  const generator = byId.get(next.id)!.generator;
  const instanceSeed = deriveSeed(attempt.seed, index);
  const inst = generator.generate(instanceSeed);
  const [item] = await prisma.$transaction([
    prisma.testItem.create({
      data: {
        attemptId: attempt.id,
        index,
        templateId: next.id,
        instanceSeed,
        params: inst.params as Prisma.InputJsonValue,
        prompt: inst.prompt,
        code: inst.code ?? null,
        answerHint: inst.answerHint,
        answerKey: inst.answerKey,
        explanation: inst.explanation,
      },
    }),
    prisma.taskTemplate.update({ where: { id: next.id }, data: { exposure: { increment: 1 } } }),
  ]);
  return item;
}

export async function startAttempt(
  candidateId: string,
  spec: Specialization,
  grade: Grade,
  now: Date = new Date(),
  opts: { seed?: number; subcategoryId?: string | null } = {},
): Promise<StartResult> {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true } });
  if (!candidate) throw errors.notFound('Кандидат не найден');
  // Просроченные активные попытки — в abandoned (не провал, интервалы не запускают).
  await prisma.testAttempt.updateMany({ where: { candidateId, status: 'active', expiresAt: { lte: now } }, data: { status: 'abandoned', finishedAt: now } });
  const active = await prisma.testAttempt.findFirst({ where: { candidateId, status: 'active' } });
  if (active) {
    const sameSub = opts.subcategoryId === undefined || opts.subcategoryId === active.subcategoryId;
    if (active.specialization === spec && active.grade === grade && sameSub) return { attemptId: active.id, resumed: true };
    throw new AppError('active_attempt', 'Сначала завершите текущую попытку.', 409, { attemptId: active.id });
  }
  const elig = await checkEligibility(candidateId, spec, grade, now, opts.subcategoryId);
  const unprocessable = elig.code === 'no_test' || elig.code === 'subcategory_required';
  if (!elig.allowed) throw new AppError(elig.code!, elig.reason!, unprocessable ? 422 : 409, { nextAllowedAt: elig.nextAllowedAt });

  const iv = intervals();
  const attempt = await prisma.testAttempt.create({
    data: {
      candidateId,
      specialization: spec,
      subcategoryId: elig.subcategoryId ?? null,
      grade,
      mode: iv.demo ? 'demo' : 'full',
      seed: opts.seed ?? randomSeed(),
      policyVersion: POLICY_VERSION,
      startedAt: now,
      expiresAt: new Date(now.getTime() + ATTEMPT_TTL_HOURS * 60 * MIN_MS),
    },
    include: { items: true },
  });
  const first = await pushNextItem(attempt, 0);
  if (!first) throw new AppError('no_templates', 'Банк заданий пуст', 503);
  return { attemptId: attempt.id, resumed: false };
}

function itemView(it: TestItem, title: string, format: TaskGenerator['format'], timeLimitSec: number): ItemView {
  return {
    index: it.index,
    templateId: it.templateId,
    title,
    prompt: it.prompt,
    ...(it.code ? { code: it.code } : {}),
    answerHint: it.answerHint,
    format,
    timeLimitSec,
    askedAt: it.askedAt.toISOString(),
  };
}

function resultView(a: AttemptWithItems, byId: Map<string, SelectableTemplate & { generator: TaskGenerator }>): AttemptResult | null {
  if (a.status === 'active' || a.theta === null || a.pPass === null || a.pJunior === null || a.se === null) return null;
  const answered = a.items.filter((i) => i.correct !== null);
  const correct = answered.filter((i) => i.correct).length;
  const items: AnsweredItemView[] = answered.map((it) => {
    const g = byId.get(it.templateId)?.generator;
    return {
      ...itemView(it, g?.title ?? it.templateId, g?.format ?? 'text', g?.timeLimitSec ?? 180),
      answer: it.answer ?? '',
      correct: Boolean(it.correct),
      answerKey: it.answerKey.split('|')[0]!,
      explanation: it.explanation,
      catalogIds: byId.get(it.templateId)?.catalogIds ?? [],
    };
  });
  const confirmed = a.status === 'passed';
  const decision = { theta: a.theta, se: a.se, pPass: a.pPass, pJunior: a.pJunior, confirmed, juniorOffered: a.juniorOffered };
  return {
    status: a.status,
    theta: a.theta,
    se: a.se,
    pPass: a.pPass,
    pJunior: a.pJunior,
    confirmed,
    juniorOffered: a.juniorOffered && a.juniorConfirmedAt === null,
    juniorConfirmedAt: a.juniorConfirmedAt?.toISOString() ?? null,
    answered: answered.length,
    correct,
    explanation: a.status === 'abandoned' ? 'Попытка завершена без ответов и не учитывается.' : explainDecision(decision, a.grade, answered.length, correct),
    confirmedCatalogIds: [...new Set(items.filter((i) => i.correct).flatMap((i) => i.catalogIds))].sort(),
    items,
    finishedAt: (a.finishedAt ?? new Date()).toISOString(),
  };
}

async function view(a: AttemptWithItems): Promise<AttemptView> {
  const byId = await poolMap(a);
  const answered = a.items.filter((i) => i.correct !== null).length;
  const current = a.status === 'active' ? a.items.find((i) => i.correct === null) : undefined;
  const g = current ? byId.get(current.templateId)?.generator : undefined;
  // Фаза и потолок нужны только для прогресса активной попытки; у завершённой — основные значения,
  // чтобы итог старой версии не показывал «дополнительное, всего до 13».
  const step = a.status === 'active' ? stepOf(a, byId) : { phase: 'main' as const, maxItems: MAX_ITEMS };
  return {
    id: a.id,
    specialization: a.specialization,
    subcategoryId: a.subcategoryId,
    grade: a.grade,
    status: a.status,
    mode: a.mode === 'demo' ? 'demo' : 'full',
    answered,
    phase: step.phase,
    minItems: MIN_ITEMS,
    maxItems: step.maxItems,
    startedAt: a.startedAt.toISOString(),
    expiresAt: a.expiresAt.toISOString(),
    current: current && g ? itemView(current, g.title, g.format, g.timeLimitSec) : null,
    result: resultView(a, byId),
  };
}

export async function getAttempt(candidateId: string, attemptId: string): Promise<AttemptView> {
  return view(await loadAttempt(candidateId, attemptId));
}

function assertActive(a: AttemptWithItems, now: Date): void {
  if (a.status !== 'active') throw new AppError('attempt_finished', 'Попытка уже завершена.', 409);
  if (a.expiresAt <= now) throw new AppError('attempt_expired', 'Срок попытки истёк, начните новую.', 409);
}

/** Завершить попытку по ответам: решение, категория, уровень утверждений. */
async function finalize(a: AttemptWithItems, now: Date): Promise<AttemptWithItems> {
  const byId = await poolMap(a);
  const responses = responsesOf(a.items, byId);
  if (responses.length === 0) {
    return prisma.testAttempt.update({ where: { id: a.id }, data: { status: 'abandoned', finishedAt: now }, include: { items: { orderBy: { index: 'asc' } } } });
  }
  const d = decide(responses, a.grade);
  const status = d.confirmed ? 'passed' : 'not_confirmed';
  const solvedCatalogIds = [...new Set(a.items.filter((i) => i.correct).flatMap((i) => byId.get(i.templateId)?.catalogIds ?? []))];
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.testAttempt.update({
      where: { id: a.id },
      data: { status, theta: d.theta, se: d.se, pPass: d.pPass, pJunior: d.pJunior, juniorOffered: d.juniorOffered, finishedAt: now },
    }),
  ];
  if (d.confirmed) {
    ops.push(
      prisma.candidateCategory.create({
        data: { candidateId: a.candidateId, specialization: a.specialization, subcategoryId: a.subcategoryId, grade: a.grade, source: 'test', confirmedAt: now },
      }),
    );
  }
  if (solvedCatalogIds.length > 0) {
    // Решённое на платформе задание — доказательство уровня «платформа» для утверждений кандидата (ADR-0001 уровни).
    ops.push(
      prisma.claim.updateMany({
        where: { candidateId: a.candidateId, catalogId: { in: solvedCatalogIds }, status: { in: ['confirmed', 'edited'] }, level: { in: [...PLATFORM_UPGRADABLE] } },
        data: { level: 'platform' },
      }),
    );
  }
  await prisma.$transaction(ops);
  return loadAttempt(a.candidateId, a.id);
}

export async function answerAttempt(candidateId: string, attemptId: string, rawAnswer: string, now: Date = new Date()): Promise<AttemptView> {
  const a = await loadAttempt(candidateId, attemptId);
  assertActive(a, now);
  const current = a.items.find((i) => i.correct === null);
  if (!current) throw new AppError('no_current_item', 'Нет открытого задания.', 409);
  const byId = await poolMap(a);
  const g = byId.get(current.templateId)?.generator;
  if (!g) throw new AppError('template_missing', 'Шаблон задания выведен из оборота.', 409);
  const answer = rawAnswer.slice(0, MAX_ANSWER_CHARS);
  const correct = checkAnswer(g.format, answer, current.answerKey);
  const answeredItems = [...a.items.filter((i) => i.correct !== null), { ...current, correct }];
  const est = estimateTheta(responsesOf(answeredItems, byId));
  await prisma.testItem.update({ where: { id: current.id }, data: { answer, correct, thetaAfter: est.theta, seAfter: est.se, answeredAt: now } });
  const updated = await loadAttempt(candidateId, attemptId);
  const step = stepOf(updated, byId);
  if (step.stop) return view(await finalize(updated, now));
  const next = await pushNextItem(updated, est.theta, step.phase);
  if (!next) return view(await finalize(updated, now));
  return view(await loadAttempt(candidateId, attemptId));
}

/** Досрочное завершение: решение по уже данным ответам; без ответов — abandoned. */
export async function finishAttempt(candidateId: string, attemptId: string, now: Date = new Date()): Promise<AttemptView> {
  const a = await loadAttempt(candidateId, attemptId);
  assertActive(a, now);
  return view(await finalize(a, now));
}

/** R-C-08: Middle не подтверждён, Junior по той же попытке — по согласию кандидата, в один клик. */
export async function confirmJunior(candidateId: string, attemptId: string, now: Date = new Date()): Promise<AttemptView> {
  const a = await loadAttempt(candidateId, attemptId);
  if (a.status !== 'not_confirmed' || !a.juniorOffered) throw new AppError('junior_not_offered', 'По этой попытке Junior не предлагается.', 409);
  if (a.juniorConfirmedAt) throw new AppError('already_confirmed', 'Junior по этой попытке уже подтверждён.', 409);
  await prisma.$transaction([
    prisma.testAttempt.update({ where: { id: a.id }, data: { juniorConfirmedAt: now } }),
    prisma.candidateCategory.create({ data: { candidateId, specialization: a.specialization, subcategoryId: a.subcategoryId, grade: 'junior', source: 'test', confirmedAt: now } }),
  ]);
  return view(await loadAttempt(candidateId, attemptId));
}

/** История попыток (R-C-07), новые сверху. */
export async function listAttempts(candidateId: string): Promise<AttemptSummary[]> {
  const rows = await prisma.testAttempt.findMany({
    where: { candidateId },
    orderBy: { startedAt: 'desc' },
    include: { items: { select: { correct: true } } },
  });
  return rows.map((a) => ({
    id: a.id,
    specialization: a.specialization,
    subcategoryId: a.subcategoryId,
    grade: a.grade,
    status: a.status,
    theta: a.theta,
    pPass: a.pPass,
    answered: a.items.filter((i) => i.correct !== null).length,
    correct: a.items.filter((i) => i.correct).length,
    juniorConfirmedAt: a.juniorConfirmedAt?.toISOString() ?? null,
    startedAt: a.startedAt.toISOString(),
    finishedAt: a.finishedAt?.toISOString() ?? null,
  }));
}
