-- AlterEnum
ALTER TYPE "LlmPurpose" ADD VALUE 'interviewer';

-- AlterTable
ALTER TABLE "ClaimCatalog" ADD COLUMN     "adjacent" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "catalogVersion" TEXT,
ADD COLUMN     "stack" JSONB,
ADD COLUMN     "weights" JSONB;

-- Одна активная сессия защиты на утверждение (страховка к блокировке в startDefense).
-- Частичный индекс в schema.prisma на Prisma 6 не выражается — только сырым SQL.
-- ВНИМАНИЕ: следующий `prisma migrate dev` может предложить DROP этого индекса
-- как дрейф — такую строку из новой миграции удалять руками.
CREATE UNIQUE INDEX "DefenseSession_one_active" ON "DefenseSession"("claimId") WHERE "status" = 'active';
