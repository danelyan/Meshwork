import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SPECIALIZATIONS, SUBCATEGORIES } from '@/lib/directions';
import { AXES, AXIS_WEIGHTS, BLOCK_DEFS, COMPETENCIES, blockCompetencies, competenciesFor, competencyById, gradeForLevel, levelForGrade, orderTechnical } from '@/server/interview/model';

const catalog = JSON.parse(readFileSync(join(process.cwd(), 'prisma/seed/claims-catalog.json'), 'utf8')) as { entries: { id: string; specialization: string }[] };
const catalogIds = new Map(catalog.entries.map((e) => [e.id, e.specialization]));
const doc = readFileSync(join(process.cwd(), '../docs/competency-model.md'), 'utf8');

describe('модель компетенций (docs/competency-model.md)', () => {
  it('id уникальны, у каждой компетенции есть фокус по трём грейдам', () => {
    const ids = COMPETENCIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of COMPETENCIES) {
      expect(c.id.startsWith(`${c.specialization}.`)).toBe(true);
      for (const g of ['junior', 'middle', 'senior'] as const) expect(c.focus[g].length).toBeGreaterThan(20);
    }
  });

  it('все утверждения каталога существуют и принадлежат направлению компетенции или common', () => {
    for (const c of COMPETENCIES) {
      for (const id of c.catalogIds) {
        expect(catalogIds.has(id), `${c.id}: ${id} нет в каталоге`).toBe(true);
        const spec = catalogIds.get(id);
        expect(spec === 'common' || spec === c.specialization, `${c.id}: ${id} из ${spec}`).toBe(true);
      }
    }
  });

  it('ядро подкатегорий – только существующие подкатегории своего направления; у каждой активной подкатегории есть ядро', () => {
    const sub = new Map(SUBCATEGORIES.map((s) => [s.id, s.specialization]));
    for (const c of COMPETENCIES) for (const s of c.core) expect(sub.get(s), `${c.id}: ${s}`).toBe(c.specialization);
    for (const s of SUBCATEGORIES.filter((x) => x.status === 'active')) {
      expect(COMPETENCIES.some((c) => c.axis === 'technical' && c.core.includes(s.id)), `нет ядра для ${s.id}`).toBe(true);
    }
  });

  it('у каждого направления ≥ 6 технических и ровно одна системная компетенция; общих две', () => {
    for (const spec of SPECIALIZATIONS) {
      const list = competenciesFor(spec);
      expect(list.filter((c) => c.axis === 'technical').length).toBeGreaterThanOrEqual(6);
      expect(list.filter((c) => c.axis === 'systems')).toHaveLength(1);
      expect(blockCompetencies('intro', spec).map((c) => c.id)).toEqual(['common.context']);
      expect(blockCompetencies('team', spec).map((c) => c.id)).toEqual(['common.teamwork']);
      expect(blockCompetencies('summary', spec)).toHaveLength(0);
    }
    expect(COMPETENCIES.filter((c) => c.specialization === 'common')).toHaveLength(2);
  });

  it('названия компетенций уникальны внутри направления (вместе с общими): по ним оценщик и карта глубины', () => {
    for (const spec of SPECIALIZATIONS) {
      const titles = [...competenciesFor(spec), ...COMPETENCIES.filter((c) => c.specialization === 'common')].map((c) => c.title);
      expect(new Set(titles).size).toBe(titles.length);
    }
  });

  it('ядро подкатегории – первым в порядке технических компетенций', () => {
    const o = orderTechnical('backend', 'backend.highload');
    expect(o[0]!.id).toBe('backend.performance');
    expect(orderTechnical('backend', null).map((c) => c.id)).toEqual(competenciesFor('backend').filter((c) => c.axis === 'technical').map((c) => c.id));
  });

  it('BI-интервью начинает с BI-компетенции и покрывает утверждения её банка', () => {
    const first = orderTechnical('ai', 'ai.bi-analytics')[0]!;
    expect(first.id).toBe('ai.bi');
    expect(first.catalogIds).toEqual(catalog.entries.filter((entry) => entry.id.startsWith('ai.bi-')).map((entry) => entry.id));
  });

  it('оси, веса и блоки – как в документе', () => {
    expect(AXES).toEqual(['technical', 'systems', 'communication', 'grade_fit']);
    expect(Object.values(AXIS_WEIGHTS).reduce((s, w) => s + w, 0)).toBeCloseTo(1);
    expect(BLOCK_DEFS.map((b) => b.id)).toEqual(['intro', 'test', 'systems', 'team', 'summary']);
    expect(BLOCK_DEFS.reduce((s, b) => s + b.questions.max, 0)).toBe(7);
    expect(BLOCK_DEFS.reduce((s, b) => s + b.questions.min, 0)).toBe(5);
    expect(levelForGrade('senior')).toBe(3);
    expect(gradeForLevel(1)).toBe('junior');
    expect(competencyById('nope')).toBeNull();
  });

  it('документ docs/competency-model.md перечисляет каждую компетенцию и её утверждения', () => {
    for (const c of COMPETENCIES) {
      expect(doc.includes(`\`${c.id}\``), `в документе нет ${c.id}`).toBe(true);
      for (const id of c.catalogIds) expect(doc.includes(id), `в документе нет ${id} у ${c.id}`).toBe(true);
    }
  });
});
