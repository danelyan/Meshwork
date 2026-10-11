import type { CatalogEntry } from '@/server/claims/types';
import { gradeWeight } from '@/server/recommend/weights';
import type { Grade, Specialization } from '@/server/types';

/**
 * Проекция потребности работодателя на каталог утверждений → `Vacancy.needs`
 * ({ catalogId, weight }[], формат сида recommend). Наше предложение (не из ТЗ):
 *  - записи направления и общие (`common`), у которых есть вес для грейда
 *    (веса – те же, что у подбора: recommend/weights.gradeWeight);
 *  - ядро – записи с весом 3 для грейда;
 *  - плюс записи, чей маркер совпал с чипом стека (без учёта регистра), – они
 *    идут первыми: то, что работодатель назвал сам, важнее;
 *  - не больше MAX_NEEDS, вес 1..3.
 */
export const MAX_NEEDS = 8;

export function computeNeeds(
  catalog: Iterable<CatalogEntry>,
  spec: Specialization,
  grade: Grade,
  stack: string[],
): { catalogId: string; weight: number }[] {
  const chips = new Set(stack.map((s) => s.toLowerCase()));
  const scored: { id: string; weight: number; score: number }[] = [];
  for (const e of catalog) {
    if (e.specialization !== spec && e.specialization !== 'common') continue;
    const w = gradeWeight(e, spec, grade);
    if (w === null || w <= 0) continue;
    const match = e.markers.some((m) => chips.has(m.toLowerCase()));
    if (w < 3 && !match) continue;
    scored.push({ id: e.id, weight: Math.min(3, Math.max(1, w)), score: w + (match ? 3 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, MAX_NEEDS).map((s) => ({ catalogId: s.id, weight: s.weight }));
}
