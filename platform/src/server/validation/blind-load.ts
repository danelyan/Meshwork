// Загрузка для слепой разметки (blind.ts): демо-вакансии, наш топ (тот же matchForVacancy, что в кабинете),
// топ BM25 по тому же пулу (loadPool), случайные. Анонимная проекция карточки: без имени, id, баллов и объяснений.
import 'server-only';

import { categoryLabel, matchStack } from '@/server/employer/ranking';
import { loadPool, matchForVacancy } from '@/server/employer/matching';
import { getVacancy } from '@/server/employer/vacancies';
import { loadCatalog } from '@/server/recommend/evidence';
import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import type { EvidenceLevel } from '@/server/claims/types';

import { bm25Rank } from './bm25';
import { BLIND_TOP, blindTokenFor, profileText, selectBlindCards, vacancyText } from './blind';

export interface BlindVacancyItem {
  id: string;
  title: string;
  specialization: string;
  grade: string;
  needsCount: number;
}

/** Демо-вакансии (компании isDemo), не архивные, без E2E-мусора. */
export async function listBlindVacancies(): Promise<BlindVacancyItem[]> {
  const rows = await prisma.vacancy.findMany({
    where: { archivedAt: null, company: { isDemo: true }, NOT: { title: { contains: 'E2E', mode: 'insensitive' } } },
    select: { id: true, title: true, specialization: true, grade: true, needs: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => ({ id: r.id, title: r.title, specialization: r.specialization, grade: r.grade, needsCount: Array.isArray(r.needs) ? r.needs.length : 0 }));
}

export interface BlindCard {
  key: string;
  category: { label: string } | null;
  specialization: string | null;
  fsp: boolean;
  stack: string[];
  claims: { statement: string; evidence: EvidenceLevel }[];
}

export interface BlindStart {
  token: string;
  vacancy: { id: string; title: string; specialization: string; grade: string; needs: { statement: string; weight: number }[]; stack: string[] };
  cards: BlindCard[];
}

export async function startBlind(vacancyId: string, secret: string): Promise<BlindStart> {
  const v = await prisma.vacancy.findFirst({
    where: { id: vacancyId, archivedAt: null, company: { isDemo: true } },
    select: { companyId: true },
  });
  if (!v || !v.companyId) throw errors.notFound('Демо-вакансия не найдена');
  const vacancy = await getVacancy(v.companyId, vacancyId);
  const catalog = await loadCatalog();
  const needs = vacancy.needs.map((n) => ({ statement: catalog.get(n.catalogId)?.statement ?? n.catalogId, weight: n.weight }));

  const [ours, pool] = await Promise.all([matchForVacancy(v.companyId, vacancyId, {}, BLIND_TOP), loadPool(catalog, v.companyId)]);
  if (pool.length === 0) throw errors.notFound('В базе нет кандидатов для разметки');
  const byId = new Map(pool.map((p) => [p.evidence.id, p]));
  const stackOf = (id: string) => matchStack(byId.get(id)?.evidence.claims ?? [], vacancy.stack);
  const labelOf = (id: string) => {
    const c = byId.get(id)?.evidence.category;
    return c ? categoryLabel(c) : null;
  };
  const docs = pool.map((p) => ({
    id: p.evidence.id,
    text: profileText({ statements: p.claimsPublic.map((c) => c.statement), stack: stackOf(p.evidence.id), category: labelOf(p.evidence.id), specialization: p.evidence.specialization }),
  }));
  const bm25 = bm25Rank(docs, vacancyText({ title: vacancy.title, needs: needs.map((n) => n.statement), stack: vacancy.stack }))
    .filter((r) => r.score > 0)
    .map((r) => r.id);
  // Наш топ — только кандидаты, которые есть в пуле (matchForVacancy дополнительно убирает нанятых другой компанией).
  const oursIds = ours.items.map((i) => i.candidateId).filter((id) => byId.has(id));
  const picks = selectBlindCards(oursIds, bm25, [...byId.keys()]);
  if (picks.length === 0) throw errors.notFound('Для этой вакансии нет кандидатов для разметки');

  const cards: BlindCard[] = picks.map((p) => {
    const row = byId.get(p.candidateId)!;
    const label = labelOf(p.candidateId);
    return {
      key: p.key,
      category: label ? { label } : null,
      specialization: row.evidence.specialization,
      fsp: row.evidence.fspState === 'linked',
      stack: stackOf(p.candidateId),
      claims: row.claimsPublic.map((c) => ({ statement: c.statement, evidence: c.level })),
    };
  });
  return {
    token: blindTokenFor(vacancyId, picks, secret),
    vacancy: { id: vacancy.id, title: vacancy.title, specialization: vacancy.specialization, grade: vacancy.grade, needs, stack: vacancy.stack },
    cards,
  };
}
