// Карта «подкатегория → общие компетенции» (ADR 0003, дополнение 11.10 «Общие компетенции в пуле подкатегории»).
// Пул попытки adr-0002-v7 = семейства подкатегории + общие семейства (TaskGenerator.shared) её компетенций; доля общих
// в попытке ≤ MAX_COMMON_SHARE (policy.ts). Одно место правды: лейны направлений общие семейства не размечают.
import { getSubcategory, type Specialization } from '@/lib/directions';

import type { CommonCompetency } from '../types';

/**
 * Компетенции по направлению – то, без чего специалист подкатегории не работает в любой её роли (обоснование –
 * в ADR). Backend: данные (SQL), протокол (HTTP), алгоритмы и структуры, Git, безопасность, конкурентность.
 * Frontend: HTTP, алгоритмы и структуры, Git, безопасность, регулярные выражения (валидация, парсинг строк).
 * AI: алгоритмы и структуры, SQL (выборки данных), Linux (обучение и сервинг на серверах), тестирование.
 * Engineering: Linux, Git, SQL, тестирование, HTTP.
 */
export const COMMON_BY_SPEC: Readonly<Record<Specialization, readonly CommonCompetency[]>> = {
  backend: ['common.sql', 'common.http', 'common.algorithms', 'common.data-structures', 'common.git', 'common.security', 'common.concurrency'],
  frontend: ['common.http', 'common.algorithms', 'common.data-structures', 'common.git', 'common.security', 'common.regex'],
  ai: ['common.algorithms', 'common.data-structures', 'common.sql', 'common.linux', 'common.testing'],
  engineering: ['common.linux', 'common.git', 'common.sql', 'common.testing', 'common.http'],
};

/** Точечные поправки по подкатегории (полная замена списка направления). Пусто – все подкатегории берут список направления. */
export const COMMON_BY_SUBCATEGORY: Readonly<Partial<Record<string, readonly CommonCompetency[]>>> = {};

/** Общие компетенции подкатегории; неизвестная подкатегория – пусто. */
export function commonCompetenciesFor(subcategoryId: string | null | undefined): readonly CommonCompetency[] {
  const sub = getSubcategory(subcategoryId);
  if (!sub) return [];
  return COMMON_BY_SUBCATEGORY[sub.id] ?? COMMON_BY_SPEC[sub.specialization];
}
