import { notBlockedCandidateWhere } from '@/server/admin/accounts/state';
import { assertEmployerConsents } from '@/server/consent/service';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import type { SessionPrincipal } from '@/server/session';
import { loadCatalog } from '@/server/recommend/evidence';
import { acceptedCandidateIds } from '@/server/employer/matching';
import { dedupeClaims, toCandidateCard } from '@/server/employer/privacy';

export const FavoriteInput = z.object({ kind: z.enum(['vacancy', 'candidate']), targetId: z.string().min(1).max(100), saved: z.boolean() }).strict();
export type FavoriteKind = z.infer<typeof FavoriteInput>['kind'];
export type FavoriteOwner = SessionPrincipal & { userId: string };

export function favoriteKind(role: SessionPrincipal['role']): FavoriteKind {
  if (role === 'candidate') return 'vacancy';
  if (role === 'employer') return 'candidate';
  throw errors.forbidden('Избранное доступно после выбора роли');
}

/** Read ownership from the account, never from a request body or a target ID. */
async function ownerContext(owner: FavoriteOwner) {
  const user = await prisma.user.findUnique({ where: { id: owner.userId }, select: { role: true, candidateId: true, employerProfile: { select: { id: true, companyId: true } } } });
  if (!user || user.role !== owner.role) throw errors.sessionStale();
  const kind = favoriteKind(user.role);
  if ((kind === 'vacancy' && !user.candidateId) || (kind === 'candidate' && !user.employerProfile)) throw errors.forbidden('Сначала создай профиль');
  // ADR 0005: избранные кандидаты — данные кандидатов, работодателю они открыты после оферты и обязательства
  if (kind === 'candidate') await assertEmployerConsents(owner.userId);
  return { kind, companyId: user.employerProfile?.companyId ?? null };
}

export async function listFavorites(owner: FavoriteOwner) {
  const { kind } = await ownerContext(owner);
  if (kind === 'vacancy') {
    const rows = await prisma.userSavedVacancy.findMany({ where: { userId: owner.userId }, select: { vacancyId: true }, orderBy: [{ createdAt: 'desc' }, { vacancyId: 'asc' }] });
    return { kind, ids: rows.map((row) => row.vacancyId) };
  }
  const rows = await prisma.userSavedCandidate.findMany({ where: { userId: owner.userId }, select: { candidateId: true }, orderBy: [{ createdAt: 'desc' }, { candidateId: 'asc' }] });
  return { kind, ids: rows.map((row) => row.candidateId) };
}

export async function setFavorite(owner: FavoriteOwner, input: z.infer<typeof FavoriteInput>) {
  const { kind } = await ownerContext(owner);
  if (input.kind !== kind) throw errors.forbidden('Этот вид избранного недоступен текущей роли');
  const userId = owner.userId;
  if (kind === 'vacancy') {
    if (input.saved) {
      const target = await prisma.vacancy.findFirst({ where: { id: input.targetId, archivedAt: null }, select: { id: true } });
      if (!target) throw errors.notFound('Вакансия недоступна');
      await prisma.userSavedVacancy.upsert({ where: { userId_vacancyId: { userId, vacancyId: target.id } }, create: { userId, vacancyId: target.id }, update: {} });
    } else await prisma.userSavedVacancy.deleteMany({ where: { userId, vacancyId: input.targetId } });
  } else {
    if (input.saved) {
      const target = await prisma.candidate.findFirst({ where: { id: input.targetId, hiddenFromEmployers: false, OR: [{ claims: { some: { status: { in: ['confirmed', 'edited'] } } } }, { categories: { some: {} } }] }, select: { id: true } });
      if (!target) throw errors.notFound('Кандидат недоступен');
      await prisma.userSavedCandidate.upsert({ where: { userId_candidateId: { userId, candidateId: target.id } }, create: { userId, candidateId: target.id }, update: {} });
    } else await prisma.userSavedCandidate.deleteMany({ where: { userId, candidateId: input.targetId } });
  }
  return listFavorites(owner);
}

/** Direct saved-ID lookup: no search result limit; privacy is re-evaluated on every read. */
export async function savedCandidateCards(owner: FavoriteOwner) {
  const { kind, companyId } = await ownerContext(owner);
  if (kind !== 'candidate' || !companyId) throw errors.forbidden();
  const saved = await prisma.userSavedCandidate.findMany({ where: { userId: owner.userId }, select: { candidateId: true }, orderBy: [{ createdAt: 'desc' }, { candidateId: 'asc' }] });
  const ids = saved.map((row) => row.candidateId);
  if (!ids.length) return { cards: [], unavailable: 0 };
  const rows = await prisma.candidate.findMany({
    where: { id: { in: ids }, hiddenFromEmployers: false, AND: [notBlockedCandidateWhere()], OR: [{ claims: { some: { status: { in: ['confirmed', 'edited'] } } } }, { categories: { some: {} } }] },
    select: { id: true, name: true, email: true, contact: true, specialization: true, fspState: true,
      categories: { orderBy: [{ confirmedAt: 'desc' }, { id: 'asc' }], take: 1, select: { specialization: true, grade: true } },
      claims: { where: { status: { in: ['confirmed', 'edited'] } }, select: { catalogId: true, statement: true, level: true, sourceKind: true }, orderBy: { id: 'asc' } },
    },
  });
  const [accepted, catalog] = await Promise.all([acceptedCandidateIds(companyId, ids), loadCatalog()]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const cards = ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toCandidateCard({ ...row, category: row.categories[0] ?? null, claims: dedupeClaims(row.claims, catalog) }, accepted.has(id))] : [];
  });
  return { cards, unavailable: ids.length - cards.length };
}
