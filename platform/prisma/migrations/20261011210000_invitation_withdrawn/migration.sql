-- AlterEnum
ALTER TYPE "InvitationStatus" ADD VALUE 'withdrawn';

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "withdrawReason" TEXT,
ADD COLUMN     "withdrawnAt" TIMESTAMP(3);

