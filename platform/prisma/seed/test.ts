import type { PrismaClient } from '@prisma/client';

import { GENERATORS } from '../../src/server/test/generators';

/**
 * Сид лейна test: шаблоны TaskTemplate из реестра генераторов. Идемпотентен: новые
 * шаблоны создаются, у существующих обновляются метаданные, а irtA/irtB не трогаются,
 * если paramsSource = calibrated (значения после живой разметки, docs/test-calibration.md).
 */
export async function seedTest(prisma: PrismaClient): Promise<void> {
  for (const g of GENERATORS) {
    if (g.grade === 'senior') continue; // senior в БД - после миграции enum Grade (лейн directions)
    const meta = { taskId: g.taskId, title: g.title, specialization: g.specialization, grade: g.grade, catalogIds: g.catalogIds, format: g.format };
    const existing = await prisma.taskTemplate.findUnique({ where: { id: g.id }, select: { paramsSource: true } });
    if (!existing) {
      await prisma.taskTemplate.create({ data: { id: g.id, ...meta, irtA: g.a, irtB: g.b } });
    } else if (existing.paramsSource === 'calibrated') {
      await prisma.taskTemplate.update({ where: { id: g.id }, data: meta });
    } else {
      await prisma.taskTemplate.update({ where: { id: g.id }, data: { ...meta, irtA: g.a, irtB: g.b } });
    }
  }
  console.log(`seed(test): ${GENERATORS.length} task templates`);
}
