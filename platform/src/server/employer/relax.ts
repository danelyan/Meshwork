// Подсказки ослабления условий подборки (R-M-04 «фильтрация и уточнение без потери подборки»).
// Чистая функция поверх rankCandidates/dropUncovered: для каждого одиночного ослабления считаем,
// сколько кандидатов добавится в подборку под потребность. Текущая выдача не меняется — подсказка
// ведёт на ту же страницу с новыми фильтрами, прежняя выдача остаётся в истории уточнений.
import type { CatalogEntry } from '../claims/types';
import { GRADE_LABEL, type Grade } from '@/lib/grades';

import { dropUncovered, rankCandidates, type CandidateEvidence, type MatchFilters, type MatchTarget, type RankOptions } from './ranking';

const LOWER: Record<Grade, Grade | null> = { junior: null, middle: 'junior', senior: 'middle' };

export interface RelaxHint {
  /** stack — снять метку фильтра; grade — снять фильтр грейда; fsp — снять флаг, includeUntested — показать и без теста; vacancyGrade — грейд потребности на ступень ниже. */
  kind: 'stack' | 'grade' | 'fsp' | 'includeUntested' | 'vacancyGrade';
  /** «Ослабьте „Kafka“». */
  label: string;
  /** Сколько кандидатов добавится к текущей подборке. */
  gain: number;
  /** Фильтры после ослабления; null — меняется сама потребность (vacancyGrade), фильтры прежние. */
  filters: MatchFilters | null;
  /** Для vacancyGrade: грейд, на который предлагаем опустить потребность. */
  grade?: Grade;
}

/** Не больше стольких подсказок. */
export const MAX_RELAX_HINTS = 3;

/**
 * Одиночные ослабления условий, которые добавляют кандидатов в подборку под потребность, лучшие первыми.
 * Требования потребности (needs) не ослабляем: они не отсекают кандидатов — покрытие считается долей,
 * и снятие требования только уменьшает «закрыто k из n».
 */
export function relaxationHints(
  candidates: CandidateEvidence[],
  target: MatchTarget,
  catalog: Map<string, CatalogEntry>,
  filters: MatchFilters,
  opts: RankOptions = {},
): RelaxHint[] {
  const count = (t: MatchTarget, f: MatchFilters) => dropUncovered(rankCandidates(candidates, t, catalog, f, opts)).length;
  const base = count(target, filters);
  const options: Omit<RelaxHint, 'gain'>[] = [];
  for (const tag of filters.stack ?? []) {
    const rest = (filters.stack ?? []).filter((t) => t !== tag);
    options.push({ kind: 'stack', label: `Ослабьте «${tag}»`, filters: { ...filters, stack: rest.length ? rest : undefined } });
  }
  if (filters.grade) options.push({ kind: 'grade', label: `Снимите фильтр «${GRADE_LABEL[filters.grade]}»`, filters: { ...filters, grade: undefined } });
  if (filters.fsp) options.push({ kind: 'fsp', label: 'Снимите «только с ФСП»', filters: { ...filters, fsp: undefined } });
  if (filters.categoryOnly) options.push({ kind: 'includeUntested', label: 'Покажите и кандидатов без теста', filters: { ...filters, categoryOnly: undefined, includeUntested: true } });
  const lower = LOWER[target.grade];
  if (lower) options.push({ kind: 'vacancyGrade', label: `Рассмотрите ${GRADE_LABEL[lower]} вместо ${GRADE_LABEL[target.grade]}`, filters: null, grade: lower });

  const hints: RelaxHint[] = [];
  for (const o of options) {
    const t = o.kind === 'vacancyGrade' ? { ...target, grade: o.grade! } : target;
    const gain = count(t, o.filters ?? filters) - base;
    if (gain > 0) hints.push({ ...o, filters: o.filters ? stripUndefined(o.filters) : null, gain });
  }
  return hints.sort((a, b) => b.gain - a.gain).slice(0, MAX_RELAX_HINTS);
}

function stripUndefined(f: MatchFilters): MatchFilters {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as MatchFilters;
}
