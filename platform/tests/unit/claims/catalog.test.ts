import { catalogFor, catalogFromFile, getCatalogMeta, CATALOG_VERSION } from '@/server/claims/catalog-file';

describe('каталог из prisma/seed/claims-catalog.json', () => {
  const cat = catalogFromFile();

  it('142 записи: backend 36, frontend 31, ai 31, engineering 31, common 13; ID уникальны', () => {
    expect(cat).toHaveLength(142);
    expect(cat.filter((c) => c.specialization === 'ai')).toHaveLength(31);
    expect(cat.filter((c) => c.specialization === 'backend')).toHaveLength(36);
    expect(cat.filter((c) => c.specialization === 'frontend')).toHaveLength(31);
    expect(cat.filter((c) => c.specialization === 'common')).toHaveLength(13);
    expect(cat.filter((c) => c.specialization === 'engineering')).toHaveLength(31);
    expect(new Set(cat.map((c) => c.id)).size).toBe(142);
    expect(CATALOG_VERSION).toMatch(/^claims-catalog-/);
  });

  it('у каждой записи: префикс по специализации, путь доказательства, маркеры, ограничение вывода, вес 1..3', () => {
    for (const c of cat) {
      expect(c.id.startsWith({ backend: 'be.', frontend: 'fe.', ai: 'ai.', engineering: 'eng.', common: 'common.' }[c.specialization])).toBe(true);
      expect(c.proof.length).toBeGreaterThan(0);
      expect(c.proof.every((p) => /^(task|interview|registry):/.test(p))).toBe(true);
      expect(c.markers.length).toBeGreaterThan(0);
      expect(c.limits.length).toBeGreaterThan(3);
      expect(c.limits).not.toMatch(/^Не доказывает/); // префикс добавляет UI
      expect([1, 2, 3]).toContain(c.weight);
      expect(c.grades.length).toBeGreaterThan(0);
      expect(c.statement).not.toMatch(/stack:|`/);
    }
  });

  it('пользовательские тексты (statement, limits) не содержат технических ID', () => {
    for (const c of cat) {
      expect(c.statement).not.toMatch(/\b(be|fe|ai|eng|common)\.[a-z0-9-]+/);
      expect(c.limits).not.toMatch(/\b(be|fe|ai|eng|common)\.[a-z0-9-]+/);
    }
  });

  it('веса J/M, stack и смежность — в meta; смежность симметрична', () => {
    expect(getCatalogMeta('be.idempotency')).toMatchObject({ weights: { junior: 1, middle: 3, senior: 3 }, stack: null });
    expect(getCatalogMeta('common.sql-queries')?.weights).toEqual({
      backend: { junior: 3, middle: 2, senior: 2 },
      frontend: { junior: 1, middle: 1, senior: 1 },
      ai: { junior: 2, middle: 2, senior: 2 },
      engineering: { junior: 2, middle: 2, senior: 2 },
    });
    expect(getCatalogMeta('be.lang-core')?.stack).toEqual({ kind: 'язык' });
    for (const c of cat) for (const a of getCatalogMeta(c.id)?.adjacent ?? []) expect(getCatalogMeta(a)?.adjacent).toContain(c.id);
    expect(getCatalogMeta('be.idempotency')?.adjacent).toEqual(expect.arrayContaining(['be.message-queue', 'be.retries-timeouts']));
  });

  it('catalogFor: специализация + общие', () => {
    const be = catalogFor(cat, 'backend');
    expect(be).toHaveLength(49);
    expect(be.some((c) => c.specialization === 'frontend')).toBe(false);
    expect(catalogFor(cat, null)).toHaveLength(142);
    expect(catalogFor(cat, 'engineering')).toHaveLength(44);
    expect(catalogFor(cat, 'ai')).toHaveLength(44);
  });

  it('колонка S: у каждой таблицы весов есть senior; Senior-only записи без J/M; базовое у Senior легче, архитектура тяжелее', () => {
    for (const c of cat) {
      const w = getCatalogMeta(c.id)?.weights;
      const tables = w && 'junior' in w ? [w] : Object.values(w ?? {});
      for (const t of tables) expect(t, c.id).toHaveProperty('senior');
    }
    const seniorOnly = cat.filter((c) => c.grades.length === 1 && c.grades[0] === 'senior');
    expect(seniorOnly.length).toBeGreaterThanOrEqual(15);
    for (const s of ['backend', 'frontend', 'ai', 'engineering']) expect(seniorOnly.some((c) => c.specialization === s), s).toBe(true);
    expect(getCatalogMeta('be.system-design')?.weights).toEqual({ junior: null, middle: null, senior: 3 });
    expect(getCatalogMeta('be.lang-core')?.weights).toEqual({ junior: 3, middle: 3, senior: 2 });
    expect(getCatalogMeta('be.service-boundaries')?.weights).toEqual({ junior: null, middle: 2, senior: 3 });
  });
});
