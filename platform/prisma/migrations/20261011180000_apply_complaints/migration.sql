-- lane apply + complaints: самоотклик (R-C-12) и жалобы на приглашения. Только новые таблицы и enum, существующие не меняются.
-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('sent', 'viewed', 'accepted', 'declined');
-- CreateEnum
CREATE TYPE "ComplaintReason" AS ENUM ('spam', 'salary_mismatch', 'offensive', 'fake_company', 'other');
-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('open', 'upheld', 'dismissed');
-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'sent',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "reason" "ComplaintReason" NOT NULL,
    "comment" TEXT,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "Application_vacancyId_status_idx" ON "Application"("vacancyId", "status");
-- CreateIndex
CREATE INDEX "Application_candidateId_createdAt_idx" ON "Application"("candidateId", "createdAt");
-- CreateIndex
CREATE UNIQUE INDEX "Application_vacancyId_candidateId_key" ON "Application"("vacancyId", "candidateId");
-- CreateIndex
CREATE UNIQUE INDEX "Complaint_invitationId_key" ON "Complaint"("invitationId");
-- CreateIndex
CREATE INDEX "Complaint_companyId_createdAt_idx" ON "Complaint"("companyId", "createdAt");
-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
