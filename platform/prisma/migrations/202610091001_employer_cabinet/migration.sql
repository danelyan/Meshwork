-- AlterEnum
ALTER TYPE "InvitationStatus" ADD VALUE 'viewed';

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "hiddenFromEmployers" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "employerProfileId" TEXT,
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "viewedAt" TIMESTAMP(3),
ALTER COLUMN "vacancyId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Vacancy" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "stack" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "teamDescription" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Invitation_companyId_createdAt_idx" ON "Invitation"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_employerProfileId_fkey" FOREIGN KEY ("employerProfileId") REFERENCES "EmployerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: компания приглашения — из его вакансии (строки до lane employer).
UPDATE "Invitation" i SET "companyId" = v."companyId" FROM "Vacancy" v WHERE i."vacancyId" = v."id" AND i."companyId" IS NULL;
