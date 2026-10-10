// Расширение банка AI (решение владельца 11.10): +12 семейств на подкатегорию (3 Junior, 5 Middle, 4 Senior).
import type { TaskGenerator } from '../types';

import { AI_BANK2_LLM } from './ai-bank2-llm';

export const AI_BANK2_GENERATORS: TaskGenerator[] = [...AI_BANK2_LLM];
