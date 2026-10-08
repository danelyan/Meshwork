import type { SourceKind } from '../collector/types';
import type { EvidenceLevel } from './types';

/**
 * Порядок уровней по устойчивости к подделке (ADR-0001, «Чего решение не утверждает»):
 * со слов < артефакт < платформа < третья сторона.
 */
export const LEVEL_ORDER: readonly EvidenceLevel[] = ['self_reported', 'artifact', 'platform', 'third_party'];

export function levelRank(level: EvidenceLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

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
