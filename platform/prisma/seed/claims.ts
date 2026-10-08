import type { PrismaClient } from '@prisma/client';

import { syncClaimCatalog } from '../../src/server/claims/catalog-sync';

/** Сид лейна claims: каталог утверждений из prisma/seed/claims-catalog.json. */
export async function seedClaims(prisma: PrismaClient): Promise<void> {
  const r = await syncClaimCatalog(prisma);
  console.log(`seed: claim catalog ${r.version}, ${r.upserted} entries`);
}
