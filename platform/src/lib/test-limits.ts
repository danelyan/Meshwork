// Лимиты длины основной фазы теста на грейд (MIN…MAX заданий). Чистый модуль без серверных импортов: его читают
// policy.ts (MIN_ITEMS, MAX_ITEMS), env.ts (TEST_ITEM_LIMITS) и клиентская страница теста (текст «N–M заданий»).
// Почему дефолт 7–10, а не длиннее, – docs/validation-results.md, «Длина теста и надёжность» (eval/test/length-sweep.ts).

export interface ItemLimits {
  min: number;
  max: number;
}

/** Дефолт политики adr-0002-v7: 7–10 заданий основной фазы (+ дозадавание до 3). */
export const DEFAULT_ITEM_LIMITS: Readonly<ItemLimits> = { min: 7, max: 10 };

/** Допустимые границы конфига: меньше 5 заданий решение неустойчиво, больше 20 – тест слишком долгий для жюри. */
export const ITEM_LIMITS_BOUNDS = { min: 5, max: 20 } as const;

/**
 * Разбор `TEST_ITEM_LIMITS=min,max` (например «9,12»). Пусто – null (дефолт). Неверный формат, min > max или выход за
 * ITEM_LIMITS_BOUNDS – исключение с понятным текстом (env.ts превращает его в ошибку старта).
 */
export function parseItemLimits(raw: string | undefined | null): ItemLimits | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(raw);
  if (!m) throw new Error(`TEST_ITEM_LIMITS – «min,max», например «9,12»; получено «${raw}»`);
  const min = Number(m[1]);
  const max = Number(m[2]);
  if (min > max) throw new Error(`TEST_ITEM_LIMITS: min ${min} больше max ${max}`);
  if (min < ITEM_LIMITS_BOUNDS.min || max > ITEM_LIMITS_BOUNDS.max) {
    throw new Error(`TEST_ITEM_LIMITS: допустимо ${ITEM_LIMITS_BOUNDS.min}…${ITEM_LIMITS_BOUNDS.max} заданий, получено ${min},${max}`);
  }
  return { min, max };
}

/** «7–10» или «10» при min = max – для текстов интерфейса. */
export function formatItemRange(l: ItemLimits): string {
  return l.min === l.max ? String(l.max) : `${l.min}–${l.max}`;
}
