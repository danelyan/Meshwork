// Что работодатель видит о кандидате (R-E-07, R-C-13, R-C-16). Решает сервер:
// до принятия приглашения — только публичная часть, контакты и имя скрыты.
import { createHash } from 'node:crypto';

import { levelRank } from '../claims/levels';
import type { CatalogEntry, EvidenceLevel } from '../claims/types';
import type { FspState, Grade, Specialization } from '../types';

import { categoryLabel } from './ranking';

/** Тип источника для работодателя (R-E-07): без ссылки, цитаты и имён. */
export type PublicSourceType = 'github' | 'codeforces' | 'stackoverflow' | 'article' | 'fsp';

/** Тип источника показывается только у утверждений выше «со слов»: резюме, документ и чат наружу не светим. */
export function publicSourceType(kind: string | null | undefined, level: EvidenceLevel): PublicSourceType | null {
  if (level !== 'artifact' && level !== 'third_party') return null;
  switch (kind) {
    case 'github':
    case 'codeforces':
    case 'stackoverflow':
    case 'fsp':
      return kind;
    case 'url':
      return 'article';
    default:
      return null;
  }
}

export interface PublicClaim {
  catalogId: string;
  /** Формулировка каталога, не текст кандидата: в правке кандидат мог написать что угодно. */
  statement: string;
  level: EvidenceLevel;
  /** null — тип не раскрывается (со слов, платформа). */
  sourceType: PublicSourceType | null;
}

export interface CandidateCard {
  id: string;
  /** «Кандидат #A1B2C3» до принятия, имя после. */
  displayName: string;
  specialization: Specialization | null;
  category: { specialization: Specialization; grade: Grade; label: string } | null;
  fsp: { state: FspState; hasAchievements: boolean };
  claims: PublicClaim[];
  /** null — контакты скрыты (приглашение не принято). */
  contacts: { name: string; email: string | null } | null;
}

export interface CardSource {
  id: string;
  name: string;
  email: string;
  specialization: Specialization | null;
  fspState: FspState;
  category: { specialization: Specialization; grade: Grade } | null;
  claims: PublicClaim[];
}

/** Стабильный псевдоним без раскрытия id: 6 символов sha256. */
export function pseudonym(candidateId: string): string {
  return `Кандидат #${createHash('sha256').update(`cand:${candidateId}`).digest('hex').slice(0, 6).toUpperCase()}`;
}

/** Служебный адрес онбординга (`user-…@users.invalid`) — не контакт. */
export function contactEmail(email: string): string | null {
  return email.endsWith('.invalid') ? null : email;
}

export function toCandidateCard(src: CardSource, contactsVisible: boolean): CandidateCard {
  const claims = [...src.claims].sort(
    (a, b) => levelRank(b.level) - levelRank(a.level) || a.catalogId.localeCompare(b.catalogId),
  );
  return {
    id: src.id,
    displayName: contactsVisible ? src.name : pseudonym(src.id),
    specialization: src.category?.specialization ?? src.specialization,
    category: src.category ? { ...src.category, label: categoryLabel(src.category) } : null,
    fsp: { state: src.fspState, hasAchievements: src.fspState === 'linked' },
    claims,
    contacts: contactsVisible ? { name: src.name, email: contactEmail(src.email) } : null,
  };
}

/**
 * Одно утверждение каталога — один публичный пункт: из нескольких по одному catalogId
 * остаётся самый высокий уровень по LEVEL_ORDER (платформа выше третьей стороны, решение 09.10).
 */
export function dedupeClaims(
  claims: readonly { catalogId: string; level: EvidenceLevel; sourceKind?: string | null }[],
  catalog: Map<string, CatalogEntry>,
): PublicClaim[] {
  const best = new Map<string, { level: EvidenceLevel; sourceKind?: string | null }>();
  for (const c of claims) {
    const prev = best.get(c.catalogId);
    if (!prev || levelRank(c.level) > levelRank(prev.level)) best.set(c.catalogId, { level: c.level, sourceKind: c.sourceKind });
  }
  return [...best].map(([catalogId, { level, sourceKind }]) => ({
    catalogId,
    level,
    statement: catalog.get(catalogId)?.statement ?? catalogId,
    sourceType: publicSourceType(sourceKind, level),
  }));
}
