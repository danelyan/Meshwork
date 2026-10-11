// Fullstack как ПРЕДСТАВЛЕНИЕ поиска по базе (новых тестов и направлений нет).
// ПРЕДЛОЖЕНИЕ агента: fullstack = у кандидата есть подтверждённые категории и в backend, и в frontend.
// Только категории из теста: утверждения каталога в обоих направлениях не используем - это не дёшево
// и не прозрачно (граница «достаточно сильных» утверждений произвольна), см. docs/platform.md.
import type { Need } from '../recommend/evidence';
import { categoryNeeds, type CandidateEvidence } from './ranking';
import type { CatalogEntry } from '../claims/types';
import type { Grade } from '../types';
import { GRADE_LABEL } from '@/lib/grades';

import { GRADE_RANK } from './weights';

export type CategoryRef = { specialization: string; grade: Grade; subcategoryId?: string | null };

export interface FullstackProfile {
  backend: Grade;
  frontend: Grade;
  /**
   * Грейд fullstack = МЕНЬШИЙ из двух (лучший backend, лучший frontend): «Middle fullstack» значит, что обе
   * стороны не ниже Middle. Так фильтр по грейду не продаёт Senior-бэкендера с Junior-фронтом как Senior fullstack.
   */
  grade: Grade;
}

const best = (cats: CategoryRef[], spec: string): Grade | null =>
  cats.filter((c) => c.specialization === spec).reduce<Grade | null>((acc, c) => (acc === null || GRADE_RANK[c.grade] > GRADE_RANK[acc] ? c.grade : acc), null);

export function allCategories(c: Pick<CandidateEvidence, 'category' | 'categories'>): CategoryRef[] {
  return c.categories ?? (c.category ? [c.category] : []);
}

/** null - нет подтверждённых категорий в обоих направлениях. */
export function fullstackProfile(c: Pick<CandidateEvidence, 'category' | 'categories'>): FullstackProfile | null {
  const cats = allCategories(c);
  const backend = best(cats, 'backend');
  const frontend = best(cats, 'frontend');
  if (!backend || !frontend) return null;
  return { backend, frontend, grade: GRADE_RANK[backend] <= GRADE_RANK[frontend] ? backend : frontend };
}

export function fullstackLabel(p: FullstackProfile): string {
  return `Fullstack: backend ${GRADE_LABEL[p.backend]} + frontend ${GRADE_LABEL[p.frontend]}`;
}

/** Требования fullstack: объединение типичных требований backend и frontend на грейде (вес - больший из двух). */
export function fullstackNeeds(catalog: Map<string, CatalogEntry>, grade: Grade): Need[] {
  const merged = new Map<string, Need>();
  for (const n of [...categoryNeeds(catalog, 'backend', grade), ...categoryNeeds(catalog, 'frontend', grade)]) {
    const prev = merged.get(n.catalogId);
    if (!prev || n.weight > prev.weight) merged.set(n.catalogId, n);
  }
  return [...merged.values()].sort((a, b) => a.catalogId.localeCompare(b.catalogId));
}

/**
 * Кандидат в виде для существующей формулы: категория backend на грейде fullstack (меньший из двух), поэтому
 * множитель категории и база считаются как обычно; специализация backend, чтобы штраф за чужое направление
 * не сработал на фронтенд-стороне. Все категории остаются в `categories` (их читает passesFilters).
 */
export function asFullstackEvidence(c: CandidateEvidence): CandidateEvidence {
  const p = fullstackProfile(c);
  if (!p) return c;
  return { ...c, specialization: 'backend', category: { specialization: 'backend', grade: p.grade, subcategoryId: null } };
}
