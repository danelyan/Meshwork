// Подборка по потребности (R-E-03) и поиск по всему банку (R-E-04).
// Загрузка из БД + чистое ранжирование (ranking.ts) + проекция приватности (privacy.ts).
import type { InvitationStatus } from '@prisma/client';

import type { CatalogEntry } from '../claims/types';
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
import { getVacancy, type VacancyView } from './vacancies';

export interface MatchItem extends RankedCandidate {
  rank: number;
  candidate: CandidateCard;
  /** Последнее приглашение этой компании кандидату (по любой потребности) или null. */
  invitation: { id: string; status: InvitationStatus; vacancyId: string | null } | null;
}

export interface MatchResult {
  /** null — поиск по банку без потребности. */
  vacancy: VacancyView | null;
  filters: MatchFilters;
  total: number;
  items: MatchItem[];
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
      fspState: true,
      categories: { orderBy: [{ confirmedAt: 'desc' }, { id: 'asc' }], take: 1, select: { specialization: true, grade: true } },
      claims: {
        where: { status: { in: ['confirmed', 'edited'] } },
        select: { catalogId: true, level: true, statement: true, quote: true, sourceKind: true },
        orderBy: { id: 'asc' },
      },
    },
    orderBy: { id: 'asc' },
  });
  return rows.map((r) => ({
    name: r.name,
    email: r.email,
    contact: r.contact,
    evidence: {
      id: r.id,
      specialization: r.specialization,
      fspState: r.fspState,
      category: r.categories[0] ?? null,
      claims: r.claims,
    },
    claimsPublic: dedupeClaims(r.claims, catalog),
  }));
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
): Promise<{ total: number; items: MatchItem[] }> {
  const pool = await loadPool(catalog);
  const byId = new Map(pool.map((p) => [p.evidence.id, p]));
  const all = rankCandidates(pool.map((p) => p.evidence), target, catalog, filters);
  const ranked = requireCoverage ? dropUncovered(all) : all;
  const top = ranked.slice(0, limit);
  const ids = top.map((r) => r.candidateId);
  const [accepted, invites] = await Promise.all([acceptedCandidateIds(companyId, ids), lastInvitations(companyId, ids)]);
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
    return { ...r, rank: i + 1, candidate, invitation: invites.get(r.candidateId) ?? null };
  });
  return { total: ranked.length, items };
}

/** Подборка под свою потребность. Чужая — 404. */
export async function matchForVacancy(companyId: string, vacancyId: string, filters: MatchFilters, limit: number): Promise<MatchResult> {
  const vacancy = await getVacancy(companyId, vacancyId);
  const catalog = await loadCatalog();
  const target: MatchTarget = { specialization: vacancy.specialization, grade: vacancy.grade, needs: vacancy.needs, stack: vacancy.stack };
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
    if (!cache.has(key)) cache.set(key, { specialization: spec, grade, needs: categoryNeeds(catalog, spec, grade), stack: filters.stack ?? [] });
    return cache.get(key)!;
  };
  const r = await run(companyId, catalog, targetFor, filters, limit);
  return { vacancy: null, filters, ...r };
}
