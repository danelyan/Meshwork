-- lane integrity (ADR-0002, дополнение 11.10): индекс честности теста и подтверждающий тест. Только аддитивно.
-- AlterEnum
ALTER TYPE "TestAttemptStatus" ADD VALUE 'needs_confirmation';

-- AlterTable
ALTER TABLE "TestAttempt" ADD COLUMN     "confirmsAttemptId" TEXT,
ADD COLUMN     "integrity" JSONB,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'grade',
ADD COLUMN     "signals" JSONB;

-- AlterTable
ALTER TABLE "TestItem" ADD COLUMN     "canaryShift" INTEGER,
ADD COLUMN     "timeLimitSec" INTEGER;
