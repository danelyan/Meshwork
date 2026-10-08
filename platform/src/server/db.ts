import { PrismaClient } from '@prisma/client';

// Один экземпляр на процесс; в dev переживает hot reload через globalThis
// (docs Prisma: «PrismaClient singleton» для Next.js).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export type { Prisma } from '@prisma/client';
