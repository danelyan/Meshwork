import type { Claim, ClaimStatus as DbClaimStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../db';
import { errors } from '../errors';
import { syncClaimCatalog } from './catalog-sync';
import { LEVEL_ORDER, levelRank, maxLevelFor } from './levels';
import type { EvidenceLevel, ProfileClaim, ProfileView, VerifiedClaim } from './types';

const ACTIVE: DbClaimStatus[] = ['proposed', 'confirmed', 'edited'];
const CLAIM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Формулировка после правки кандидатом. */
export const StatementSchema = z.string().trim().min(3, 'Слишком коротко').max(300, 'Не длиннее 300 символов');

async function ensureCandidate(candidateId: string) {
  const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!c) throw errors.notFound('Кандидат не найден');
  return c;
}

/** ClaimCatalog пуст (сид не прогнан) – загрузить из файла: иначе FK на catalogId роняет запись. */
async function ensureCatalog(): Promise<Set<string>> {
  let rows = await prisma.claimCatalog.findMany({ select: { id: true } });
  if (rows.length === 0) {
    await syncClaimCatalog(prisma);
    rows = await prisma.claimCatalog.findMany({ select: { id: true } });
  }
  return new Set(rows.map((r) => r.id));
}

/**
 * Черновики карточек (status proposed) из проверенных утверждений.
 *  - catalogId, который кандидат раньше отклонил, не предлагается снова;
 *  - уже есть активное утверждение с уровнем не ниже – пропуск;
 *  - новое доказательство выше уровнем: есть черновик – он обновляется, иначе создаётся новый
 *    черновик (подтверждённое не меняется без клика кандидата);
 *  - уровень `platform` сюда не принимается (его дают только тест и защита), а уровень выше
 *    максимума для типа источника – ошибка вызывающего.
 * Возвращает созданные и обновлённые черновики.
 */
export async function proposeClaims(
  candidateId: string,
  verified: VerifiedClaim[],
  opts?: { sourceId?: string },
): Promise<Claim[]> {
  await ensureCandidate(candidateId);
  for (const v of verified) {
    if (v.level === 'platform') throw errors.badRequest('Уровень platform дают только тест и защита');
    const cap = maxLevelFor(v.sourceKind, { ownershipVerified: true });
    if (levelRank(v.level) > levelRank(cap)) throw errors.badRequest(`Уровень ${v.level} выше допустимого для ${v.sourceKind}`);
  }
  const known = await ensureCatalog();
  const ids = [...new Set(verified.map((v) => v.catalogId))];
  return prisma.$transaction(async (tx) => {
    const existing = await tx.claim.findMany({ where: { candidateId, catalogId: { in: ids } } });
    const out: Claim[] = [];
    for (const v of verified) {
      if (!known.has(v.catalogId)) continue;
      const same = existing.filter((c) => c.catalogId === v.catalogId);
      if (same.some((c) => c.status === 'rejected')) continue;
      const active = same.filter((c) => ACTIVE.includes(c.status));
      const top = Math.max(-1, ...active.map((c) => levelRank(c.level)));
      if (levelRank(v.level) <= top) continue;
      const data = {
        statement: v.statement,
        wording: v.wording ?? null,
        level: v.level,
        quote: v.quote,
        sourceRef: v.sourceRef,
        sourceKind: v.sourceKind,
        sourceId: opts?.sourceId ?? null,
        confidence: v.confidence,
        limits: v.limits,
        suggestedProof: v.suggestedProof,
      };
      const draft = active.find((c) => c.status === 'proposed');
      const row = draft
        ? await tx.claim.update({ where: { id: draft.id }, data })
        : await tx.claim.create({ data: { candidateId, catalogId: v.catalogId, status: 'proposed', ...data } });
      existing.push(row);
      if (draft) existing.splice(existing.indexOf(draft), 1);
      out.push(row);
    }
    return out;
  });
}

function assertClaimId(claimId: string) {
  if (!CLAIM_ID_RE.test(claimId)) throw errors.notFound('Утверждение не найдено');
}

/** Утверждение кандидата или 404 (чужое неотличимо от несуществующего). */
async function ownClaim(candidateId: string, claimId: string): Promise<Claim> {
  assertClaimId(claimId);
  const c = await prisma.claim.findFirst({ where: { id: claimId, candidateId } });
  if (!c) throw errors.notFound('Утверждение не найдено');
  return c;
}

/**
 * Переход атомарно: updateMany с условием на владельца и исходный статус, затем чтение.
 * Отклонённое не оживает (409); повторный confirm/reject – идемпотентен.
 */
export async function confirmClaim(candidateId: string, claimId: string): Promise<Claim> {
  assertClaimId(claimId);
  await prisma.claim.updateMany({
    where: { id: claimId, candidateId, status: 'proposed' },
    data: { status: 'confirmed', confirmedAt: new Date() },
  });
  const c = await ownClaim(candidateId, claimId);
  if (c.status === 'rejected') throw errors.conflict('Утверждение отклонено');
  return c;
}

export type BatchSkipReason = 'not_found' | 'rejected' | 'already_confirmed' | 'not_self_reported';
export interface ConfirmBatchResult {
  confirmed: string[];
  skipped: { id: string; reason: BatchSkipReason }[];
}

/**
 * Пакетное «подтвердить со слов»: одна транзакция, только свои `proposed` уровня self_reported.
 * Чужие и несуществующие id → not_found (не выдаём факт существования); артефакты пакетом не
 * подтверждаются. Повтор идемпотентен: уже подтверждённые попадают в skipped.
 */
export async function confirmClaimsBatch(candidateId: string, ids: string[]): Promise<ConfirmBatchResult> {
  const unique = [...new Set(ids)];
  return prisma.$transaction(async (tx) => {
    const rows = await tx.claim.findMany({ where: { id: { in: unique.filter((i) => CLAIM_ID_RE.test(i)) }, candidateId } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const result: ConfirmBatchResult = { confirmed: [], skipped: [] };
    const toConfirm: string[] = [];
    for (const id of unique) {
      const c = byId.get(id);
      if (!c) result.skipped.push({ id, reason: 'not_found' });
      else if (c.status === 'rejected') result.skipped.push({ id, reason: 'rejected' });
      else if (c.status !== 'proposed') result.skipped.push({ id, reason: 'already_confirmed' });
      else if (c.level !== 'self_reported') result.skipped.push({ id, reason: 'not_self_reported' });
      else toConfirm.push(id);
    }
    if (toConfirm.length) {
      await tx.claim.updateMany({
        where: { id: { in: toConfirm }, candidateId, status: 'proposed', level: 'self_reported' },
        data: { status: 'confirmed', confirmedAt: new Date() },
      });
      result.confirmed = toConfirm;
    }
    return result;
  });
}

/**
 * Меняется только формулировка (и статус → edited); уровень, цитата и источник – нет. Правка = подтверждение.
 * Кандидат правит то, что видит (`wording`); `statement` получает тот же текст, как и до появления wording –
 * ранжирование, созвон и работодатель видят правку так же, как раньше.
 */
export async function editClaim(candidateId: string, claimId: string, statement: string): Promise<Claim> {
  assertClaimId(claimId);
  const text = StatementSchema.parse(statement);
  await prisma.claim.updateMany({
    where: { id: claimId, candidateId, status: { in: ACTIVE } },
    data: { statement: text, wording: text, status: 'edited' },
  });
  await prisma.claim.updateMany({
    where: { id: claimId, candidateId, status: 'edited', confirmedAt: null },
    data: { confirmedAt: new Date() },
  });
  const c = await ownClaim(candidateId, claimId);
  if (c.status === 'rejected') throw errors.conflict('Утверждение отклонено');
  return c;
}

/** Отклонить (из любого активного статуса). Этот catalogId кандидату больше не предлагается. */
export async function rejectClaim(candidateId: string, claimId: string): Promise<Claim> {
  assertClaimId(claimId);
  await prisma.claim.updateMany({
    where: { id: claimId, candidateId, status: { in: ACTIVE } },
    data: { status: 'rejected' },
  });
  return ownClaim(candidateId, claimId);
}

function toProfileClaim(c: Claim): ProfileClaim {
  return {
    id: c.id,
    catalogId: c.catalogId,
    statement: c.statement,
    wording: c.wording,
    level: c.level,
    quote: c.quote,
    sourceRef: c.sourceRef,
    sourceKind: c.sourceKind,
    limits: c.limits,
    suggestedProof: Array.isArray(c.suggestedProof) ? (c.suggestedProof as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    confirmedAt: c.confirmedAt ? c.confirmedAt.toISOString() : null,
  };
}

const byLevelThenNewest = (a: Claim, b: Claim) =>
  levelRank(b.level) - levelRank(a.level) || b.createdAt.getTime() - a.createdAt.getTime();

/**
 * Профиль для самого кандидата: подтверждённые и черновики (status показывает, что ждёт клика).
 * По catalogId – лучшее подтверждённое (выше уровень, новее) и черновик, только если он выше уровнем.
 */
export async function getProfile(candidateId: string): Promise<ProfileView> {
  const cand = await ensureCandidate(candidateId);
  const [cat, rows] = await Promise.all([
    prisma.candidateCategory.findFirst({ where: { candidateId }, orderBy: { confirmedAt: 'desc' } }),
    prisma.claim.findMany({ where: { candidateId, status: { in: ACTIVE } } }),
  ]);
  const groups = new Map<string, Claim[]>();
  for (const r of rows) groups.set(r.catalogId, [...(groups.get(r.catalogId) ?? []), r]);
  const shown: Claim[] = [];
  for (const g of groups.values()) {
    g.sort(byLevelThenNewest);
    const confirmed = g.find((c) => c.status !== 'proposed');
    if (confirmed) shown.push(confirmed);
    const draft = g.find((c) => c.status === 'proposed' && (!confirmed || levelRank(c.level) > levelRank(confirmed.level)));
    if (draft) shown.push(draft);
  }
  shown.sort(byLevelThenNewest);
  const claims = shown.map(toProfileClaim);
  const byLevel = Object.fromEntries(LEVEL_ORDER.map((l) => [l, claims.filter((c) => c.level === l)])) as Record<
    EvidenceLevel,
    ProfileClaim[]
  >;
  return {
    candidate: { id: cand.id, name: cand.name, specialization: cand.specialization, fspState: cand.fspState },
    category: cat ? { specialization: cat.specialization, grade: cat.grade, confirmedAt: cat.confirmedAt.toISOString() } : null,
    claims,
    byLevel,
  };
}

/**
 * Только подтверждённые кандидатом (confirmed | edited) – то, что можно показывать работодателю
 * и считать в покрытии. Черновики сюда не попадают никогда («ни одного в профиле без клика»).
 */
export async function getConfirmedClaims(candidateId: string): Promise<ProfileClaim[]> {
  const p = await getProfile(candidateId);
  return p.claims.filter((c) => c.status === 'confirmed' || c.status === 'edited');
}
