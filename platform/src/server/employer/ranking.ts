// Ранжирование кандидатов под потребность работодателя (R-E-03, R-M-01…R-M-04).
// Чистые функции: без БД, детерминированно. Покрытие — общий матчер recommend
// (тот же, что «закрываешь k из n» у кандидата), сверху — категория, ФСП, стек.
import { getSubcategory, SPEC_LABEL, subcategoryLabel } from '@/lib/directions';

import type { CatalogEntry, EvidenceLevel } from '../claims/types';
import { buildIndex, type Need } from '../recommend/evidence';
import { computeCoverage } from '../recommend/matcher';
import { gradeWeight } from '../recommend/weights';
import type { FspState, Grade, Specialization } from '../types';

import {
  CATEGORY_BASE,
  CATEGORY_MULT_ABOVE,
  CATEGORY_MULT_EXACT,
  FSP_BOOST,
  GRADE_RANK,
  SPEC_MISMATCH_PENALTY,
  STACK_BOOST_MAX,
  STACK_BOOST_PER_TAG,
  MIN_COVERED_FOR_VACANCY,
} from './weights';

export interface EvidenceClaim {
  catalogId: string;
  level: EvidenceLevel;
  statement: string;
  quote: string;
}

/** Всё, что ранжированию нужно знать о кандидате. Только подтверждённые утверждения. */
export interface CandidateEvidence {
  id: string;
  specialization: Specialization | null;
  fspState: FspState;
  /**
   * Последняя категория из теста или null (теста не было). Множитель покрытия — weights.ts. subcategoryId —
   * подкатегория теста (категория = направление × подкатегория × грейд; null у категорий до теста на подкатегорию).
   */
  category: { specialization: Specialization; grade: Grade; subcategoryId?: string | null } | null;
  claims: EvidenceClaim[];
  /** lane directions: подкатегория из профиля (онбординг, R-T-05); уступает подкатегории категории из теста. */
  subcategoryId?: string | null;
}

export interface MatchTarget {
  specialization: Specialization;
  /** Подкатегория потребности: кандидаты своей подкатегории — выше, соседние того же направления — ниже, с пометкой. */
  subcategoryId?: string | null;
  grade: Grade;
  needs: Need[];
  stack: string[];
}

export interface MatchFilters {
  specialization?: Specialization;
  /** Грейд категории из теста; кандидаты без категории при заданном грейде не проходят. */
  grade?: Grade;
  /** Все метки должны встречаться в подтверждённых утверждениях (цитата или формулировка). */
  stack?: string[];
  /** Только с подтверждёнными достижениями ФСП. */
  fsp?: boolean;
  /** Только с категорией из теста. */
  categoryOnly?: boolean;
  /** lane directions: подкатегория ("ai.llm-apps"); кандидаты без подкатегории или с другой не проходят (effectiveSubcategory). */
  subcategory?: string;
}

export interface Explanation {
  /** Одна строка «закрывает N из M …; доказано …; ФСП …». */
  summary: string;
  covered: { statement: string; level: EvidenceLevel }[];
  /** Закрыто уровнем выше «со слов» (артефакт, третья сторона, платформа). */
  proven: string[];
  missing: string[];
  fsp: string;
  category: string;
  /** Подкатегория кандидата относительно потребности: «Web API» или «соседняя подкатегория: …». Пусто — потребность без подкатегории. */
  subcategory: string;
  stackMatched: string[];
}

/**
 * Совпадение подкатегории с потребностью (ADR 0003, дополнение 10.10 15:50): exact — та же или у потребности
 * её нет; neighbour — то же направление, другая или не указанная подкатегория (ниже в выдаче, с пометкой);
 * other — другое направление.
 */
export type SubcategoryFit = 'exact' | 'neighbour' | 'other';
const FIT_ORDER: Record<SubcategoryFit, number> = { exact: 0, neighbour: 1, other: 2 };

export interface RankedCandidate {
  candidateId: string;
  score: number;
  coverageScore: number;
  covered: number;
  total: number;
  provenCount: number;
  /** Категория из теста совпала со специализацией потребности, грейд равен или выше (Q-36). */
  categoryMatch: boolean;
  /** Подкатегория относительно потребности: сортировка идёт сначала по ней, потом по баллу. */
  subcategoryFit: SubcategoryFit;
  boosts: { category: number; fsp: number; stack: number; specPenalty: number };
  explanation: Explanation;
}

const PROVEN: ReadonlySet<EvidenceLevel> = new Set(['artifact', 'third_party', 'platform']);

const GRADE_LABEL: Record<Grade, string> = { junior: 'Junior', middle: 'Middle' };

export function categoryLabel(c: { specialization: Specialization; grade: Grade }): string {
  return `${SPEC_LABEL[c.specialization]} · ${GRADE_LABEL[c.grade]}`;
}

/** Подкатегория для фильтра и сортировки: из категории теста, иначе из профиля. */
export function effectiveSubcategory(c: CandidateEvidence): string | null {
  return c.category?.subcategoryId ?? c.subcategoryId ?? null;
}

export function subcategoryFit(c: CandidateEvidence, target: Pick<MatchTarget, 'specialization' | 'subcategoryId'>): SubcategoryFit {
  if (effectiveSpecialization(c) !== target.specialization) return 'other';
  if (!target.subcategoryId) return 'exact';
  return effectiveSubcategory(c) === target.subcategoryId ? 'exact' : 'neighbour';
}

/** Специализация для фильтра и штрафа: из теста, иначе указанная кандидатом. */
export function effectiveSpecialization(c: CandidateEvidence): Specialization | null {
  return c.category?.specialization ?? c.specialization;
}

/** Потребность «без вакансии» для поиска по банку (R-E-04): сигнатура категории из каталога. */
export function categoryNeeds(catalog: Map<string, CatalogEntry>, spec: Specialization, grade: Grade): Need[] {
  const out: Need[] = [];
  for (const e of [...catalog.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (e.specialization !== spec && e.specialization !== 'common') continue;
    const w = gradeWeight(e, spec, grade);
    if (w && w > 0) out.push({ catalogId: e.id, weight: w });
  }
  return out;
}

export function normalizeStack(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().replace(/\s+/g, ' ');
    if (!t || t.length > 40) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Метки стека, которые встречаются в тексте подтверждённых утверждений (без учёта регистра). */
export function matchStack(claims: EvidenceClaim[], stack: readonly string[]): string[] {
  const text = claims.map((c) => `${c.statement}\n${c.quote}`).join('\n').toLowerCase();
  return stack.filter((t) => text.includes(t.toLowerCase()));
}

export function passesFilters(c: CandidateEvidence, f: MatchFilters): boolean {
  if (f.specialization && effectiveSpecialization(c) !== f.specialization) return false;
  if (f.grade && c.category?.grade !== f.grade) return false;
  if (f.categoryOnly && !c.category) return false;
  if (f.subcategory && effectiveSubcategory(c) !== f.subcategory) return false;
  if (f.fsp && c.fspState !== 'linked') return false;
  if (f.stack && f.stack.length > 0 && matchStack(c.claims, f.stack).length !== f.stack.length) return false;
  return true;
}

function fspText(state: FspState): string {
  switch (state) {
    case 'linked':
      return 'есть подтверждённые достижения';
    case 'no_achievements':
      return 'аккаунт привязан, достижений нет (на ранг не влияет)';
    case 'unavailable':
      return 'данные ФСП недоступны (на ранг не влияет)';
    default:
      return 'не привязан (на ранг не влияет)';
  }
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;

/** Оценка одного кандидата под цель. null — нечего показывать (ноль покрытия и нет категории). */
export function scoreCandidate(c: CandidateEvidence, target: MatchTarget, catalog: Map<string, CatalogEntry>): RankedCandidate | null {
  const index = buildIndex(c.claims);
  const cov = computeCoverage(target.needs, catalog, index);
  if (cov.score === 0 && !c.category) return null;

  let category = 0;
  let categoryMatch = false;
  let categoryText = 'тест не пройден - категории нет';
  if (c.category) {
    categoryText = `${categoryLabel(c.category)} (тест)`;
    if (c.category.specialization === target.specialization) {
      const d = GRADE_RANK[c.category.grade] - GRADE_RANK[target.grade];
      categoryMatch = d >= 0;
      const mult = d === 0 ? CATEGORY_MULT_EXACT : d > 0 ? CATEGORY_MULT_ABOVE : 0;
      // ПРЕДЛОЖЕНИЕ (Q-36): совпавшая категория даёт базу CATEGORY_BASE даже без закрытых требований,
      // и множитель действует на (покрытие + база). Ниже требуемого грейда — ни базы, ни показа без покрытия.
      category = (cov.score + (categoryMatch ? CATEGORY_BASE : 0)) * (1 + mult) - cov.score;
      if (d < 0) categoryText += ', ниже требуемого грейда';
    }
  }
  const spec = effectiveSpecialization(c);
  const specPenalty = spec && spec !== target.specialization ? SPEC_MISMATCH_PENALTY : 0;
  const fsp = c.fspState === 'linked' ? FSP_BOOST : 0;
  const stackMatched = matchStack(c.claims, target.stack);
  const stack = Math.min(STACK_BOOST_MAX, stackMatched.length * STACK_BOOST_PER_TAG);

  const fit = subcategoryFit(c, target);
  const sub = effectiveSubcategory(c);
  const subText = !target.subcategoryId
    ? ''
    : fit === 'exact'
      ? subcategoryLabel(sub)
      : fit === 'neighbour'
        ? `соседняя подкатегория: ${sub ? subcategoryLabel(sub) : 'не указана'} (нужна ${subcategoryLabel(target.subcategoryId)})`
        : sub && getSubcategory(sub)
          ? `${SPEC_LABEL[getSubcategory(sub)!.specialization]} · ${subcategoryLabel(sub)}`
          : 'другое направление';

  const coveredItems = cov.items.filter((i) => i.level !== null).map((i) => ({ statement: i.statement, level: i.level! }));
  const proven = coveredItems.filter((i) => PROVEN.has(i.level)).map((i) => i.statement);
  const missing = cov.missing.map((m) => m.statement);

  const categoryOnly = categoryMatch && cov.covered === 0;
  const parts = [`Закрывает ${cov.covered} из ${cov.total} требований${coveredItems.length ? `: ${coveredItems.map((i) => i.statement).join('; ')}` : ''}`];
  parts.push(proven.length ? `доказано артефактами и выше: ${proven.join('; ')}` : 'доказанного артефактами нет - только со слов');
  parts.push(`ФСП: ${fspText(c.fspState)}`);
  parts.push(`категория: ${categoryText}`);
  if (subText) parts.push(`подкатегория: ${subText}`);
  if (stackMatched.length) parts.push(`стек в подтверждённых цитатах: ${stackMatched.join(', ')}`);
  if (specPenalty) parts.push('другая специализация');
  const summary = categoryOnly
    ? `Категория ${categoryLabel(c.category!)} подтверждена тестом; требования потребности не доказаны утверждениями. ФСП: ${fspText(c.fspState)}${subText ? `. Подкатегория: ${subText}` : ''}${stackMatched.length ? `. Стек в подтверждённых цитатах: ${stackMatched.join(', ')}` : ''}.`
    : `${parts.join('. ')}.`;

  return {
    candidateId: c.id,
    score: round(cov.score + category + fsp + stack - specPenalty),
    coverageScore: cov.score,
    covered: cov.covered,
    total: cov.total,
    provenCount: proven.length,
    categoryMatch,
    subcategoryFit: fit,
    boosts: { category: round(category), fsp, stack: round(stack), specPenalty },
    explanation: {
      summary,
      covered: coveredItems,
      proven,
      missing,
      fsp: fspText(c.fspState),
      category: categoryText,
      subcategory: subText,
      stackMatched,
    },
  };
}

/**
 * Ранжирование: фильтры → оценка → отсев балла ≤ 0 → сортировка (подкатегория: своя → соседняя → другое
 * направление; затем балл, покрыто, доказано, id).
 * `target` — одна потребность для всех или функция (поиск по банку без потребности:
 * своя сигнатура категории на кандидата).
 */
export function rankCandidates(
  candidates: CandidateEvidence[],
  target: MatchTarget | ((c: CandidateEvidence) => MatchTarget | null),
  catalog: Map<string, CatalogEntry>,
  filters: MatchFilters = {},
): RankedCandidate[] {
  const out: RankedCandidate[] = [];
  for (const c of candidates) {
    if (!passesFilters(c, filters)) continue;
    const t = typeof target === 'function' ? target(c) : target;
    if (!t) continue;
    const r = scoreCandidate(c, t, catalog);
    // Балл ≤ 0 (ничего не закрыто или другая специализация перевесила) — не подходит, не показываем.
    if (r && r.score > 0) out.push(r);
  }
  out.sort(
    (a, b) =>
      FIT_ORDER[a.subcategoryFit] - FIT_ORDER[b.subcategoryFit] || b.score - a.score || b.covered - a.covered || b.provenCount - a.provenCount || a.candidateId.localeCompare(b.candidateId),
  );
  return out;
}

/**
 * Подборка под потребность: оставляет тех, кто закрыл не меньше MIN_COVERED_FOR_VACANCY требований,
 * и тех, чья категория из теста совпала с потребностью (Q-36) — даже при нуле закрытых.
 */
export function dropUncovered<T extends { covered: number; categoryMatch: boolean }>(ranked: T[]): T[] {
  return ranked.filter((r) => r.covered >= MIN_COVERED_FOR_VACANCY || r.categoryMatch);
}
