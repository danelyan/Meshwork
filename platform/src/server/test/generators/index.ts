// Реестр генераторов: 12 Backend + 12 Frontend (ADR-0002) + 56 Engineering (ADR-0003, дополнение 10.10: 6J+4M+4S на подкатегорию). Параметры a, b здесь —
// стартовые экспертные; рабочие значения читаются из TaskTemplate (БД), куда их
// переносит сид и правит калибровка (docs/test-calibration.md).
import type { Specialization } from '../../types';
import type { TaskGenerator } from '../types';

import { BACKEND_GENERATORS } from './backend';
import { ENGINEERING_GENERATORS } from './engineering';
import { FRONTEND_GENERATORS } from './frontend';

export const GENERATORS: readonly TaskGenerator[] = [...BACKEND_GENERATORS, ...FRONTEND_GENERATORS, ...ENGINEERING_GENERATORS];

const BY_ID = new Map(GENERATORS.map((g) => [g.id, g]));

export function getGenerator(id: string): TaskGenerator | undefined {
  return BY_ID.get(id);
}

export function generatorsFor(spec: Specialization): TaskGenerator[] {
  return GENERATORS.filter((g) => g.specialization === spec);
}
