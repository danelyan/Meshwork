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
import { lowerGrade } from '../../lib/grades';

import { COMMON_GENERATORS } from './generators/common';
import { GENERATORS, getGenerator, hasTestFor, poolFor, unavailableReason } from './generators';
import {
  CONFIRM_CANARIES,
  CONFIRM_MAX_ITEMS,
  CONFIRM_MIN_ITEMS,
  GRADE_CANARIES,
  cleanResponses,
  confirmRemaining,
  confirmSelectionPool,
  confirmShouldStop,
  confirmTimeLimit,
  decideConfirm,
} from './confirm';
import {
  CANARY_SHIFT_MAX,
  CANARY_SHIFT_MIN,
  EMPTY_SIGNALS,
  assessAttempt,
  canaryText,
  canarySlots,
  parseSignals,
  wantsCanary,
  type BrowserSignals,
  type IntegrityIndex,
  type ItemObservation,
} from './integrity';
import { estimateTheta, type Response } from './irt';
import {
  decide,
  CONFIRM_PROB,
  explainDecision,
  gradeLabel,
  MAX_ITEMS,
  MIN_ITEMS,
  nextStep,
  phasePool,
  POLICY_VERSION,
  rulesFor,
  selectNext,
  START_THETA,
  type AttemptPhase,
  type SelectableTemplate,
  type Step,
} from './policy';
import { createRng, deriveSeed, randomSeed } from './rng';
import type {
  AnsweredItemView,
  AttemptResult,
  AttemptSummary,
  AttemptView,
  AttemptKind,
  EligibilityView,
  IntegrityView,
  ItemView,
  StartResult,
  TaskGenerator,
} from './types';

/** Версия политики и правила остановки по версии — policy.ts (POLICY_VERSION, rulesFor). */
export { POLICY_VERSION };
/** Версии с дозадаванием Junior (v3 и новее): правило фазы не меняется задним числом для v1–v2. */
const PROBE_VERSIONS = new Set(['adr-0002-v3', 'adr-0002-v4', 'adr-0002-v5', 'adr-0002-v6', 'adr-0002-v7']);
/** Версии с ротацией семейств между попытками кандидата (v5 и новее). */
const ROTATION_VERSIONS = new Set(['adr-0002-v5', 'adr-0002-v6', 'adr-0002-v7']);
/** Версии с ловушками, фиксацией лимита и блокирующим индексом честности (v6). У старых индекс только считается. */
const INTEGRITY_VERSIONS = new Set(['adr-0002-v6', 'adr-0002-v7']);
/**
 * Версии с общими компетенциями в пуле подкатегории (v7, ADR 0003, дополнение 11.10). Попытки v6 и старше доигрываются
 * по пулу из своих семейств — общие не появляются в них задним числом.
 */
const COMMON_VERSIONS = new Set(['adr-0002-v7']);
const COMMON_IDS = new Set(COMMON_GENERATORS.map((g) => g.id));

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
 * Пул попытки. С подкатегорией — семейства подкатегории (poolFor; переходное направление — всё направление), у попыток
 * v7 и новее — плюс общие семейства по карте common-map.ts; без подкатегории (попытки до v4) — всё направление, как при
 * их старте. Общие семейства ищутся по id, а не по направлению: в БД у них «домашнее» направление.
 */
async function loadPool(spec: Specialization, subcategoryId: string | null, common = false): Promise<(SelectableTemplate & { generator: TaskGenerator })[]> {
  await ensureTemplates();
  const ids = subcategoryId ? poolFor(spec, subcategoryId, { common })?.generators.map((g) => g.id) : undefined;
  const rows = await prisma.taskTemplate.findMany({ where: ids ? { id: { in: ids } } : { specialization: spec }, orderBy: { id: 'asc' } });
  const out: (SelectableTemplate & { generator: TaskGenerator })[] = [];
  for (const r of rows) {
    const generator = getGenerator(r.id);
    if (!generator) continue; // шаблон выведен из кода — из оборота
    if (generator.shared && !ids) continue; // пул направления (до v4) — без общих
    out.push({ id: r.id, a: r.irtA, b: r.irtB, catalogIds: r.catalogIds, grade: r.grade, exposure: r.exposure, common: Boolean(generator.shared), generator });
  }
  return out;
}

/** Пул попытки по её версии политики: общие семейства — только у COMMON_VERSIONS. */
function loadAttemptPool(a: Pick<TestAttempt, 'specialization' | 'subcategoryId' | 'policyVersion'>): ReturnType<typeof loadPool> {
  return loadPool(a.specialization, a.subcategoryId, COMMON_VERSIONS.has(a.policyVersion));
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
      // needs_confirmation запускает интервал пересдачи (иначе флаг обходился бы новой попыткой вместо подтверждающей);
      // подтверждающие попытки (kind = confirm) в интервалах не участвуют.
      where: { candidateId, specialization: spec, subcategoryId: sub, grade, kind: 'grade', status: { in: ['passed', 'not_confirmed', 'needs_confirmation'] } },
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

/** Индекс честности в TestAttempt.integrity (Json, ADR-0002, дополнение 11.10). */
export interface StoredIntegrity extends IntegrityIndex {
  /** Индекс задержал выдачу категории (TEST_INTEGRITY, политика v6, high и по ответам грейд выдаётся). */
  blocking: boolean;
  /** Грейд, который выдался бы без индекса; его проверяет подтверждающий тест. null — не задерживали. */
  confirmGrade: Grade | null;
  /** Подтверждающая попытка, по которой выдана категория. */
  confirmedBy: string | null;
  computedAt: string;
}

function storedIntegrity(raw: Prisma.JsonValue | null): StoredIntegrity | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as unknown as StoredIntegrity;
}

function kindOf(a: Pick<TestAttempt, 'kind'>): AttemptKind {
  return a.kind === 'confirm' ? 'confirm' : 'grade';
}

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
  return nextStep({ pool: [...byId.values()], shown, responses, grade: a.grade, probe: PROBE_VERSIONS.has(a.policyVersion) }, rulesFor(a.policyVersion));
}

async function poolMap(a: Pick<TestAttempt, 'specialization' | 'subcategoryId' | 'policyVersion'>): Promise<Map<string, SelectableTemplate & { generator: TaskGenerator }>> {
  return new Map((await loadAttemptPool(a)).map((t) => [t.id, t]));
}

/**
 * Шаблоны, показанные кандидату в прошлых попытках того же направления и подкатегории (adr-0002-v5): после попытки
 * он видит разбор и ключи, поэтому пересдача по возможности идёт на других семействах (selectNext, SEEN_BEFORE_WEIGHT).
 * Попытки старых версий доигрываются без ротации — как начались.
 */
async function seenInPreviousAttempts(attempt: AttemptWithItems): Promise<Set<string>> {
  if (!ROTATION_VERSIONS.has(attempt.policyVersion)) return new Set();
  // Общие семейства (v7) кандидат видит и в попытках других подкатегорий — они тоже «виденные».
  const common = COMMON_VERSIONS.has(attempt.policyVersion) && COMMON_IDS.size > 0;
  const samePool = { candidateId: attempt.candidateId, specialization: attempt.specialization, subcategoryId: attempt.subcategoryId, id: { not: attempt.id } };
  const rows = await prisma.testItem.findMany({
    where: common
      ? { OR: [{ attempt: samePool }, { templateId: { in: [...COMMON_IDS] }, attempt: { candidateId: attempt.candidateId, id: { not: attempt.id } } }] }
      : { attempt: samePool },
    select: { templateId: true },
    distinct: ['templateId'],
  });
  return new Set(rows.map((r) => r.templateId));
}

/** Подтверждающая попытка: исходная попытка с заданиями и её индекс честности. */
interface ConfirmSource {
  attempt: AttemptWithItems;
  integrity: StoredIntegrity | null;
  templateIds: Set<string>;
  /** Ответы исходной попытки без заданий с флагами времени и ловушки. */
  clean: Response[];
}

async function confirmSourceOf(a: TestAttempt, byId: Map<string, SelectableTemplate>): Promise<ConfirmSource | null> {
  if (a.kind !== 'confirm' || !a.confirmsAttemptId) return null;
  const src = await loadAttempt(a.candidateId, a.confirmsAttemptId);
  const integrity = storedIntegrity(src.integrity);
  const answered = src.items.filter((i) => i.correct !== null);
  return {
    attempt: src,
    integrity,
    templateIds: new Set(src.items.map((i) => i.templateId)),
    clean: responsesOf(cleanResponses(answered, integrity?.flaggedItems ?? []), byId),
  };
}

/** Сгенерировать и записать следующее задание попытки; null — банк исчерпан. */
async function pushNextItem(attempt: AttemptWithItems, theta: number, phase: AttemptPhase = 'main', now: Date = new Date()): Promise<TestItem | null> {
  const pool = await loadAttemptPool(attempt);
  const byId = new Map(pool.map((t) => [t.id, t]));
  const shown = attempt.items.map((i) => byId.get(i.templateId)).filter((t): t is NonNullable<typeof t> => Boolean(t));
  const index = attempt.items.length;
  const confirm = attempt.kind === 'confirm';
  const seenBefore = confirm ? new Set<string>() : await seenInPreviousAttempts(attempt);
  const source = confirm ? await confirmSourceOf(attempt, byId) : null;
  const selectFrom = source ? confirmSelectionPool(pool, source.templateIds, new Set(shown.map((t) => t.id))) : phasePool(pool, phase, attempt.grade);
  const next = selectNext(selectFrom, { shown, theta, seed: deriveSeed(attempt.seed, 1000 + index), seenBefore });
  if (!next) return null;
  const generator = byId.get(next.id)!.generator;
  const instanceSeed = deriveSeed(attempt.seed, index);
  const inst = generator.generate(instanceSeed);
  // Ловушка (v6): места — по seed попытки среди первых заданий, ставится на задание с числовым ответом.
  let canaryShift: number | null = null;
  if (INTEGRITY_VERSIONS.has(attempt.policyVersion)) {
    const slotRng = createRng(deriveSeed(attempt.seed, 5000));
    const slots = confirm ? canarySlots(slotRng.int, CONFIRM_CANARIES, 0, CONFIRM_MIN_ITEMS - 2) : canarySlots(slotRng.int, GRADE_CANARIES, 1, MIN_ITEMS - 2);
    const placed = attempt.items.filter((i) => i.canaryShift !== null).length;
    if (wantsCanary(index, placed, slots, generator.format)) canaryShift = createRng(deriveSeed(attempt.seed, 6000 + index)).int(CANARY_SHIFT_MIN, CANARY_SHIFT_MAX);
  }
  const timeLimitSec = confirm ? confirmTimeLimit(generator.timeLimitSec) : generator.timeLimitSec;
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
        askedAt: now,
        timeLimitSec,
        canaryShift,
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
    if (active.kind === 'grade' && active.specialization === spec && active.grade === grade && sameSub) return { attemptId: active.id, resumed: true };
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
  const first = await pushNextItem(attempt, START_THETA[grade], 'main', now);
  if (!first) throw new AppError('no_templates', 'Банк заданий пуст', 503);
  return { attemptId: attempt.id, resumed: false };
}

/**
 * Подтверждающий тест к попытке в статусе needs_confirmation (ADR-0002, дополнение 11.10): 6–8 заданий, сначала
 * семейства, которых не было в исходной попытке; лимит времени ×0,7; одна ловушка. Интервалы пересдачи не проверяются
 * и не запускаются. Активная подтверждающая попытка к той же исходной — продолжение (resumed). Одна на исходную попытку.
 */
export async function startConfirmAttempt(candidateId: string, sourceAttemptId: string, now: Date = new Date(), opts: { seed?: number } = {}): Promise<StartResult> {
  const src = await loadAttempt(candidateId, sourceAttemptId);
  if (src.status !== 'needs_confirmation') throw new AppError('confirm_not_needed', 'Эта попытка не требует подтверждения.', 409);
  const integrity = storedIntegrity(src.integrity);
  if (integrity?.confirmedBy) throw new AppError('already_confirmed', 'Грейд по этой попытке уже подтверждён.', 409);
  await prisma.testAttempt.updateMany({ where: { candidateId, status: 'active', expiresAt: { lte: now } }, data: { status: 'abandoned', finishedAt: now } });
  const active = await prisma.testAttempt.findFirst({ where: { candidateId, status: 'active' } });
  if (active) {
    if (active.kind === 'confirm' && active.confirmsAttemptId === src.id) return { attemptId: active.id, resumed: true };
    throw new AppError('active_attempt', 'Сначала завершите текущую попытку.', 409, { attemptId: active.id });
  }
  const used = await prisma.testAttempt.findFirst({ where: { candidateId, kind: 'confirm', confirmsAttemptId: src.id, status: { not: 'abandoned' } } });
  if (used) throw new AppError('confirm_used', 'Подтверждающий тест по этой попытке уже пройден. Дальше — обычная пересдача по интервалам.', 409, { attemptId: used.id });
  const grade = integrity?.confirmGrade ?? src.grade;
  const attempt = await prisma.testAttempt.create({
    data: {
      candidateId,
      specialization: src.specialization,
      subcategoryId: src.subcategoryId,
      grade,
      mode: src.mode,
      seed: opts.seed ?? randomSeed(),
      policyVersion: POLICY_VERSION,
      kind: 'confirm',
      confirmsAttemptId: src.id,
      startedAt: now,
      expiresAt: new Date(now.getTime() + ATTEMPT_TTL_HOURS * 60 * MIN_MS),
    },
    include: { items: true },
  });
  const byId = await poolMap(attempt);
  const source = await confirmSourceOf(attempt, byId);
  const first = await pushNextItem(attempt, estimateTheta(source?.clean ?? []).theta, 'main', now);
  if (!first) throw new AppError('no_templates', 'Банк заданий пуст', 503);
  return { attemptId: attempt.id, resumed: false };
}

function itemView(it: TestItem, title: string, format: TaskGenerator['format'], timeLimitSec: number, withCanary = true): ItemView {
  return {
    index: it.index,
    templateId: it.templateId,
    title,
    prompt: it.prompt,
    ...(it.code ? { code: it.code } : {}),
    answerHint: it.answerHint,
    format,
    timeLimitSec: it.timeLimitSec ?? timeLimitSec,
    askedAt: it.askedAt.toISOString(),
    canary: withCanary && it.canaryShift !== null ? canaryText(it.canaryShift) : null,
  };
}

function explainResult(a: AttemptWithItems, d: Parameters<typeof explainDecision>[0], answered: number, correct: number, integrity: StoredIntegrity | null): string {
  if (a.status === 'abandoned') return 'Попытка завершена без ответов и не учитывается.';
  if (a.kind === 'confirm') {
    const base = `Подтверждающий тест: решено ${correct} из ${answered}. Уверенность по обеим попыткам (без отмеченных заданий), что уровень не ниже ${gradeLabel(a.grade)}: ${Math.round(d.pPass * 100)}% (нужно не меньше ${Math.round(CONFIRM_PROB * 100)}%).`;
    if (a.status === 'passed') return `${base} Грейд ${gradeLabel(a.grade)} подтверждён, категория выдана.`;
    if (integrity?.blocking) return `${base} Порог пройден, но и в подтверждающем тесте есть признаки, которые не дают выдать категорию автоматически. Дальше — обычная пересдача по интервалам или разбор теста на созвоне.`;
    return `${base} Грейд ${gradeLabel(a.grade)} не подтверждён. Уже подтверждённая категория не снимается.`;
  }
  if (a.status === 'needs_confirmation') {
    const g = integrity?.confirmGrade ?? a.grade;
    if (integrity?.confirmedBy) return `Грейд ${gradeLabel(g)} подтверждён подтверждающим тестом.`;
    return `По ответам грейд ${gradeLabel(g)} подтверждается, но в попытке есть признаки, которые мы просим подтвердить: короткий тест из ${CONFIRM_MIN_ITEMS}–${CONFIRM_MAX_ITEMS} других заданий с более коротким таймером. Это не обвинение и не снятие грейда: уже подтверждённая категория остаётся.`;
  }
  return explainDecision(d, a.grade, answered, correct);
}

function integrityView(a: AttemptWithItems, integrity: StoredIntegrity | null, confirmAttemptId: string | null): IntegrityView | null {
  if (!integrity) return null;
  return {
    level: integrity.level,
    needsConfirmation: a.status === 'needs_confirmation' && !integrity.confirmedBy,
    confirmGrade: integrity.confirmGrade ?? null,
    confirmAttemptId,
    confirmedBy: integrity.confirmedBy ?? null,
  };
}

function resultView(a: AttemptWithItems, byId: Map<string, SelectableTemplate & { generator: TaskGenerator }>, confirmAttemptId: string | null = null): AttemptResult | null {
  if (a.status === 'active' || a.theta === null || a.pPass === null || a.pJunior === null || a.se === null) return null;
  const answered = a.items.filter((i) => i.correct !== null);
  const correct = answered.filter((i) => i.correct).length;
  const items: AnsweredItemView[] = answered.map((it) => {
    const g = byId.get(it.templateId)?.generator;
    return {
      ...itemView(it, g?.title ?? it.templateId, g?.format ?? 'text', g?.timeLimitSec ?? 180, false),
      answer: it.answer ?? '',
      correct: Boolean(it.correct),
      answerKey: it.answerKey.split('|')[0]!,
      explanation: it.explanation,
      catalogIds: byId.get(it.templateId)?.catalogIds ?? [],
    };
  });
  const confirmed = a.status === 'passed';
  const integrity = storedIntegrity(a.integrity);
  // pLower (Senior → Middle) в БД не хранится: пересчёт по ответам, те же ответы → то же число.
  // У подтверждающей попытки грейда ниже не предлагается.
  const pLower = a.kind === 'confirm' ? null : decide(responsesOf(a.items, byId), a.grade).pLower;
  const juniorOffered = a.juniorOffered && a.status === 'not_confirmed';
  const offeredGrade = juniorOffered ? lowerGrade(a.grade) : null;
  const decision = { theta: a.theta, se: a.se, pPass: a.pPass, pJunior: a.pJunior, confirmed, juniorOffered, offeredGrade, pLower };
  return {
    status: a.status,
    theta: a.theta,
    se: a.se,
    pPass: a.pPass,
    pJunior: a.pJunior,
    confirmed,
    juniorOffered: juniorOffered && a.juniorConfirmedAt === null,
    offeredGrade,
    pLower,
    juniorConfirmedAt: a.juniorConfirmedAt?.toISOString() ?? null,
    answered: answered.length,
    correct,
    explanation: explainResult(a, decision, answered.length, correct, integrity),
    confirmedCatalogIds: [...new Set(items.filter((i) => i.correct).flatMap((i) => i.catalogIds))].sort(),
    items,
    finishedAt: (a.finishedAt ?? new Date()).toISOString(),
    integrity: integrityView(a, integrity, confirmAttemptId),
  };
}

async function view(a: AttemptWithItems): Promise<AttemptView> {
  const byId = await poolMap(a);
  const answered = a.items.filter((i) => i.correct !== null).length;
  const current = a.status === 'active' ? a.items.find((i) => i.correct === null) : undefined;
  const g = current ? byId.get(current.templateId)?.generator : undefined;
  const confirm = a.kind === 'confirm';
  // Фаза и потолок нужны только для прогресса активной попытки; у завершённой — основные значения,
  // чтобы итог старой версии не показывал «дополнительное, всего до 13».
  const step = confirm
    ? { phase: 'main' as const, maxItems: CONFIRM_MAX_ITEMS }
    : a.status === 'active'
      ? stepOf(a, byId)
      : { phase: 'main' as const, maxItems: MAX_ITEMS };
  const confirmAttempt =
    !confirm && a.status === 'needs_confirmation'
      ? await prisma.testAttempt.findFirst({ where: { candidateId: a.candidateId, kind: 'confirm', confirmsAttemptId: a.id }, orderBy: { startedAt: 'desc' }, select: { id: true } })
      : null;
  return {
    id: a.id,
    specialization: a.specialization,
    subcategoryId: a.subcategoryId,
    grade: a.grade,
    status: a.status,
    mode: a.mode === 'demo' ? 'demo' : 'full',
    kind: kindOf(a),
    confirmsAttemptId: a.confirmsAttemptId,
    answered,
    phase: step.phase,
    minItems: confirm ? CONFIRM_MIN_ITEMS : MIN_ITEMS,
    maxItems: step.maxItems,
    startedAt: a.startedAt.toISOString(),
    expiresAt: a.expiresAt.toISOString(),
    current: current && g ? itemView(current, g.title, g.format, g.timeLimitSec) : null,
    result: resultView(a, byId, confirmAttempt?.id ?? null),
  };
}

export async function getAttempt(candidateId: string, attemptId: string): Promise<AttemptView> {
  return view(await loadAttempt(candidateId, attemptId));
}

function assertActive(a: Pick<TestAttempt, 'status' | 'expiresAt'>, now: Date): void {
  if (a.status !== 'active') throw new AppError('attempt_finished', 'Попытка уже завершена.', 409);
  if (a.expiresAt <= now) throw new AppError('attempt_expired', 'Срок попытки истёк, начните новую.', 409);
}

type PoolById = Map<string, SelectableTemplate & { generator: TaskGenerator }>;

/** Наблюдения для индекса честности: отвеченные задания с параметрами, временем, ловушкой. */
function observationsOf(items: readonly TestItem[], byId: PoolById): ItemObservation[] {
  const out: ItemObservation[] = [];
  for (const it of items) {
    if (it.correct === null) continue;
    const t = byId.get(it.templateId);
    if (!t) continue;
    out.push({
      index: it.index,
      a: t.a,
      b: t.b,
      correct: it.correct,
      seconds: it.answeredAt ? (it.answeredAt.getTime() - it.askedAt.getTime()) / 1000 : null,
      timeLimitSec: it.timeLimitSec,
      format: t.generator.format,
      answer: it.answer ?? '',
      answerKey: it.answerKey,
      canaryShift: it.canaryShift,
    });
  }
  return out;
}

function solvedCatalogIdsOf(items: readonly TestItem[], byId: PoolById): string[] {
  return [...new Set(items.filter((i) => i.correct).flatMap((i) => byId.get(i.templateId)?.catalogIds ?? []))];
}

/** Решённое на платформе задание — доказательство уровня «платформа» для утверждений кандидата (ADR-0001 уровни). */
function upgradeClaims(candidateId: string, catalogIds: string[]): Prisma.PrismaPromise<unknown>[] {
  if (catalogIds.length === 0) return [];
  return [
    prisma.claim.updateMany({
      where: { candidateId, catalogId: { in: catalogIds }, status: { in: ['confirmed', 'edited'] }, level: { in: [...PLATFORM_UPGRADABLE] } },
      data: { level: 'platform' },
    }),
  ];
}

const asJson = (v: StoredIntegrity): Prisma.InputJsonValue => v as unknown as Prisma.InputJsonValue;

async function abandon(a: AttemptWithItems, now: Date): Promise<AttemptWithItems> {
  return prisma.testAttempt.update({ where: { id: a.id }, data: { status: 'abandoned', finishedAt: now }, include: { items: { orderBy: { index: 'asc' } } } });
}

/**
 * Завершить попытку по ответам: решение, индекс честности, категория, уровень утверждений.
 * v6: грейд по ответам выдаётся (подтверждён или предложен грейд ниже), но индекс high и TEST_INTEGRITY → статус
 * needs_confirmation, категория не создаётся, утверждения не поднимаются; дальше — подтверждающий тест.
 */
async function finalize(a: AttemptWithItems, now: Date): Promise<AttemptWithItems> {
  if (a.kind === 'confirm') return finalizeConfirm(a, now);
  const byId = await poolMap(a);
  const responses = responsesOf(a.items, byId);
  if (responses.length === 0) return abandon(a, now);
  const d = decide(responses, a.grade);
  const index: IntegrityIndex = assessAttempt(observationsOf(a.items, byId), d.theta, parseSignals(a.signals));
  const grantable = d.confirmed ? a.grade : d.juniorOffered ? d.offeredGrade : null;
  const blocking = getEnv().TEST_INTEGRITY && INTEGRITY_VERSIONS.has(a.policyVersion) && index.level === 'high' && grantable !== null;
  const integrity: StoredIntegrity = { ...index, blocking, confirmGrade: blocking ? grantable : null, confirmedBy: null, computedAt: now.toISOString() };
  const status = blocking ? 'needs_confirmation' : d.confirmed ? 'passed' : 'not_confirmed';
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.testAttempt.update({
      where: { id: a.id },
      data: { status, theta: d.theta, se: d.se, pPass: d.pPass, pJunior: d.pJunior, juniorOffered: d.juniorOffered, finishedAt: now, integrity: asJson(integrity) },
    }),
  ];
  if (!blocking) {
    if (d.confirmed) {
      ops.push(
        prisma.candidateCategory.create({
          data: { candidateId: a.candidateId, specialization: a.specialization, subcategoryId: a.subcategoryId, grade: a.grade, source: 'test', confirmedAt: now },
        }),
      );
    }
    ops.push(...upgradeClaims(a.candidateId, solvedCatalogIdsOf(a.items, byId)));
  }
  await prisma.$transaction(ops);
  return loadAttempt(a.candidateId, a.id);
}

/**
 * Завершить подтверждающую попытку: P(θ > порог) по объединению чистых ответов исходной и ответов подтверждающей.
 * Пройдена и её собственный индекс не high → категория (source test), в integrity исходной — confirmedBy.
 */
async function finalizeConfirm(a: AttemptWithItems, now: Date): Promise<AttemptWithItems> {
  const byId = await poolMap(a);
  const own = responsesOf(a.items, byId);
  if (own.length === 0) return abandon(a, now);
  const source = await confirmSourceOf(a, byId);
  if (!source) throw errors.notFound('Исходная попытка не найдена');
  const est = estimateTheta([...source.clean, ...own]);
  const index = assessAttempt(observationsOf(a.items, byId), est.theta, parseSignals(a.signals));
  const d = decideConfirm(source.clean, own, a.grade, getEnv().TEST_INTEGRITY ? index.level : 'low');
  const integrity: StoredIntegrity = { ...index, blocking: d.blockedByRisk, confirmGrade: null, confirmedBy: null, computedAt: now.toISOString() };
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.testAttempt.update({
      where: { id: a.id },
      data: { status: d.confirmed ? 'passed' : 'not_confirmed', theta: d.theta, se: d.se, pPass: d.pPass, pJunior: d.pJunior, juniorOffered: false, finishedAt: now, integrity: asJson(integrity) },
    }),
  ];
  if (d.confirmed) {
    const srcIntegrity = { ...(source.integrity ?? riskFallback(now)), confirmedBy: a.id };
    const flagged = new Set(source.integrity?.flaggedItems ?? []);
    const cleanSourceItems = source.attempt.items.filter((i) => !flagged.has(i.index));
    ops.push(
      prisma.candidateCategory.create({
        data: { candidateId: a.candidateId, specialization: a.specialization, subcategoryId: a.subcategoryId, grade: a.grade, source: 'test', confirmedAt: now },
      }),
      prisma.testAttempt.update({ where: { id: source.attempt.id }, data: { integrity: asJson(srcIntegrity) } }),
      ...upgradeClaims(a.candidateId, [...new Set([...solvedCatalogIdsOf(a.items, byId), ...solvedCatalogIdsOf(cleanSourceItems, byId)])]),
    );
  }
  await prisma.$transaction(ops);
  return loadAttempt(a.candidateId, a.id);
}

function riskFallback(now: Date): StoredIntegrity {
  return { level: 'high', reasons: [], version: 'unknown', notes: [], lzStar: null, flaggedItems: [], blocking: true, confirmGrade: null, confirmedBy: null, computedAt: now.toISOString() };
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
  // Время не блокирует ответ (решение владельца 11.10): превышение лимита — только сигнал индекса.
  const source = a.kind === 'confirm' ? await confirmSourceOf(a, byId) : null;
  const own = responsesOf(answeredItems, byId);
  const combined = source ? [...source.clean, ...own] : own;
  const est = estimateTheta(combined);
  await prisma.testItem.update({ where: { id: current.id }, data: { answer, correct, thetaAfter: est.theta, seAfter: est.se, answeredAt: now } });
  const updated = await loadAttempt(candidateId, attemptId);
  if (source) {
    const shownIds = new Set(updated.items.map((i) => i.templateId));
    if (confirmShouldStop(own.length, combined, updated.grade, confirmRemaining([...byId.values()], shownIds))) return view(await finalize(updated, now));
    const next = await pushNextItem(updated, est.theta, 'main', now);
    if (!next) return view(await finalize(updated, now));
    return view(await loadAttempt(candidateId, attemptId));
  }
  const step = stepOf(updated, byId);
  if (step.stop) return view(await finalize(updated, now));
  const next = await pushNextItem(updated, est.theta, step.phase, now);
  if (!next) return view(await finalize(updated, now));
  return view(await loadAttempt(candidateId, attemptId));
}

/** Досрочное завершение: решение по уже данным ответам; без ответов — abandoned. */
export async function finishAttempt(candidateId: string, attemptId: string, now: Date = new Date()): Promise<AttemptView> {
  const a = await loadAttempt(candidateId, attemptId);
  assertActive(a, now);
  return view(await finalize(a, now));
}

/**
 * R-C-08: заявленный грейд не подтверждён, грейд ниже (Middle → Junior, Senior → Middle) — по согласию кандидата, в один клик.
 * Индекс честности учтён при финализации: при high попытка уже в needs_confirmation, и грейд ниже выдаёт только
 * подтверждающий тест (integrity.confirmGrade).
 */
export async function confirmJunior(candidateId: string, attemptId: string, now: Date = new Date()): Promise<AttemptView> {
  const a = await loadAttempt(candidateId, attemptId);
  if (a.status === 'needs_confirmation') throw new AppError('needs_confirmation', 'Грейд по этой попытке выдаётся после подтверждающего теста.', 409);
  if (a.status !== 'not_confirmed' || !a.juniorOffered) throw new AppError('junior_not_offered', 'По этой попытке Junior не предлагается.', 409);
  if (a.juniorConfirmedAt) throw new AppError('already_confirmed', 'Junior по этой попытке уже подтверждён.', 409);
  await prisma.$transaction([
    prisma.testAttempt.update({ where: { id: a.id }, data: { juniorConfirmedAt: now } }),
    prisma.candidateCategory.create({
      data: { candidateId, specialization: a.specialization, subcategoryId: a.subcategoryId, grade: lowerGrade(a.grade) ?? 'junior', source: 'test', confirmedAt: now },
    }),
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
    kind: kindOf(a),
    confirmsAttemptId: a.confirmsAttemptId,
    startedAt: a.startedAt.toISOString(),
    finishedAt: a.finishedAt?.toISOString() ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Сигналы браузера (агрегаты, 152-ФЗ: без содержимого вставок и копий)
// ---------------------------------------------------------------------------

/** Потолки накопленных значений за попытку: клиент недоверенный, мусорные числа не раздувают Json. */
export const SIGNAL_TOTAL_CAPS = { tabHidden: 10_000, hiddenMs: ATTEMPT_TTL_HOURS * 60 * MIN_MS, pastes: 10_000, pasteChars: 10_000_000, copies: 10_000 } as const;

/** Прибавить дельты сигналов к активной попытке своего кандидата (атомарно, без потери параллельных отправок). */
export async function recordSignals(candidateId: string, attemptId: string, delta: Partial<BrowserSignals>, now: Date = new Date()): Promise<BrowserSignals> {
  const a = await prisma.testAttempt.findFirst({ where: { id: attemptId, candidateId }, select: { status: true, expiresAt: true } });
  if (!a) throw errors.notFound('Попытка не найдена');
  assertActive(a, now);
  const d = { ...EMPTY_SIGNALS, ...delta };
  const c = SIGNAL_TOTAL_CAPS;
  const updated = await prisma.$executeRaw`
    UPDATE "TestAttempt" SET "signals" = jsonb_build_object(
      'tabHidden', LEAST(COALESCE(("signals"->>'tabHidden')::bigint, 0) + ${d.tabHidden}::int, ${c.tabHidden}::bigint),
      'hiddenMs', LEAST(COALESCE(("signals"->>'hiddenMs')::bigint, 0) + ${d.hiddenMs}::int, ${c.hiddenMs}::bigint),
      'pastes', LEAST(COALESCE(("signals"->>'pastes')::bigint, 0) + ${d.pastes}::int, ${c.pastes}::bigint),
      'pasteChars', LEAST(COALESCE(("signals"->>'pasteChars')::bigint, 0) + ${d.pasteChars}::int, ${c.pasteChars}::bigint),
      'copies', LEAST(COALESCE(("signals"->>'copies')::bigint, 0) + ${d.copies}::int, ${c.copies}::bigint),
      'extendedScreen', COALESCE(("signals"->>'extendedScreen')::boolean, false) OR ${d.extendedScreen}::boolean
    )
    WHERE "id" = ${attemptId} AND "candidateId" = ${candidateId} AND "status" = 'active'`;
  if (updated === 0) throw new AppError('attempt_finished', 'Попытка уже завершена.', 409);
  const row = await prisma.testAttempt.findUnique({ where: { id: attemptId }, select: { signals: true } });
  return parseSignals(row?.signals);
}
