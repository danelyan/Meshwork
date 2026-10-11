// Действующие лимиты длины теста на грейд: TEST_ITEM_LIMITS из окружения или дефолт policy.ts (MIN_ITEMS…MAX_ITEMS).
import { getEnv } from '../env';

import type { ItemLimits } from '@/lib/test-limits';

import { MAX_ITEMS, MIN_ITEMS } from './policy';

export function activeItemLimits(): ItemLimits {
  return getEnv().TEST_ITEM_LIMITS ?? { min: MIN_ITEMS, max: MAX_ITEMS };
}
