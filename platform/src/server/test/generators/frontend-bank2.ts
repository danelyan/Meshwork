// Расширенный банк frontend (решение владельца 11.10): по +12 семейств на подкатегорию.
import type { TaskGenerator } from '../types';
import { DS_BANK2_GENERATORS } from './frontend-bank2-design-system';
import { RT_BANK2_GENERATORS } from './frontend-bank2-realtime';
import { UI_BANK2_GENERATORS } from './frontend-bank2-ui-app';
import { WP_BANK2_GENERATORS } from './frontend-bank2-web-perf';

export const FRONTEND_BANK2_GENERATORS: TaskGenerator[] = [...UI_BANK2_GENERATORS, ...DS_BANK2_GENERATORS, ...WP_BANK2_GENERATORS, ...RT_BANK2_GENERATORS];
