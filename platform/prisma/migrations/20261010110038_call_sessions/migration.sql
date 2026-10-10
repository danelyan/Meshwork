-- CreateEnum
CREATE TYPE "CallKind" AS ENUM ('qualifying', 'defense');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('active', 'finished', 'cancelled');

-- CreateEnum
CREATE TYPE "CallParticipantRole" AS ENUM ('employer');

-- CreateEnum
CREATE TYPE "EmployerQuestionStatus" AS ENUM ('queued', 'asked', 'answered');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LlmPurpose" ADD VALUE 'call_interviewer';
ALTER TYPE "LlmPurpose" ADD VALUE 'call_evaluator';
ALTER TYPE "LlmPurpose" ADD VALUE 'defense_qlc';
ALTER TYPE "LlmPurpose" ADD VALUE 'project_spec';
ALTER TYPE "LlmPurpose" ADD VALUE 'project_rubric';

-- CreateTable
CREATE TABLE "CallSession" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "kind" "CallKind" NOT NULL,
    "projectSubmissionId" TEXT,
    "status" "CallStatus" NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "transcriptJson" JSONB NOT NULL DEFAULT '[]',
    "audioPath" TEXT,
    "verdictJson" JSONB,
    "policyVersion" TEXT NOT NULL,

    CONSTRAINT "CallSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallParticipant" (
    "id" TEXT NOT NULL,
    "callSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CallParticipantRole" NOT NULL DEFAULT 'employer',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "aiMuted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CallParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployerQuestion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "projectSubmissionId" TEXT,
    "text" TEXT NOT NULL,
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredInCallSessionId" TEXT,
    "status" "EmployerQuestionStatus" NOT NULL DEFAULT 'queued',

    CONSTRAINT "EmployerQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallSession_candidateId_kind_status_idx" ON "CallSession"("candidateId", "kind", "status");

-- CreateIndex
CREATE INDEX "CallSession_projectSubmissionId_idx" ON "CallSession"("projectSubmissionId");

-- CreateIndex
CREATE INDEX "CallParticipant_callSessionId_idx" ON "CallParticipant"("callSessionId");

-- CreateIndex
CREATE INDEX "CallParticipant_userId_idx" ON "CallParticipant"("userId");

-- CreateIndex
CREATE INDEX "EmployerQuestion_candidateId_status_idx" ON "EmployerQuestion"("candidateId", "status");

-- CreateIndex
CREATE INDEX "EmployerQuestion_companyId_candidateId_idx" ON "EmployerQuestion"("companyId", "candidateId");

-- AddForeignKey
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "CallSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerQuestion" ADD CONSTRAINT "EmployerQuestion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerQuestion" ADD CONSTRAINT "EmployerQuestion_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerQuestion" ADD CONSTRAINT "EmployerQuestion_answeredInCallSessionId_fkey" FOREIGN KEY ("answeredInCallSessionId") REFERENCES "CallSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
