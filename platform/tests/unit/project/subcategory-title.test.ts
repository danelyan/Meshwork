import { describe, expect, it } from 'vitest';

import { SUBCATEGORIES } from '@/lib/directions';
import { templateView } from '@/server/project/service';
import { getTemplates } from '@/server/project/templates';

// Название подкатегории в ленте заданий и карточке работодателя — из справочника src/lib/directions.ts.
// Раньше была заглушка на 5 подкатегорий из 18: для остальных показывался сырой id («backend.highload»).
describe('название подкатегории проектного задания', () => {
  it('для каждой подкатегории справочника — её название, а не id', () => {
    const base = getTemplates()[0]!;
    expect(SUBCATEGORIES.length).toBeGreaterThanOrEqual(18);
    for (const s of SUBCATEGORIES) {
      const view = templateView({ ...base, manifest: { ...base.manifest, subcategoryId: s.id } });
      expect(view.subcategoryTitle, s.id).toBe(s.title);
      expect(view.subcategoryTitle, s.id).not.toBe(s.id);
    }
  });

  it('шаблоны на диске: название из справочника', () => {
    for (const t of getTemplates()) {
      const def = SUBCATEGORIES.find((s) => s.id === t.manifest.subcategoryId);
      expect(def, t.manifest.id).toBeDefined();
      expect(templateView(t).subcategoryTitle, t.manifest.id).toBe(def!.title);
    }
  });
});
