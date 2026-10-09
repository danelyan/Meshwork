import type { SourceKind } from '../collector/types';
import type { EvidenceLevel } from './types';

/**
 * Единственный источник порядка уровней доказанности, по возрастанию:
 * со слов < артефакт < третья сторона < проверено платформой (решение владельца 09.10:
 * тест и защита выше ФСП и референса). Ранги, веса покрытия, дедупликация и сортировки
 * в UI выводятся отсюда, свои списки и числа не заводить.
 */
export const LEVEL_ORDER: readonly EvidenceLevel[] = ['self_reported', 'artifact', 'third_party', 'platform'];

/** Уровни сверху вниз — для показа (профиль, карточка кандидата). */
export const LEVELS_TOP_DOWN: readonly EvidenceLevel[] = [...LEVEL_ORDER].reverse();

export function levelRank(level: EvidenceLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

/**
 * Что тест и защита поднимают до `platform`. third_party сюда не входит, хотя он ниже:
 * поднимать ли его — отдельное решение (пока защита отвечает 409 claim_already_verified).
 */
export const PLATFORM_UPGRADABLE: ReadonlySet<EvidenceLevel> = new Set(['self_reported', 'artifact']);

/**
 * Максимальный уровень доказанности по типу источника (ADR-0001 п. 2, E-01 § 4.2, план claims).
 * Уровень ставит код, не LLM и не кандидат.
 *  - resume / document / chat — со слов кандидата → self_reported;
 *  - github / url / stackoverflow — публичный артефакт → artifact;
 *  - codeforces / fsp — третья сторона, но только при подтверждённом владении аккаунтом,
 *    иначе это просто публичная страница → artifact.
 * `platform` отсюда не выдаётся никогда: его дают только тест и защита (свои модули).
 * Неизвестный kind (данные из Json/БД в обход типов) → самый низкий уровень.
 */
export function maxLevelFor(kind: SourceKind, opts?: { ownershipVerified?: boolean }): EvidenceLevel {
  switch (kind) {
    case 'resume':
    case 'document':
    case 'chat':
      return 'self_reported';
    case 'github':
    case 'url':
    case 'stackoverflow':
      return 'artifact';
    case 'codeforces':
    case 'fsp':
      return opts?.ownershipVerified === true ? 'third_party' : 'artifact';
    default:
      return 'self_reported';
  }
}
