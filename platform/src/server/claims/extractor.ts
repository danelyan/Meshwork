import type { ExtractedDoc } from '../collector/types';
import type { LlmProvider } from '../llm/types';
import type { CatalogEntry, ProposedClaim } from './types';

export async function extractClaims(doc: ExtractedDoc, catalog: CatalogEntry[], llm: LlmProvider): Promise<ProposedClaim[]> {
  void doc;
  void catalog;
  void llm;
  throw new Error('not implemented: claims');
}
