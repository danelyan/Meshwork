-- CreateEnum
CREATE TYPE "ProjectTaskVisibility" AS ENUM ('open', 'invited');

-- CreateEnum
CREATE TYPE "ProjectAssignmentStatus" AS ENUM ('active', 'submitted');

-- AlterEnum
-- IF NOT EXISTS: часть значений уже добавила миграция лейна call (20261010110038_call_sessions).
ALTER TYPE "LlmPurpose" ADD VALUE IF NOT EXISTS 'call_interviewer';
ALTER TYPE "LlmPurpose" ADD VALUE IF NOT EXISTS 'call_evaluator';
ALTER TYPE "LlmPurpose" ADD VALUE IF NOT EXISTS 'defense_qlc';
ALTER TYPE "LlmPurpose" ADD VALUE IF NOT EXISTS 'project_spec';
ALTER TYPE "LlmPurpose" ADD VALUE IF NOT EXISTS 'project_rubric';

-- AlterEnum: ожидающая защита (приглашение работодателя, кандидат ещё не начал)
ALTER TYPE "CallStatus" ADD VALUE IF NOT EXISTS 'pending';

-- CreateTable
CREATE TABLE "ProjectTemplate" (
    "id" TEXT NOT NULL,
    "subcategoryId" TEXT NOT NULL,
    "specialization" TEXT NOT NULL,
    "grade" "Grade" NOT NULL,
    "title" TEXT NOT NULL,
    "contractMd" TEXT NOT NULL,
    "dirRef" TEXT NOT NULL,
    "hiddenTestsRef" TEXT NOT NULL,
    "visibleTestsRef" TEXT NOT NULL,
    "stackTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "image" TEXT NOT NULL,
    "timeBudgetMin" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTask" (
    "id" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "specialization" TEXT NOT NULL,
    "grade" "Grade" NOT NULL,
    "subcategoryId" TEXT,
    "visibility" "ProjectTaskVisibility" NOT NULL DEFAULT 'open',
    "specJson" JSONB NOT NULL,
    "requiredCatalogIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wishesText" TEXT,
    "rubricJson" JSONB NOT NULL,
    "deadlineDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAssignment" (
    "id" TEXT NOT NULL,
    "projectTaskId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" "ProjectAssignmentStatus" NOT NULL DEFAULT 'active',
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAssignment_pkey" PRIMARY KEY ("id")
);

-- AlterTable: ProjectSubmission создана миграцией 20261010170000_defense_room (контракт-заглушка); добавляем поля лейна project
ALTER TABLE "ProjectSubmission" ADD COLUMN "runnerJobId" TEXT,
ADD COLUMN "error" TEXT,
ADD COLUMN "defenseInvitationId" TEXT,
ADD COLUMN "late" BOOLEAN NOT NULL DEFAULT false;

-- DropIndex
DROP INDEX "ProjectSubmission_candidateId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTask_vacancyId_key" ON "ProjectTask"("vacancyId");

-- CreateIndex
CREATE INDEX "ProjectTask_specialization_grade_visibility_idx" ON "ProjectTask"("specialization", "grade", "visibility");

-- CreateIndex
CREATE INDEX "ProjectAssignment_candidateId_status_idx" ON "ProjectAssignment"("candidateId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAssignment_projectTaskId_candidateId_key" ON "ProjectAssignment"("projectTaskId", "candidateId");

-- CreateIndex
CREATE INDEX "ProjectSubmission_projectTaskId_submittedAt_idx" ON "ProjectSubmission"("projectTaskId", "submittedAt");

-- CreateIndex
CREATE INDEX "ProjectSubmission_candidateId_submittedAt_idx" ON "ProjectSubmission"("candidateId", "submittedAt");

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProjectTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_projectTaskId_fkey" FOREIGN KEY ("projectTaskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSubmission" ADD CONSTRAINT "ProjectSubmission_projectTaskId_fkey" FOREIGN KEY ("projectTaskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSubmission" ADD CONSTRAINT "ProjectSubmission_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: CallSession.projectSubmissionId (поле создала 20261010110038_call_sessions, связь — lane project)
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_projectSubmissionId_fkey" FOREIGN KEY ("projectSubmissionId") REFERENCES "ProjectSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
