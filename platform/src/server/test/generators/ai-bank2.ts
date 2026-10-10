// Расширение банка AI (решение владельца 11.10): +12 семейств на подкатегорию (3 Junior, 5 Middle, 4 Senior).
import type { TaskGenerator } from '../types';

import { AI_BANK2_INTEGRATION } from './ai-bank2-integration';
import { AI_BANK2_ML } from './ai-bank2-ml';
import { AI_BANK2_MLOPS } from './ai-bank2-mlops';
import { AI_BANK2_LLM } from './ai-bank2-llm';

export const AI_BANK2_GENERATORS: TaskGenerator[] = [...AI_BANK2_LLM, ...AI_BANK2_INTEGRATION, ...AI_BANK2_ML, ...AI_BANK2_MLOPS];
