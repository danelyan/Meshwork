import type { Specialization } from '@/lib/directions';
import catalogFile from '../../../prisma/seed/claims-catalog.json';
import type { CatalogEntry, CatalogMeta } from './types';

/**
 * Каталог утверждений. Источник – prisma/seed/claims-catalog.json, сгенерированный
 * scripts/catalog-to-json.mjs из fsp/docs/product/claims-catalog.md (правит владелец).
 * В БД (ClaimCatalog) – все поля CatalogEntry, включая веса по грейдам, stack,
 * смежность и версию каталога (миграция integrate_lanes).
 */
interface FileEntry extends Omit<CatalogEntry, 'weights' | 'stack' | 'adjacent'>, Omit<CatalogMeta, 'id'> {}
interface CatalogFile {
  version: string;
  entries: FileEntry[];
}

const FILE = catalogFile as unknown as CatalogFile;

export const CATALOG_VERSION = FILE.version;

function toEntry(e: FileEntry): CatalogEntry {
  return {
    id: e.id,
    specialization: e.specialization,
    statement: e.statement,
    grades: [...e.grades],
    weight: e.weight,
    proof: [...e.proof],
    markers: [...e.markers],
    limits: e.limits,
    weights: e.weights,
    stack: e.stack,
    adjacent: [...e.adjacent],
  };
}

/** Каталог из файла, без БД: eval, план В, тесты. */
export function catalogFromFile(): CatalogEntry[] {
  return FILE.entries.map(toEntry);
}

const META = new Map<string, CatalogMeta>(
  FILE.entries.map((e) => [e.id, { id: e.id, weights: e.weights, stack: e.stack, adjacent: [...e.adjacent] }]),
);

/** Веса по грейдам, stack, смежность записи из файла каталога. */
export function getCatalogMeta(id: string): CatalogMeta | undefined {
  return META.get(id);
}

/** Записи для специализации кандидата: свои + общие. Без специализации – весь каталог. */
export function catalogFor(catalog: CatalogEntry[], specialization?: Specialization | null): CatalogEntry[] {
  if (!specialization) return catalog;
  return catalog.filter((c) => c.specialization === specialization || c.specialization === 'common');
}
