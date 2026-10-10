// Общие семейства между подкатегориями (ADR 0003, дополнение 11.10): TaskGenerator.shared, в пул — по common-map.ts.
import type { TaskGenerator } from '../types';

import { COMMON_DATA_GENERATORS } from './common-data';
import { COMMON_OPS_GENERATORS } from './common-ops';
import { COMMON_WEB_GENERATORS } from './common-web';

export const COMMON_GENERATORS: readonly TaskGenerator[] = [...COMMON_DATA_GENERATORS, ...COMMON_WEB_GENERATORS, ...COMMON_OPS_GENERATORS];
