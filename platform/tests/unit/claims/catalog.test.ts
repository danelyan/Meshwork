import { catalogFor, catalogFromFile, getCatalogMeta, CATALOG_VERSION } from '@/server/claims/catalog-file';

describe('каталог из prisma/seed/claims-catalog.json', () => {
  const cat = catalogFromFile();

  it('72 записи: backend 33, frontend 28, common 11; ID уникальны', () => {
    expect(cat).toHaveLength(72);
    expect(cat.filter((c) => c.specialization === 'backend')).toHaveLength(33);
    expect(cat.filter((c) => c.specialization === 'frontend')).toHaveLength(28);
    expect(cat.filter((c) => c.specialization === 'common')).toHaveLength(11);
    expect(new Set(cat.map((c) => c.id)).size).toBe(72);
    expect(CATALOG_VERSION).toMatch(/^claims-catalog-/);
  });

  it('у каждой записи: префикс по специализации, путь доказательства, маркеры, ограничение вывода, вес 1..3', () => {
    for (const c of cat) {
      expect(c.id.startsWith({ backend: 'be.', frontend: 'fe.', common: 'common.' }[c.specialization])).toBe(true);
      expect(c.proof.length).toBeGreaterThan(0);
      expect(c.proof.every((p) => /^(task|interview|registry):/.test(p))).toBe(true);
      expect(c.markers.length).toBeGreaterThan(0);
      expect(c.limits).toMatch(/^Не доказывает: /);
      expect([1, 2, 3]).toContain(c.weight);
      expect(c.grades.length).toBeGreaterThan(0);
      expect(c.statement).not.toMatch(/stack:|`/);
    }
  });

  it('веса J/M, stack и смежность — в meta; смежность симметрична', () => {
    expect(getCatalogMeta('be.idempotency')).toMatchObject({ weights: { junior: 1, middle: 3 }, stack: null });
    expect(getCatalogMeta('common.sql-queries')?.weights).toEqual({ backend: { junior: 3, middle: 2 }, frontend: { junior: 1, middle: 1 } });
    expect(getCatalogMeta('be.lang-core')?.stack).toEqual({ kind: 'язык' });
    for (const c of cat) for (const a of getCatalogMeta(c.id)?.adjacent ?? []) expect(getCatalogMeta(a)?.adjacent).toContain(c.id);
    expect(getCatalogMeta('be.idempotency')?.adjacent).toEqual(expect.arrayContaining(['be.message-queue', 'be.retries-timeouts']));
  });

  it('catalogFor: специализация + общие', () => {
    const be = catalogFor(cat, 'backend');
    expect(be).toHaveLength(44);
    expect(be.some((c) => c.specialization === 'frontend')).toBe(false);
    expect(catalogFor(cat, null)).toHaveLength(72);
  });
});
