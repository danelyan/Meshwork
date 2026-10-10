-- CreateEnum
CREATE TYPE "ProjectSubmissionStatus" AS ENUM ('submitted', 'running', 'checked', 'failed');

-- CreateTable
CREATE TABLE "ProjectSubmission" (
    "id" TEXT NOT NULL,
    "projectTaskId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "commitSha" TEXT,
    "aiLogText" TEXT,
    "status" "ProjectSubmissionStatus" NOT NULL DEFAULT 'submitted',
    "resultJson" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefenseRoomPlan" (
    "id" TEXT NOT NULL,
    "callSessionId" TEXT NOT NULL,
    "itemsJson" JSONB NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "sourceJson" JSONB NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefenseRoomPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectSubmission_candidateId_idx" ON "ProjectSubmission"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "DefenseRoomPlan_callSessionId_key" ON "DefenseRoomPlan"("callSessionId");

