// Подборка по потребности (R-E-03) и поиск по всему банку (R-E-04).
// Загрузка из БД + чистое ранжирование (ranking.ts) + проекция приватности (privacy.ts).
import type { InvitationStatus } from '@prisma/client';

import type { CatalogEntry } from '../claims/types';
import { demoAchievements } from '../collector/fsp-demo';
import { prisma } from '../db';
import { loadCatalog } from '../recommend/evidence';
import type { Grade, Specialization } from '../types';

import { dedupeClaims, toCandidateCard, type CandidateCard, type PublicClaim } from './privacy';
import {
  categoryNeeds,
  effectiveSpecialization,
  dropUncovered,
  rankCandidates,
  type CandidateEvidence,
  type MatchFilters,
  type MatchTarget,
  type RankedCandidate,
} from './ranking';
import type { FspAchievementInput } from './fsp-weight';
import { relaxationHints, type RelaxHint } from './relax';
import { loadDefenseRooms, loadStageEvidence, type DefenseRoomLink } from './stages-load';
import { maskProjectBlock } from './stages';
import { loadTestIntegrity, type PublicTestIntegrity } from './test-integrity';
import { getVacancy, type VacancyView } from './vacancies';

export interface MatchItem extends RankedCandidate {
  rank: number;
  candidate: CandidateCard;
  /** Последнее приглашение этой компании кандидату (по любой потребности) или null. */
  invitation: { id: string; status: InvitationStatus; vacancyId: string | null } | null;
  /**
   * Активная или ожидающая защита (кнопка «Комната защиты»). Только у кандидата, принявшего приглашение
   * (до этого страница комнаты отвечает 404); нет сессии — поля нет.
   */
  defenseRoom?: DefenseRoomLink | null;
  /** Проверка честности попытки, давшей категорию (только уровень и группы); нет попытки или индекса — null. Ранжирование не использует. */
  testIntegrity?: PublicTestIntegrity | null;
}

export interface MatchResult {
  /** null — поиск по банку без потребности. */
  vacancy: VacancyView | null;
  filters: MatchFilters;
  total: number;
  items: MatchItem[];
  /** Подборка под потребность: одиночные ослабления условий и сколько кандидатов они добавят (R-M-04). */
  hints?: RelaxHint[];
}

interface PoolRow {
  evidence: CandidateEvidence;
  name: string;
  email: string;
  contact: string | null;
  claimsPublic: PublicClaim[];
}

/**
 * Пул кандидатов: не скрытые настройкой приватности (R-C-13), с подтверждёнными
 * утверждениями или категорией. Черновики (`proposed`) и отклонённые не считаются.
 */
export async function loadPool(catalog: Map<string, CatalogEntry>): Promise<PoolRow[]> {
  const rows = await prisma.candidate.findMany({
    where: {
      hiddenFromEmployers: false,
      OR: [{ claims: { some: { status: { in: ['confirmed', 'edited'] } } } }, { categories: { some: {} } }],
    },
    select: {
      id: true,
      name: true,
      email: true,
      contact: true,
      specialization: true,
      subcategoryId: true,
      fspState: true,
      categories: { orderBy: [{ confirmedAt: 'desc' }, { id: 'asc' }], take: 1, select: { specialization: true, grade: true, subcategoryId: true } },
      claims: {
        where: { status: { in: ['confirmed', 'edited'] } },
        select: { catalogId: true, level: true, statement: true, quote: true, sourceKind: true },
        orderBy: { id: 'asc' },
      },
    },
    orderBy: { id: 'asc' },
  });
  const stages = await loadStageEvidence(rows.map((r) => r.id));
  const fsp = await loadFspAchievements(rows.filter((r) => r.fspState === 'linked').map((r) => r.id));
  return rows.map((r) => ({
    name: r.name,
    email: r.email,
    contact: r.contact,
    evidence: {
      id: r.id,
      specialization: r.specialization,
      subcategoryId: r.subcategoryId,
      fspState: r.fspState,
      category: r.categories[0] ?? null,
      claims: r.claims,
      ...(r.fspState === 'linked' ? { fspAchievements: fsp.get(r.id) ?? demoAchievements(r.id) } : {}),
      ...(stages.get(r.id)?.calls ? { calls: stages.get(r.id)!.calls } : {}),
      ...(stages.get(r.id)?.projects ? { projects: stages.get(r.id)!.projects } : {}),
    },
    claimsPublic: dedupeClaims(r.claims, catalog),
  }));
}

function parseAchievements(snapshot: unknown): FspAchievementInput[] | null {
  const list = (snapshot as { meta?: { achievements?: unknown } } | null)?.meta?.achievements;
  if (!Array.isArray(list)) return null;
  return list.flatMap((a: unknown) => {
    const x = a as Partial<FspAchievementInput> | null;
    return x && typeof x.event === 'string' && typeof x.result === 'string' && typeof x.year === 'number'
      ? [{ event: x.event, year: x.year, result: x.result, ...(typeof x.role === 'string' ? { role: x.role } : {}) }]
      : [];
  });
}

/**
 * Достижения ФСП из последнего снимка ФСП-источника (Source.snapshot.meta.achievements — форма collector/fsp-demo.ts).
 * Снимка нет — вызывающий берёт тот же детерминированный демо-набор, что выдаёт ФСП-источник по id кандидата.
 */
async function loadFspAchievements(candidateIds: string[]): Promise<Map<string, FspAchievementInput[]>> {
  const out = new Map<string, FspAchievementInput[]>();
  if (candidateIds.length === 0) return out;
  const rows = await prisma.source.findMany({
    where: { candidateId: { in: candidateIds }, kind: 'fsp' },
    select: { candidateId: true, snapshot: true },
    orderBy: [{ fetchedAt: 'desc' }, { id: 'asc' }],
  });
  for (const r of rows) {
    if (out.has(r.candidateId)) continue;
    const list = parseAchievements(r.snapshot);
    if (list) out.set(r.candidateId, list);
  }
  return out;
}

/** Кандидаты, принявшие приглашение этой компании, — им открыты контакты (R-E-07). */
export async function acceptedCandidateIds(companyId: string, candidateIds: string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  const rows = await prisma.invitation.findMany({
    where: { companyId, candidateId: { in: candidateIds }, status: 'accepted' },
    select: { candidateId: true },
  });
  return new Set(rows.map((r) => r.candidateId));
}

async function lastInvitations(companyId: string, candidateIds: string[]) {
  const rows = await prisma.invitation.findMany({
    where: { companyId, candidateId: { in: candidateIds } },
    select: { id: true, candidateId: true, status: true, vacancyId: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  const out = new Map<string, MatchItem['invitation']>();
  for (const r of rows) if (!out.has(r.candidateId)) out.set(r.candidateId, { id: r.id, status: r.status, vacancyId: r.vacancyId });
  return out;
}

async function run(
  companyId: string,
  catalog: Map<string, CatalogEntry>,
  target: MatchTarget | ((c: CandidateEvidence) => MatchTarget | null),
  filters: MatchFilters,
  limit: number,
  requireCoverage = false,
): Promise<{ total: number; items: MatchItem[]; hints?: RelaxHint[] }> {
  const pool = await loadPool(catalog);
  const byId = new Map(pool.map((p) => [p.evidence.id, p]));
  const all = rankCandidates(pool.map((p) => p.evidence), target, catalog, filters);
  const ranked = requireCoverage ? dropUncovered(all) : all;
  const top = ranked.slice(0, limit);
  const ids = top.map((r) => r.candidateId);
  const [accepted, invites] = await Promise.all([acceptedCandidateIds(companyId, ids), lastInvitations(companyId, ids)]);
  const rooms = await loadDefenseRooms(companyId, [...accepted]);
  const integrity = await loadTestIntegrity(new Map(top.map((r) => [r.candidateId, byId.get(r.candidateId)!.evidence.category])));
  const items = top.map((r, i) => {
    const p = byId.get(r.candidateId)!;
    const candidate = toCandidateCard(
      {
        id: p.evidence.id,
        name: p.name,
        email: p.email,
        contact: p.contact,
        specialization: p.evidence.specialization,
        fspState: p.evidence.fspState,
        category: p.evidence.category,
        claims: p.claimsPublic,
      },
      accepted.has(r.candidateId),
    );
    // R-C-16: пояснения рубрики проекта до принятого приглашения проходят maskContacts.
    const explanation =
      r.explanation.project && !accepted.has(r.candidateId) ? { ...r.explanation, project: maskProjectBlock(r.explanation.project) } : r.explanation;
    return { ...r, explanation, rank: i + 1, candidate, invitation: invites.get(r.candidateId) ?? null, defenseRoom: rooms.get(r.candidateId) ?? null, testIntegrity: integrity.get(r.candidateId) ?? null };
  });
  // R-M-04: подсказки ослабления — только для подборки под потребность (одна цель на всех).
  const hints = requireCoverage && typeof target !== 'function' ? relaxationHints(pool.map((p) => p.evidence), target, catalog, filters) : undefined;
  return { total: ranked.length, items, ...(hints ? { hints } : {}) };
}

/** Подборка под свою потребность. Чужая — 404. */
export async function matchForVacancy(companyId: string, vacancyId: string, filters: MatchFilters, limit: number): Promise<MatchResult> {
  const vacancy = await getVacancy(companyId, vacancyId);
  const catalog = await loadCatalog();
  const target: MatchTarget = {
    vacancyId: vacancy.id,
    specialization: vacancy.specialization,
    subcategoryId: vacancy.subcategoryId,
    grade: vacancy.grade,
    needs: vacancy.needs,
    stack: vacancy.stack,
  };
  const r = await run(companyId, catalog, target, filters, limit, true);
  return { vacancy, filters, ...r };
}

/**
 * Поиск по всему банку без потребности: цель — сигнатура категории из каталога
 * (специализация и грейд из фильтра, иначе — свои у каждого кандидата; без
 * категории грейд — Junior).
 */
export async function searchBank(companyId: string, filters: MatchFilters, limit: number): Promise<MatchResult> {
  const catalog = await loadCatalog();
  const cache = new Map<string, MatchTarget>();
  const targetFor = (c: CandidateEvidence): MatchTarget | null => {
    const spec: Specialization | null = filters.specialization ?? effectiveSpecialization(c);
    if (!spec) return null;
    const grade: Grade = filters.grade ?? c.category?.grade ?? 'junior';
    const key = `${spec}:${grade}`;
    if (!cache.has(key)) {
      cache.set(key, { specialization: spec, subcategoryId: filters.subcategory ?? null, grade, needs: categoryNeeds(catalog, spec, grade), stack: filters.stack ?? [] });
    }
    return cache.get(key)!;
  };
  const r = await run(companyId, catalog, targetFor, filters, limit);
  return { vacancy: null, filters, ...r };
}
