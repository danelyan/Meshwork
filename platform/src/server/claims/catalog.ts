import type { CatalogEntry } from './types';

/** Каталог утверждений из БД (ClaimCatalog). */
export async function getCatalog(): Promise<CatalogEntry[]> {
  throw new Error('not implemented: claims');
}
