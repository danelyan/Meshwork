// Что работодатель видит о кандидате (R-E-07, R-C-13, R-C-16). Решает сервер:
// до принятия приглашения — только публичная часть, контакты и имя скрыты.
import { createHash } from 'node:crypto';

import { maskContacts } from '../collector/mask';
import { SOFT_SKILLS, cleanRole } from '../resume-fields/parse';
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
  /**
   * null — контакты скрыты (приглашение не принято). После accepted: `contact` — способ связи
   * кандидата (Candidate.contact), иначе почта аккаунта; null — связаться не через что
   * (интерфейс пишет NO_CANDIDATE_CONTACT из components/employer/labels.ts, а не пустую строку).
   */
  contacts: { name: string; contact: string | null } | null;
  /**
   * lane resume-fields (R-C-01/02): стаж, роли и софт-скиллы видны и до принятия — они не раскрывают личность:
   * роли без компаний и контактов (`cleanRole`), софт-скиллы — только метки словаря. Нет данных — поля нет.
   */
  experience?: PublicExperience;
}

export interface PublicExperience {
  years: number | null;
  roles: string[];
  softSkills: string[];
}

const SOFT_LABELS = new Set(SOFT_SKILLS.map((s) => s.label));

/** Публичная проекция стажа/ролей/софт-скиллов; null — показывать нечего. */
export function publicExperience(src: { experienceYears?: number | null; roles?: readonly string[]; softSkills?: readonly string[] } | null | undefined): PublicExperience | null {
  if (!src) return null;
  const years = typeof src.experienceYears === 'number' && src.experienceYears >= 0 ? Math.min(src.experienceYears, 60) : null;
  const roles = [...new Set((src.roles ?? []).map((r) => cleanRole(r)).filter((r): r is string => r !== null))].slice(0, 5);
  // Свой текст кандидата наружу не уходит: только метки словаря (как statement каталога у утверждений).
  const softSkills = (src.softSkills ?? []).filter((s) => SOFT_LABELS.has(s));
  return years === null && roles.length === 0 && softSkills.length === 0 ? null : { years, roles, softSkills };
}

export interface CardSource {
  id: string;
  name: string;
  email: string;
  /** Candidate.contact (Q-35). */
  contact: string | null;
  specialization: Specialization | null;
  fspState: FspState;
  category: { specialization: Specialization; grade: Grade } | null;
  claims: PublicClaim[];
  /** CandidateProfile: стаж, роли, софт-скиллы (из резюме или от кандидата). */
  experience?: { experienceYears: number | null; roles: string[]; softSkills: string[] } | null;
}

/** Стабильный псевдоним без раскрытия id: 6 символов sha256. */
export function pseudonym(candidateId: string): string {
  return `Кандидат #${createHash('sha256').update(`cand:${candidateId}`).digest('hex').slice(0, 6).toUpperCase()}`;
}

/** Служебный адрес онбординга (`user-…@users.invalid`) — не контакт. */
export function contactEmail(email: string): string | null {
  return email.endsWith('.invalid') ? null : email;
}

/** Контакт кандидата для работодателя после accepted: указанный кандидатом, иначе почта аккаунта. */
export function candidateContact(src: { contact: string | null; email: string }): string | null {
  return src.contact?.trim() || contactEmail(src.email);
}

export function toCandidateCard(src: CardSource, contactsVisible: boolean): CandidateCard {
  // Копируем ровно публичные поля: лишнее поле источника (цитата, sourceRef) наружу не уйдёт, даже если его передали по ошибке.
  const claims = src.claims
    .map(({ catalogId, statement, level, sourceType }) => ({ catalogId, statement, level, sourceType }))
    .sort(
    (a, b) => levelRank(b.level) - levelRank(a.level) || a.catalogId.localeCompare(b.catalogId),
  );
  const experience = publicExperience(src.experience);
  return {
    id: src.id,
    displayName: contactsVisible ? src.name : pseudonym(src.id),
    specialization: src.category?.specialization ?? src.specialization,
    category: src.category ? { ...src.category, label: categoryLabel(src.category) } : null,
    fsp: { state: src.fspState, hasAchievements: src.fspState === 'linked' },
    claims,
    contacts: contactsVisible ? { name: src.name, contact: candidateContact(src) } : null,
    ...(experience ? { experience } : {}),
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

/**
 * Результат автопроверки сдачи для работодателя (R-C-16, R-E-07). До принятого приглашения цитаты рубрики,
 * пути файлов, заметка линтера и текст ошибки несут код кандидата с почтой, ссылками и никами — проходят
 * `maskContacts`. После принятия — как есть. Без этого `GET /api/employer/project-submissions` отдавал
 * необработанные `rubric.results[].evidence`, хотя подборка (`maskProjectBlock`) их маскирует.
 */
export function maskSubmissionForEmployer<R extends { rubric: { results: { evidence: string; file?: string | null }[] }; lint: { note: string; details?: unknown } }>(
  result: R | null,
  error: string | null,
  open: boolean,
): { result: R | null; error: string | null } {
  if (open) return { result, error };
  const m = (t: string) => maskContacts(t).text;
  return {
    result: result && {
      ...result,
      rubric: { ...result.rubric, results: result.rubric.results.map((c) => ({ ...c, evidence: m(c.evidence), file: c.file ? m(c.file) : c.file })) },
      lint: { ...result.lint, note: m(result.lint.note), details: undefined },
    },
    error: error && m(error),
  };
}
