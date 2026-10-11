import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SUBCATEGORIES } from '@/lib/directions';

import { DEFAULT_SUBCATEGORY, DEMO_POOL_AI, DEMO_SUBCATEGORY } from '../../../prisma/seed/directions';
import { DEMO_POOL, type DemoProfile } from '../../../prisma/seed/employer';
import { DEMO_POOL_EXTRA } from '../../../prisma/seed/employer-pool';
import { DEMO_POOL_CATEGORIES } from '../../../prisma/seed/pool-categories';

// Поиск работодателя идёт по категории (подкатегория × грейд): в каждой из 51 должно найтись хотя бы двое демо-кандидатов.
const MIN_PER_CATEGORY = 2;
const GRADES = ['junior', 'middle', 'senior'] as const;

const ALL: DemoProfile[] = [...DEMO_POOL, ...DEMO_POOL_EXTRA, ...DEMO_POOL_AI, ...DEMO_POOL_CATEGORIES];
/** Подкатегория так, как её получит профиль в базе после сида (seedDirections дозаполняет пустые). */
const effectiveSub = (p: DemoProfile) => p.subcategoryId ?? DEMO_SUBCATEGORY[p.id] ?? (p.specialization ? DEFAULT_SUBCATEGORY[p.specialization] : undefined);

const raw = readFileSync(path.resolve(__dirname, '../../../prisma/seed/claims-catalog.json'), 'utf8');
const catalog = new Map<string, { specialization: string }>(JSON.parse(raw).entries.map((e: { id: string; specialization: string }) => [e.id, e]));

describe('демо-кандидаты по категориям', () => {
  it(`в каждой из ${SUBCATEGORIES.length * GRADES.length} категорий не меньше ${MIN_PER_CATEGORY} демо-кандидатов`, () => {
    const missing: string[] = [];
    for (const s of SUBCATEGORIES) {
      for (const g of GRADES) {
        const n = ALL.filter((p) => effectiveSub(p) === s.id && p.category?.grade === g).length;
        if (n < MIN_PER_CATEGORY) missing.push(`${s.id}/${g}: ${n}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('новые профили: id уникальны, префикс demo-cat-, подкатегория и категория своего направления', () => {
    const ids = ALL.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of DEMO_POOL_CATEGORIES) {
      expect(p.id, p.id).toMatch(/^demo-cat-[a-z-]+-[jms]-\d+$/);
      expect(p.name, p.id).toMatch(/^Демо: /);
      const sub = SUBCATEGORIES.find((s) => s.id === p.subcategoryId);
      expect(sub, `${p.id}: подкатегория ${p.subcategoryId}`).toBeDefined();
      expect(p.specialization, p.id).toBe(sub!.specialization);
      expect(p.category?.specialization, p.id).toBe(sub!.specialization);
      expect(p.contact ?? '', p.id).toMatch(/@example\.com$/);
    }
  });

  it('новые профили: утверждения из каталога своего направления или common, без повторов, 5–9 штук', () => {
    for (const p of DEMO_POOL_CATEGORIES) {
      const ids = p.claims.map(([id]) => id);
      expect(new Set(ids).size, p.id).toBe(ids.length);
      expect(ids.length, p.id).toBeGreaterThanOrEqual(5);
      expect(ids.length, p.id).toBeLessThanOrEqual(9);
      for (const id of ids) {
        const e = catalog.get(id);
        expect(e, `${p.id}: ${id}`).toBeDefined();
        expect([p.specialization, 'common'], `${p.id}: ${id}`).toContain(e!.specialization);
      }
    }
  });
});
