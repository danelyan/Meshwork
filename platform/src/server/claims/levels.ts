import type { SourceKind } from '../collector/types';
import type { EvidenceLevel } from './types';

/** Максимальный уровень доказанности по типу источника (ADR-0001). */
export function maxLevelFor(kind: SourceKind, opts?: { ownershipVerified?: boolean }): EvidenceLevel {
  void kind;
  void opts;
  throw new Error('not implemented: claims');
}
