// Реестр генераторов: Backend и Frontend (ADR-0002) и AI (ADR 0003, дополнения 10.10). Тест — на подкатегорию
// (дополнение 10.10 15:50): пул попытки — семейства подкатегории, не меньше MIN_FAMILIES_PER_SUBCATEGORY.
// Направление без генераторов (пока engineering) — явная ошибка NoGeneratorsError, а не пустой банк. Параметры a, b здесь — стартовые экспертные; рабочие
// значения читаются из TaskTemplate (БД), куда их переносит сид и правит калибровка (docs/test-calibration.md).
import { getSubcategory, SPEC_LABEL, subcategoriesFor } from '@/lib/directions';
import { GRADE_LABEL, GRADES, type Grade } from '@/lib/grades';

import type { Specialization } from '../../types';
import type { TaskGenerator } from '../types';

import { AI_GENERATORS } from './ai';
import { BACKEND_GENERATORS } from './backend';
import { FRONTEND_GENERATORS } from './frontend';

export const GENERATORS: readonly TaskGenerator[] = [...BACKEND_GENERATORS, ...FRONTEND_GENERATORS, ...AI_GENERATORS];

const BY_ID = new Map(GENERATORS.map((g) => [g.id, g]));

export function getGenerator(id: string): TaskGenerator | undefined {
  return BY_ID.get(id);
}

export function generatorsFor(spec: Specialization): TaskGenerator[] {
  return GENERATORS.filter((g) => g.specialization === spec);
}

/** Минимум генераторов на направление, чтобы адаптивный тест имел смысл (MAX_ITEMS + дозадавание). */
export const MIN_GENERATORS_PER_SPEC = 12;

/**
 * Есть ли у направления тест на грейд хотя бы для одной подкатегории: переходный пул всего направления
 * (семейства не размечены, ≥ MIN_GENERATORS_PER_SPEC) или подкатегория с ≥ MIN_FAMILIES_PER_SUBCATEGORY.
 */
export function hasTestFor(spec: Specialization): boolean {
  const all = generatorsFor(spec);
  if (!all.some((g) => g.subcategoryId)) return all.length >= MIN_GENERATORS_PER_SPEC;
  return subcategoriesFor(spec).some((s) => bankComplete(all.filter((g) => g.subcategoryId === s.id)));
}

/**
 * Минимум семейств подкатегории по грейдам (ADR 0003, дополнение 10.10 16:15: при 4 Junior «Junior с одной
 * слабой темой» подтверждался в 50–75 %). Подкатегория активна, только если выполнены все три.
 */
export const MIN_FAMILIES_BY_GRADE: Readonly<Record<Grade, number>> = { junior: 6, middle: 4, senior: 4 };
/** Сумма по грейдам (14); было 8 по дополнению 15:50. */
export const MIN_FAMILIES_PER_SUBCATEGORY = MIN_FAMILIES_BY_GRADE.junior + MIN_FAMILIES_BY_GRADE.middle + MIN_FAMILIES_BY_GRADE.senior;

/** Банк подкатегории покрывает все грейды по MIN_FAMILIES_BY_GRADE. */
export function bankComplete(families: readonly TaskGenerator[]): boolean {
  return GRADES.every((g) => families.filter((f) => f.grade === g).length >= MIN_FAMILIES_BY_GRADE[g]);
}

/** Сколько семейств подкатегории по грейдам (для сообщений и отчётов). */
export function familyCounts(subcategoryId: string): Record<Grade, number> {
  const own = generatorsForSubcategory(subcategoryId);
  return Object.fromEntries(GRADES.map((g) => [g, own.filter((f) => f.grade === g).length])) as Record<Grade, number>;
}

/** Семейства подкатегории (по полю TaskGenerator.subcategoryId). */
export function generatorsForSubcategory(subcategoryId: string): TaskGenerator[] {
  return GENERATORS.filter((g) => g.subcategoryId === subcategoryId);
}

export interface TestPool {
  generators: TaskGenerator[];
  /**
   * true — переходный режим: у направления ещё не размечено ни одно семейство (лейн генераторов не влит),
   * пул — всё направление, как до теста на подкатегорию. false — пул подкатегории.
   */
  legacy: boolean;
}

/**
 * Пул попытки для направления и подкатегории. Направление с размеченными семействами — только семейства
 * подкатегории, и только если банк полон по MIN_FAMILIES_BY_GRADE (6 J + 4 M + 4 S); иначе null («тест пока недоступен»).
 * Направление без единой разметки — переходный пул направления (legacy), если банк направления есть.
 */
export function poolFor(spec: Specialization, subcategoryId: string | null | undefined): TestPool | null {
  const all = generatorsFor(spec);
  const marked = all.some((g) => g.subcategoryId);
  if (!marked) return all.length >= MIN_GENERATORS_PER_SPEC ? { generators: all, legacy: true } : null;
  if (!subcategoryId) return null;
  const own = all.filter((g) => g.subcategoryId === subcategoryId);
  return bankComplete(own) ? { generators: own, legacy: false } : null;
}

/**
 * Почему теста для подкатегории нет (текст для кандидата); null — тест есть. Подкатегория чужого
 * направления или не выбрана — тоже причина.
 */
export function unavailableReason(spec: Specialization, subcategoryId: string | null | undefined): string | null {
  if (!hasTestFor(spec)) return new NoGeneratorsError(spec).message.replace(/ \(src\/.*\)\.$/, '.');
  if (poolFor(spec, subcategoryId)) return null;
  const sub = getSubcategory(subcategoryId);
  if (!sub || sub.specialization !== spec) return `Выберите подкатегорию направления ${SPEC_LABEL[spec]}: тест на грейд идёт по подкатегории.`;
  const n = familyCounts(sub.id);
  const have = GRADES.map((g) => `${GRADE_LABEL[g]} ${n[g]} из ${MIN_FAMILIES_BY_GRADE[g]}`).join(', ');
  return `Тест по подкатегории «${sub.title}» пока недоступен: в банке заданий ${have}.`;
}

/** Есть ли тест для подкатегории (с учётом переходного режима направления). */
export function hasTestForSubcategory(spec: Specialization, subcategoryId: string | null | undefined): boolean {
  return poolFor(spec, subcategoryId) !== null;
}

/** Направление без генераторов: тест не запускается, UI показывает «тест пока недоступен». */
export class NoGeneratorsError extends Error {
  constructor(readonly specialization: Specialization) {
    super(`Тест на грейд для направления ${SPEC_LABEL[specialization]} пока недоступен: нет генераторов заданий (src/server/test/generators).`);
    this.name = 'NoGeneratorsError';
  }
}

/** Генераторы направления или понятная ошибка, если их нет. */
export function requireGenerators(spec: Specialization): TaskGenerator[] {
  if (!hasTestFor(spec)) throw new NoGeneratorsError(spec);
  return generatorsFor(spec);
}
