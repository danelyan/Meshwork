// Ранжирование кандидатов под потребность работодателя (R-E-03, R-M-01…R-M-04).
// Чистые функции: без БД, детерминированно. Покрытие — общий матчер recommend
// (тот же, что «закрываешь k из n» у кандидата), сверху — категория, ФСП, стек.
import { getSubcategory, SPEC_LABEL, subcategoryLabel } from '@/lib/directions';

import type { CatalogEntry, EvidenceLevel } from '../claims/types';
import { buildIndex, type Need } from '../recommend/evidence';
import { computeCoverage } from '../recommend/matcher';
import { gradeWeight } from '../recommend/weights';
import type { FspState, Grade, Specialization } from '../types';

import { fspWeight, type FspAchievementInput } from './fsp-weight';
import { matchStackPartial, partialText, type PartialStackMatch } from './tech-proximity';
import {
  CALL_TOPIC_BONUS,
  CALL_TOPIC_BONUS_MAX,
  CATEGORY_BASE,
  CATEGORY_MULT_ABOVE,
  CATEGORY_MULT_EXACT,
  FSP_BOOST,
  GRADE_RANK,
  PROJECT_BONUS_PER_SCORE,
  SPEC_MISMATCH_PENALTY,
  STACK_BOOST_MAX,
  STACK_BOOST_PER_TAG,
  MIN_COVERED_FOR_VACANCY,
} from './weights';
import { GRADE_LABEL } from '@/lib/grades';
import {
  buildDefenseBlock,
  buildDepthBlock,
  buildProjectBlock,
  pickOwnProject,
  stagesSentence,
  type CallsEvidence,
  type DefenseBlock,
  type DepthBlock,
  type ProjectBlock,
  type ProjectEvidence,
} from './stages';

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
  /** ADR 0003, ступени 1 и 3: последний квалифицирующий созвон и последняя защита (баллы и флаги, без цитат). */
  calls?: CallsEvidence;
  /** ADR 0003, ступень 2: проверенные проекты кандидата (по одному на задание). */
  projects?: ProjectEvidence[];
  /**
   * Достижения ФСП (форма ФСП-источника: событие, год, результат). Учитываются только при fspState = linked.
   * Нет поля — список не загружен: прежняя плоская прибавка FSP_BOOST.
   */
  fspAchievements?: FspAchievementInput[];
  /**
   * Индекс честности попытки, давшей категорию (форма PublicTestIntegrity из test-integrity.ts). На порядок влияет только
   * при RankOptions.integrityPenalty; без него — метка для работодателя, и только.
   */
  testIntegrity?: { level: 'low' | 'medium' | 'high'; confirmedAgain?: boolean } | null;
}

/**
 * Вариант 2 из оценки «индекс честности в подборе» (eval/matching/integrity.ts, 11.10). ВЫКЛЮЧЕН по умолчанию.
 * Действует на кандидата с категорией и индексом high, если категорию не выдал подтверждающий тест (confirmedAgain).
 * - drop_category: категория из теста не учитывается — как будто теста не было (фильтры, база, множитель, специализация);
 * - multiplier: итоговый положительный балл × factor (0 < factor ≤ 1).
 * Чтобы включить в кабинете: в matching.ts `run` загрузить loadTestIntegrity для всего пула ДО rankCandidates (сейчас —
 * только для выданного топа, после ранжирования), положить уровень в evidence.testIntegrity и передать opts.
 */
export type IntegrityPenalty = { mode: 'drop_category' } | { mode: 'multiplier'; factor: number };

/** Параметры ранжирования. year — год отсчёта давности достижений ФСП (по умолчанию текущий; в тестах — явно). */
export interface RankOptions {
  year?: number;
  /** Вариант 2 индекса честности; нет поля — порядок не зависит от индекса (вариант 1, как сейчас). */
  integrityPenalty?: IntegrityPenalty;
}

/** Индекс high у категории, не перепроверенной подтверждающим тестом, при включённом integrityPenalty. */
export function integrityFlagged(c: CandidateEvidence, opts: RankOptions = {}): boolean {
  return Boolean(opts.integrityPenalty && c.category && c.testIntegrity?.level === 'high' && !c.testIntegrity.confirmedAgain);
}

/** drop_category: кандидат без категории из теста; в остальных случаях — как есть. */
export function applyIntegrity(c: CandidateEvidence, opts: RankOptions = {}): CandidateEvidence {
  return integrityFlagged(c, opts) && opts.integrityPenalty?.mode === 'drop_category' ? { ...c, category: null } : c;
}

export interface MatchTarget {
  /** Потребность (вакансия): по ней находим проект кандидата «под эту потребность». Нет — поиск по банку, проект не даёт баллов. */
  vacancyId?: string | null;
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
  /** Метки стека, закрытые близкой технологией: «частично: RabbitMQ вместо Kafka». */
  stackPartial?: PartialStackMatch[];
  /** Вклад достижений ФСП, лучшие первыми: «призёр: Кубок России …, 2025: +0,028». */
  fspReasons?: string[];
  /** Ступень 1: карта глубины (тема → подтверждено/нет). Нет созвона — поля нет. */
  depthMap?: DepthBlock;
  /** Ступень 2: проект под эту потребность целиком, чужие — подкатегория и балл. */
  project?: ProjectBlock;
  /** Ступень 3: балл защиты и флаги. Флаг — пометка, на порядок не влияет. */
  defense?: DefenseBlock;
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
  /** Проверенный проект под эту потребность (ступень 2): в выдаче остаётся и без закрытых требований. */
  ownProject?: boolean;
  boosts: { category: number; fsp: number; stack: number; specPenalty: number; project?: number; calls?: number };
  explanation: Explanation;
}

const PROVEN: ReadonlySet<EvidenceLevel> = new Set(['artifact', 'third_party', 'platform']);

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
export function scoreCandidate(
  c: CandidateEvidence,
  target: MatchTarget,
  catalog: Map<string, CatalogEntry>,
  opts: RankOptions = {},
): RankedCandidate | null {
  const flagged = integrityFlagged(c, opts);
  c = applyIntegrity(c, opts);
  const index = buildIndex(c.claims);
  const cov = computeCoverage(target.needs, catalog, index);
  const ownProject = pickOwnProject(c.projects, target.vacancyId);
  if (cov.score === 0 && !c.category && !ownProject) return null;

  let category = 0;
  let categoryMatch = false;
  let categoryText = flagged && opts.integrityPenalty?.mode === 'drop_category' ? 'категория из теста не учтена: замечания к честности теста' : 'тест не пройден - категории нет';
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
  // R-M-02: достижения ФСП — место × уровень × давность, с потолком (fsp-weight.ts). Без ФСП — 0, не штраф (R-FSP-03).
  const fspW = c.fspState === 'linked' && c.fspAchievements ? fspWeight(c.fspAchievements, opts.year ?? new Date().getFullYear()) : null;
  const fsp = c.fspState !== 'linked' ? 0 : fspW ? fspW.boost : FSP_BOOST;
  const fspLine = fspW
    ? fspW.reasons.length
      ? `${fspText(c.fspState)}: ${fspW.reasons.join('; ')}${fspW.capped ? ` (потолок ${String(fsp).replace('.', ',')})` : ''}`
      : `${fspText(c.fspState)}, вклад в порядок нулевой`
    : fspText(c.fspState);
  const stackMatched = matchStack(c.claims, target.stack);
  // Близкая технология закрывает метку частично (tech-proximity.ts): коэффициент < 1, точное совпадение всегда весомее.
  const stackPartial = matchStackPartial(
    c.claims.map((x) => `${x.statement}\n${x.quote}`).join('\n'),
    target.stack.filter((t) => !stackMatched.includes(t)),
  );
  const stack = Math.min(STACK_BOOST_MAX, (stackMatched.length + stackPartial.reduce((s, m) => s + m.coef, 0)) * STACK_BOOST_PER_TAG);

  // ADR 0003: бонус за проект под ЭТУ потребность и за подтверждённые созвоном темы потребности; защита в балл не входит.
  const project = ownProject ? PROJECT_BONUS_PER_SCORE * ownProject.score : 0;
  const needIds = new Set(target.needs.map((n) => n.catalogId));
  const depthBlock = c.calls?.qualifying ? buildDepthBlock(c.calls.qualifying, needIds) : undefined;
  const callsBonus = depthBlock ? Math.min(CALL_TOPIC_BONUS_MAX, depthBlock.matchedNeed * CALL_TOPIC_BONUS) : 0;
  const projectBlock = c.projects?.length ? buildProjectBlock(c.projects, ownProject) : undefined;
  const defenseBlock = c.calls?.defense ? buildDefenseBlock(c.calls.defense) : undefined;

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
  parts.push(`ФСП: ${fspLine}`);
  parts.push(`категория: ${categoryText}`);
  if (subText) parts.push(`подкатегория: ${subText}`);
  if (stackMatched.length) parts.push(`стек в подтверждённых цитатах: ${stackMatched.join(', ')}`);
  if (stackPartial.length) parts.push(`стек ${stackPartial.map(partialText).join('; ')}`);
  if (specPenalty) parts.push('другая специализация');
  const stages = stagesSentence({ depth: depthBlock, project: projectBlock, defense: defenseBlock });
  const base = categoryOnly
    ? `Категория ${categoryLabel(c.category!)} подтверждена тестом; требования потребности не доказаны утверждениями. ФСП: ${fspLine}${subText ? `. Подкатегория: ${subText}` : ''}${stackMatched.length ? `. Стек в подтверждённых цитатах: ${stackMatched.join(', ')}` : ''}${stackPartial.length ? `. Стек ${stackPartial.map(partialText).join('; ')}` : ''}.`
    : `${parts.join('. ')}.`;
  const ownNoCategory = Boolean(ownProject) && !categoryMatch;
  const note = ownNoCategory ? ' Показан за проверенный проект; категории под потребность нет.' : '';
  const summary0 = stages ? `${base} ${stages[0]!.toUpperCase()}${stages.slice(1)}.` : base;
  const summary = `${summary0}${note}`;

  const total = cov.score + category + fsp + stack + project + callsBonus - specPenalty;
  const factor = flagged && opts.integrityPenalty?.mode === 'multiplier' && total > 0 ? opts.integrityPenalty.factor : 1;
  return {
    candidateId: c.id,
    score: round(total * factor),
    coverageScore: cov.score,
    covered: cov.covered,
    total: cov.total,
    provenCount: proven.length,
    categoryMatch,
    subcategoryFit: fit,
    ...(ownProject ? { ownProject: true } : {}),
    boosts: { category: round(category), fsp: round(fsp), stack: round(stack), specPenalty, ...(c.projects || c.calls ? { project: round(project), calls: round(callsBonus) } : {}) },
    explanation: {
      summary,
      covered: coveredItems,
      proven,
      missing,
      fsp: fspLine,
      category: categoryText,
      subcategory: subText,
      stackMatched,
      ...(stackPartial.length ? { stackPartial } : {}),
      ...(fspW?.reasons.length ? { fspReasons: fspW.reasons } : {}),
      ...(depthBlock ? { depthMap: depthBlock } : {}),
      ...(projectBlock ? { project: projectBlock } : {}),
      ...(defenseBlock ? { defense: defenseBlock } : {}),
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
  opts: RankOptions = {},
): RankedCandidate[] {
  const out: RankedCandidate[] = [];
  for (const c of candidates) {
    if (!passesFilters(applyIntegrity(c, opts), filters)) continue;
    const t = typeof target === 'function' ? target(c) : target;
    if (!t) continue;
    const r = scoreCandidate(c, t, catalog, opts);
    // Балл ≤ 0 (ничего не закрыто или другая специализация перевесила) — не подходит, не показываем.
    if (r && r.score > 0) out.push(r);
  }
  out.sort(compareRanked);
  return out;
}

/** Порядок выдачи: подкатегория (своя → соседняя → другое направление), балл, покрыто, доказано, id. */
export function compareRanked(a: RankedCandidate, b: RankedCandidate): number {
  return FIT_ORDER[a.subcategoryFit] - FIT_ORDER[b.subcategoryFit] || b.score - a.score || b.covered - a.covered || b.provenCount - a.provenCount || a.candidateId.localeCompare(b.candidateId);
}

/**
 * Подборка под потребность: оставляет тех, кто закрыл не меньше MIN_COVERED_FOR_VACANCY требований,
 * и тех, чья категория из теста совпала с потребностью (Q-36) — даже при нуле закрытых.
 */
export function dropUncovered<T extends { covered: number; categoryMatch: boolean; ownProject?: boolean }>(ranked: T[]): T[] {
  return ranked.filter((r) => r.covered >= MIN_COVERED_FOR_VACANCY || r.categoryMatch || r.ownProject);
}
