// Проекция выдачи подбора (employer/matching.ts) в карточку помощника. Граница доверия:
// из MatchItem берутся только публичные поля; имя и контакты (candidate.contacts,
// displayName после принятия) не копируются — вместо имени всегда псевдоним.
import { z } from 'zod';

import { SPECIALIZATIONS } from '@/lib/directions';
import type { MatchItem, MatchResult } from '@/server/employer/matching';
import { pseudonym } from '@/server/employer/privacy';

import type { AssistantCandidate, CandidatesBlock } from './types';

export function toAssistantCandidate(item: MatchItem): AssistantCandidate {
  const c = item.candidate;
  const ex = item.explanation;
  const typeByStatement = new Map(c.claims.map((cl) => [cl.statement, cl.sourceType]));
  return {
    candidateId: c.id,
    alias: pseudonym(c.id),
    rank: item.rank,
    score: item.score,
    category: c.category?.label ?? null,
    specialization: c.specialization,
    fsp: c.fsp.hasAchievements,
    covered: item.covered,
    total: item.total,
    coveredItems: ex.covered.map((i) => ({ statement: i.statement, level: i.level, sourceType: typeByStatement.get(i.statement) ?? null })),
    missing: ex.missing,
    stackMatched: ex.stackMatched,
    summary: ex.summary,
    invitation: item.invitation?.status ?? null,
  };
}

export function toCandidatesBlock(r: MatchResult): CandidatesBlock {
  return {
    vacancy: r.vacancy ? { id: r.vacancy.id, title: r.vacancy.title, salaryFrom: r.vacancy.salaryFrom, salaryTo: r.vacancy.salaryTo } : null,
    total: r.total,
    items: r.items.map(toAssistantCandidate),
  };
}

const Level = z.enum(['self_reported', 'artifact', 'platform', 'third_party']);
const SourceType = z.enum(['github', 'codeforces', 'stackoverflow', 'article', 'fsp']).nullable();

/** Схема карточки: `.strict()` — лишнее поле (имя, почта, цитата) роняет проверку выхода инструмента. */
export const AssistantCandidateSchema = z
  .object({
    candidateId: z.string(),
    alias: z.string(),
    rank: z.number().int(),
    score: z.number(),
    category: z.string().nullable(),
    specialization: z.enum(SPECIALIZATIONS).nullable(),
    fsp: z.boolean(),
    covered: z.number().int(),
    total: z.number().int(),
    coveredItems: z.array(z.object({ statement: z.string(), level: Level, sourceType: SourceType }).strict()),
    missing: z.array(z.string()),
    stackMatched: z.array(z.string()),
    summary: z.string(),
    invitation: z.enum(['sent', 'viewed', 'accepted', 'declined', 'hired', 'withdrawn']).nullable(),
  })
  .strict();

export const CandidatesBlockSchema = z
  .object({
    vacancy: z.object({ id: z.string(), title: z.string(), salaryFrom: z.number(), salaryTo: z.number() }).nullable(),
    total: z.number().int(),
    items: z.array(AssistantCandidateSchema),
  })
  .strict();
