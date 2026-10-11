// Справочник направлений и подкатегорий из БД (Subcategory, lane directions; ADR 0003, дополнение 10.10).
// Код и UI берут тот же список из src/lib/directions.ts (из него сидится таблица); этот модуль отдаёт
// таблицу как есть – правка статуса в БД видна в API без деплоя. Пустая таблица (сид не прогнан) – список из кода.
import { SPEC_LABEL, SPECIALIZATIONS, SUBCATEGORIES, type Specialization, type SubcategoryDef } from '@/lib/directions';

import { prisma } from './db';
import { hasTestFor } from './test/generators';

export interface DirectionView {
  id: Specialization;
  title: string;
  /** Есть ли тест на грейд (генераторы заданий). */
  testAvailable: boolean;
  subcategories: Omit<SubcategoryDef, 'specialization'>[];
}

export async function listDirections(): Promise<DirectionView[]> {
  const rows = await prisma.subcategory.findMany({ orderBy: [{ specialization: 'asc' }, { order: 'asc' }, { id: 'asc' }] });
  const subs: SubcategoryDef[] = rows.length > 0 ? rows : [...SUBCATEGORIES];
  return SPECIALIZATIONS.map((s) => ({
    id: s,
    title: SPEC_LABEL[s],
    testAvailable: hasTestFor(s),
    subcategories: subs
      .filter((x) => x.specialization === s)
      .sort((a, b) => a.order - b.order)
      .map((x) => ({ id: x.id, title: x.title, description: x.description, status: x.status, order: x.order })),
  }));
}
