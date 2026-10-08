import type { CatalogEntry } from '@/server/claims/types';
import { DEMO_TASKS, DEMO_VACANCIES } from '../../prisma/seed/recommend';

/** Каталог-фикстура: все catalogId из сида, формулировка «Утверждение <id>». */
export function fixtureEntries(overrides: Record<string, Partial<CatalogEntry>> = {}): CatalogEntry[] {
  const ids = new Set<string>([
    ...DEMO_VACANCIES.flatMap((v) => v.needs.map(([id]) => id)),
    ...DEMO_TASKS.flatMap((t) => t.catalogIds),
    'be.message-queue', 'be.background-jobs', 'common.auth-flow', 'common.unit-tests', 'fe.e2e-tests', 'fe.render-perf',
  ]);
  return [...ids].sort().map((id) => ({
    id,
    specialization: id.startsWith('be.') ? 'backend' : id.startsWith('fe.') ? 'frontend' : 'common',
    statement: `Утверждение ${id}`,
    grades: ['junior', 'middle'],
    weight: 2,
    proof: [`task:${id}`],
    markers: [],
    limits: '',
    ...overrides[id],
  })) as CatalogEntry[];
}

export function fixtureCatalog(overrides: Record<string, Partial<CatalogEntry>> = {}): Map<string, CatalogEntry> {
  return new Map(fixtureEntries(overrides).map((e) => [e.id, e]));
}
