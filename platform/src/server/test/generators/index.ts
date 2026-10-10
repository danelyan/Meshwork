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
