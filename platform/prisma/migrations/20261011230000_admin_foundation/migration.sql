-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('owner', 'moderator', 'support');

-- CreateEnum
CREATE TYPE "SanctionAppealStatus" AS ENUM ('open', 'upheld', 'rejected');

-- CreateEnum
CREATE TYPE "RedFlagTarget" AS ENUM ('invitation', 'vacancy');

-- CreateEnum
CREATE TYPE "RedFlagReviewStatus" AS ENUM ('open', 'ok', 'hidden', 'warned');

-- AlterTable
ALTER TABLE "AssessmentObjection" ADD COLUMN     "answeredById" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedById" TEXT,
ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "blockedUntil" TIMESTAMP(3),
ADD COLUMN     "verificationEvidence" TEXT,
ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verificationRequestedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedById" TEXT,
ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "blockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StaffMember" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "totpLastStep" INTEGER,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SanctionAppeal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "authorId" TEXT,
    "text" TEXT NOT NULL,
    "status" "SanctionAppealStatus" NOT NULL DEFAULT 'open',
    "resolvedById" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SanctionAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedFlagReview" (
    "id" TEXT NOT NULL,
    "targetType" "RedFlagTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "flags" JSONB NOT NULL,
    "status" "RedFlagReviewStatus" NOT NULL DEFAULT 'open',
    "resolvedById" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RedFlagReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PlatformSettingVersion" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSettingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_email_key" ON "StaffMember"("email");

-- CreateIndex
CREATE INDEX "AdminSession_staffId_createdAt_idx" ON "AdminSession"("staffId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorId_createdAt_idx" ON "AdminAuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "SanctionAppeal_status_createdAt_idx" ON "SanctionAppeal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SanctionAppeal_companyId_createdAt_idx" ON "SanctionAppeal"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "RedFlagReview_status_createdAt_idx" ON "RedFlagReview"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RedFlagReview_targetType_targetId_key" ON "RedFlagReview"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "PlatformSettingVersion_key_createdAt_idx" ON "PlatformSettingVersion"("key", "createdAt");

-- CreateIndex
CREATE INDEX "Complaint_status_createdAt_idx" ON "Complaint"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SanctionAppeal" ADD CONSTRAINT "SanctionAppeal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSettingVersion" ADD CONSTRAINT "PlatformSettingVersion_key_fkey" FOREIGN KEY ("key") REFERENCES "PlatformSetting"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- Журнал персонала неизменяем и на уровне БД (ADR 0009): UPDATE и DELETE запрещены триггером.
-- TRUNCATE (очистка тестовой БД) триггер не задевает.
CREATE FUNCTION "admin_audit_log_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AdminAuditLog is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AdminAuditLog_immutable"
  BEFORE UPDATE OR DELETE ON "AdminAuditLog"
  FOR EACH ROW EXECUTE FUNCTION "admin_audit_log_immutable"();
