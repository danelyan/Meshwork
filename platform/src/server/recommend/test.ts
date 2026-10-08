import type { CatalogEntry } from '../claims/types';
import { prisma } from '../db';
import type { Grade, Specialization } from '../types';

import { assertCandidate, loadCatalog } from './evidence';
import { NO_CONFIRMED_REASON, type TestRecommendation } from './types';
import { GRADE_CHANGE_INTERVAL_DAYS, gradeWeight, MIDDLE_IF_SURE_THRESHOLD, MIDDLE_THRESHOLD } from './weights';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Сигнатура Middle (claims-catalog § 7): записи специализации и общие, у которых
 * вес M ≥ 2 и вес M больше веса J (J нет — считается 0). В возвращаемых записях
 * `weight` — вес M: по нему считается покрытие сигнатуры.
 */
export function middleSignature(catalog: Map<string, CatalogEntry>, spec: Specialization): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const e of catalog.values()) {
    if (e.specialization !== spec && e.specialization !== 'common') continue;
    const m = gradeWeight(e, spec, 'middle');
    const j = gradeWeight(e, spec, 'junior') ?? 0;
    if (m !== null && m >= 2 && (e.weights ? m > j : true)) {
      out.push({ ...e, weight: Math.min(3, m) as 1 | 2 | 3 });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function inferSpecialization(catalogIds: string[]): Specialization | null {
  const be = catalogIds.filter((id) => id.startsWith('be.')).length;
  const fe = catalogIds.filter((id) => id.startsWith('fe.')).length;
  if (be === fe) return null;
  return be > fe ? 'backend' : 'frontend';
}

export interface TestDecision {
  grade: Grade;
  coverage: number;
  reason: string;
}

/** Чистое правило: покрытие сигнатуры → грейд. Только рекомендация, выбор за кандидатом (R-C-05). */
export function decideGrade(signature: CatalogEntry[], claimed: Set<string>): TestDecision {
  const total = signature.reduce((s, e) => s + e.weight, 0);
  const have = signature.filter((e) => claimed.has(e.id));
  const cov = total > 0 ? have.reduce((s, e) => s + e.weight, 0) / total : 0;
  const lacking = signature
    .filter((e) => !claimed.has(e.id))
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((e) => e.statement);
  const pct = Math.round(cov * 100);
  const lackText = lacking.length ? ` Для Middle не хватает заявленных: ${lacking.join('; ')}.` : '';
  if (cov >= MIDDLE_THRESHOLD) {
    return { grade: 'middle', coverage: cov, reason: `Заявлено ${pct}% того, что отличает Middle, — предлагаем тест Middle.${lackText}` };
  }
  if (cov >= MIDDLE_IF_SURE_THRESHOLD) {
    return { grade: 'junior', coverage: cov, reason: `Заявлено ${pct}% того, что отличает Middle, — предлагаем Junior; Middle — если уверены.${lackText}` };
  }
  return { grade: 'junior', coverage: cov, reason: `Заявлено ${pct}% того, что отличает Middle, — предлагаем Junior.${lackText}` };
}

export async function recommendTest(candidateId: string, now: Date = new Date()): Promise<TestRecommendation> {
  const candidate = await assertCandidate(candidateId);
  const [catalog, claims, last] = await Promise.all([
    loadCatalog(),
    prisma.claim.findMany({ where: { candidateId, status: { in: ['confirmed', 'edited'] } }, select: { catalogId: true } }),
    prisma.candidateCategory.findFirst({ where: { candidateId }, orderBy: { confirmedAt: 'desc' } }),
  ]);
  // В профиль пишет только кандидат: черновики proposed — ещё не его утверждения, в покрытие не идут.
  const claimed = new Set(claims.map((c) => c.catalogId));
  const specialization =
    candidate.specialization ?? last?.specialization ?? inferSpecialization([...claimed]) ?? 'backend';
  if (claimed.size === 0 && !last) {
    return { specialization, grade: 'junior', reason: NO_CONFIRMED_REASON, allowed: true };
  }
  const decision = decideGrade(middleSignature(catalog, specialization), claimed);

  let grade = decision.grade;
  let reason = decision.reason;
  // R-C-08: рекомендация не понижает уже подтверждённый тестом грейд; пересдача — выбор кандидата.
  if (last && last.grade === 'middle' && grade === 'junior') {
    grade = 'middle';
    reason = `Текущая категория — Middle, понижение не навязываем; пересдать можно в любой грейд. ${decision.reason}`;
  }

  // R-C-09 [предложение: 30 дней]: смена грейда не чаще интервала; пересдача того же грейда — без ограничения.
  let allowed = true;
  let nextAllowedAt: string | undefined;
  if (last && last.grade !== grade) {
    const next = new Date(last.confirmedAt.getTime() + GRADE_CHANGE_INTERVAL_DAYS * DAY_MS);
    if (now < next) {
      allowed = false;
      nextAllowedAt = next.toISOString();
      reason += ` Грейд можно сменить не чаще раза в ${GRADE_CHANGE_INTERVAL_DAYS} дней.`;
    }
  }
  return { specialization, grade, reason, allowed, ...(nextAllowedAt ? { nextAllowedAt } : {}) };
}
