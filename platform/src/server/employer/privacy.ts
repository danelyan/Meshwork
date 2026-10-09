// Что работодатель видит о кандидате (R-E-07, R-C-13, R-C-16). Решает сервер:
// до принятия приглашения — только публичная часть, контакты и имя скрыты.
import { createHash } from 'node:crypto';

import type { EvidenceLevel } from '../claims/types';
import type { FspState, Grade, Specialization } from '../types';

import { categoryLabel } from './ranking';

export interface PublicClaim {
  catalogId: string;
  /** Формулировка каталога, не текст кандидата: в правке кандидат мог написать что угодно. */
  statement: string;
  level: EvidenceLevel;
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

const LEVEL_ORDER: EvidenceLevel[] = ['platform', 'third_party', 'artifact', 'self_reported'];

export function toCandidateCard(src: CardSource, contactsVisible: boolean): CandidateCard {
  const claims = [...src.claims].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || a.catalogId.localeCompare(b.catalogId),
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
