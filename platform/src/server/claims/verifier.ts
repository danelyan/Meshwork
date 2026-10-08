import type { ExtractedDoc } from '../collector/types';
import type { CatalogEntry, ProposedClaim, VerifyResult } from './types';

/** Цитата дословно в источнике, ID в каталоге, без дублей. Уровень ставит код. */
export function verifyClaims(p: ProposedClaim[], docs: ExtractedDoc[], catalog: CatalogEntry[]): VerifyResult {
  void p;
  void docs;
  void catalog;
  throw new Error('not implemented: claims');
}
