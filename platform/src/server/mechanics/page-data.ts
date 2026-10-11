import { isSpecialization, SPECIALIZATIONS, type Specialization } from '@/lib/directions';

import { bankTotals, familiesOf, firstSubcategoryWithFamilies, labFamily, normalizeSeed, specOfSubcategory, subcategoryOptions } from './lab';
import type { MechanicsData } from '@/components/mechanics/MechanicsView';

/** Разбор query страницы: неизвестные значения заменяются первым допустимым, страница не падает. */
export function buildMechanicsData(q: { spec?: string; sub?: string; family?: string; seed?: string }): MechanicsData {
  const spec: Specialization = isSpecialization(q.spec) ? q.spec : SPECIALIZATIONS[0];
  const subcategories = subcategoryOptions(spec);
  const subOk = q.sub && specOfSubcategory(q.sub) === spec ? q.sub : null;
  const subcategoryId = subOk ?? firstSubcategoryWithFamilies(spec) ?? subcategories[0]?.id ?? null;
  const families = subcategoryId ? familiesOf(subcategoryId) : [];
  const picked = families.find((f) => f.id === q.family) ?? families[0] ?? null;
  const seed = normalizeSeed(q.seed);
  return { totals: bankTotals(), spec, subcategories, subcategoryId, families, family: picked ? labFamily(picked.id, seed) : null, seed };
}
