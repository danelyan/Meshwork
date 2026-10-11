-- AlterEnum
ALTER TYPE "InvitationStatus" ADD VALUE 'closed_hired';

-- AlterEnum
ALTER TYPE "ApplicationStatus" ADD VALUE 'closed';

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "closeReason" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "sourceApplicationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_sourceApplicationId_key" ON "Invitation"("sourceApplicationId");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_sourceApplicationId_fkey" FOREIGN KEY ("sourceApplicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
