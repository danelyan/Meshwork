import { Prisma, type PrismaClient } from '@prisma/client';

import { catalogFromFile, CATALOG_VERSION } from './catalog-file';

/**
 * Загрузить каталог из prisma/seed/claims-catalog.json в ClaimCatalog (upsert по ID).
 * Записи, пропавшие из файла, не удаляются: на них ссылаются утверждения (каталог § 2.1 — deprecated, не стирать).
 * Клиент передаётся параметром: сид (prisma/seed.ts) живёт со своим PrismaClient.
 */
export async function syncClaimCatalog(client: PrismaClient): Promise<{ version: string; upserted: number }> {
  const entries = catalogFromFile();
  await client.$transaction(
    entries.map((e) => {
      const data = {
        specialization: e.specialization,
        statement: e.statement,
        grades: e.grades,
        weight: e.weight,
        proof: e.proof,
        markers: e.markers,
        limits: e.limits,
        weights: (e.weights ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
        stack: (e.stack ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
        adjacent: e.adjacent ?? [],
        catalogVersion: CATALOG_VERSION,
      };
      return client.claimCatalog.upsert({ where: { id: e.id }, update: data, create: { id: e.id, ...data } });
    }),
  );
  return { version: CATALOG_VERSION, upserted: entries.length };
}
