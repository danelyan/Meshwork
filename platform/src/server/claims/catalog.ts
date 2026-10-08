import { prisma } from '../db';
import { catalogFromFile, getCatalogMeta } from './catalog-file';
import type { CatalogEntry, CatalogMeta } from './types';

export { CATALOG_VERSION, catalogFor, catalogFromFile, getCatalogMeta } from './catalog-file';

/**
 * Каталог утверждений из БД (ClaimCatalog). Если таблица пуста (сид не прогнан) —
 * из файла, чтобы стенд не терял извлечение.
 */
export async function getCatalog(): Promise<CatalogEntry[]> {
  const rows = await prisma.claimCatalog.findMany({ orderBy: { id: 'asc' } });
  if (rows.length === 0) return catalogFromFile();
  return rows.map((r) => {
    // Строка, загруженная до миграции integrate_lanes (weights = null), — мета из файла.
    const fileMeta = r.weights === null ? getCatalogMeta(r.id) : undefined;
    return {
    id: r.id,
    specialization: r.specialization,
    statement: r.statement,
    grades: r.grades,
    weight: Math.min(3, Math.max(1, r.weight)) as 1 | 2 | 3,
    proof: r.proof,
    markers: r.markers,
    limits: r.limits,
    weights: (r.weights as CatalogMeta['weights'] | null) ?? fileMeta?.weights,
    stack: (r.stack as CatalogMeta['stack'] | null) ?? fileMeta?.stack ?? null,
    adjacent: r.adjacent.length > 0 ? r.adjacent : (fileMeta?.adjacent ?? []),
    };
  });
}
