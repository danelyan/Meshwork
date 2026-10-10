// Вес достижений ФСП в ранжировании (R-M-02). Чистые функции, без БД.
// Модель достижений — НАШЕ ПРЕДЛОЖЕНИЕ (API ФСП не дан, CLAUDE.md п. 4): разбираем свободный текст
// события и результата по ключевым словам, поэтому переименование событий форму не ломает —
// неизвестное событие получает уровень «другое», неизвестный результат — «участие».
import {
  FSP_BOOST_MAX,
  FSP_HALF_LIFE_YEARS,
  FSP_LEVEL_WEIGHT,
  FSP_PER_POINT,
  FSP_PLACE_WEIGHT,
  FSP_QUALIFIER_FACTOR,
} from './weights';

/** Форма достижения из ФСП-источника (collector/fsp-demo.ts, FspAchievement): событие, год, результат. */
export interface FspAchievementInput {
  event: string;
  year: number;
  result: string;
  role?: string;
}

export type FspPlace = keyof typeof FSP_PLACE_WEIGHT;
export type FspLevel = keyof typeof FSP_LEVEL_WEIGHT;

export interface FspContribution {
  achievement: FspAchievementInput;
  place: FspPlace;
  level: FspLevel;
  qualifier: boolean;
  /** Очки до умножения на FSP_PER_POINT: место × уровень × затухание. */
  points: number;
  /** Вклад в балл до потолка. */
  boost: number;
}

export interface FspWeight {
  boost: number;
  /** Сумма до потолка больше потолка. */
  capped: boolean;
  contributions: FspContribution[];
  /** Короткие причины для объяснения, лучшие первыми (не больше двух). */
  reasons: string[];
}

export function fspPlace(result: string): FspPlace {
  const r = result.toLowerCase();
  if (/победител|чемпион|\b1\s*(-?е)?\s*место|первое место/.test(r)) return 'winner';
  if (/призёр|призер|\b[23]\s*(-?е)?\s*место|второе место|третье место|серебр|бронз/.test(r)) return 'prize';
  if (/финалист|\bфинал/.test(r)) return 'finalist';
  return 'participant';
}

export function fspLevel(event: string): FspLevel {
  const e = event.toLowerCase();
  if (/международ|мировой|world|icpc|international/.test(e)) return 'international';
  if (/всеросс|росси|национальн|федеральн/.test(e)) return 'national';
  if (/регион|област|края|краев|округ|городск|республик|межрегион/.test(e)) return 'regional';
  return 'other';
}

const isQualifier = (event: string, result: string) => /отбор|квалиф/.test(`${event} ${result}`.toLowerCase());

const PLACE_TEXT: Record<FspPlace, string> = { winner: 'победитель', prize: 'призёр', finalist: 'финалист', participant: 'участник' };

/** «+0,03» — вклад с запятой, как в остальных объяснениях. */
export function formatBoost(x: number): string {
  return `+${x.toFixed(3).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',')}`;
}

/**
 * Прибавка за достижения: Σ (место × уровень × 0,5^(давность / полураспад)) × FSP_PER_POINT, потолок FSP_BOOST_MAX.
 * Будущий год считается текущим. Пустой список — 0 (R-FSP-03: отсутствие ФСП не штраф).
 */
export function fspWeight(achievements: readonly FspAchievementInput[], refYear: number): FspWeight {
  const contributions: FspContribution[] = achievements.map((a) => {
    const place = fspPlace(a.result);
    const level = fspLevel(a.event);
    const qualifier = isQualifier(a.event, a.result);
    const age = Math.max(0, refYear - (Number.isFinite(a.year) ? a.year : refYear));
    const decay = 0.5 ** (age / FSP_HALF_LIFE_YEARS);
    const points = FSP_PLACE_WEIGHT[place] * FSP_LEVEL_WEIGHT[level] * (qualifier ? FSP_QUALIFIER_FACTOR : 1) * decay;
    return { achievement: a, place, level, qualifier, points, boost: points * FSP_PER_POINT };
  });
  const sum = contributions.reduce((s, c) => s + c.boost, 0);
  const boost = Math.round(Math.min(FSP_BOOST_MAX, sum) * 1e4) / 1e4;
  const best = [...contributions].sort((a, b) => b.boost - a.boost || a.achievement.event.localeCompare(b.achievement.event));
  const reasons = best
    .slice(0, 2)
    .filter((c) => c.boost >= 0.0005)
    .map((c) => `${PLACE_TEXT[c.place]}: ${c.achievement.event}, ${c.achievement.year}: ${formatBoost(c.boost)}`);
  return { boost, capped: sum > FSP_BOOST_MAX, contributions, reasons };
}
