// Реестр генераторов: 12 Backend + 12 Frontend (ADR-0002) + 14 AI (ADR 0003, дополнение 10.10).
// Engineering — генераторы придут лейном engineering (eng.*); пока для него теста нет, и это явная
// ошибка NoGeneratorsError, а не пустой банк. Параметры a, b здесь — стартовые экспертные; рабочие
// значения читаются из TaskTemplate (БД), куда их переносит сид и правит калибровка (docs/test-calibration.md).
import { SPEC_LABEL } from '@/lib/directions';

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

/** Есть ли у направления банк заданий теста на грейд. */
export function hasTestFor(spec: Specialization): boolean {
  return generatorsFor(spec).length >= MIN_GENERATORS_PER_SPEC;
}

/** Минимум семейств на подкатегорию (ADR 0003, дополнение 10.10 15:50): меньше — тест подкатегории недоступен. */
export const MIN_FAMILIES_PER_SUBCATEGORY = 8;

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
 * подкатегории, и только если их ≥ MIN_FAMILIES_PER_SUBCATEGORY; иначе null («тест пока недоступен»).
 * Направление без единой разметки — переходный пул направления (legacy), если банк направления есть.
 */
export function poolFor(spec: Specialization, subcategoryId: string | null | undefined): TestPool | null {
  const all = generatorsFor(spec);
  const marked = all.some((g) => g.subcategoryId);
  if (!marked) return all.length >= MIN_GENERATORS_PER_SPEC ? { generators: all, legacy: true } : null;
  if (!subcategoryId) return null;
  const own = all.filter((g) => g.subcategoryId === subcategoryId);
  return own.length >= MIN_FAMILIES_PER_SUBCATEGORY ? { generators: own, legacy: false } : null;
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
