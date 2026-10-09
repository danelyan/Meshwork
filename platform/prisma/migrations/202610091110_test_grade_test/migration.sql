-- CreateEnum
CREATE TYPE "TestAttemptStatus" AS ENUM ('active', 'passed', 'not_confirmed', 'abandoned');

-- CreateTable
CREATE TABLE "TaskTemplate" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "specialization" "Specialization" NOT NULL,
    "grade" "Grade" NOT NULL,
    "catalogIds" TEXT[],
    "format" TEXT NOT NULL,
    "irtA" DOUBLE PRECISION NOT NULL,
    "irtB" DOUBLE PRECISION NOT NULL,
    "paramsSource" TEXT NOT NULL DEFAULT 'expert',
    "exposure" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAttempt" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "specialization" "Specialization" NOT NULL,
    "grade" "Grade" NOT NULL,
    "status" "TestAttemptStatus" NOT NULL DEFAULT 'active',
    "mode" TEXT NOT NULL DEFAULT 'full',
    "seed" INTEGER NOT NULL,
    "theta" DOUBLE PRECISION,
    "se" DOUBLE PRECISION,
    "pPass" DOUBLE PRECISION,
    "pJunior" DOUBLE PRECISION,
    "juniorOffered" BOOLEAN NOT NULL DEFAULT false,
    "juniorConfirmedAt" TIMESTAMP(3),
    "policyVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TestAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestItem" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "templateId" TEXT NOT NULL,
    "instanceSeed" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "prompt" TEXT NOT NULL,
    "code" TEXT,
    "answerHint" TEXT NOT NULL,
    "answerKey" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "answer" TEXT,
    "correct" BOOLEAN,
    "thetaAfter" DOUBLE PRECISION,
    "seAfter" DOUBLE PRECISION,
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "TestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestAttempt_candidateId_startedAt_idx" ON "TestAttempt"("candidateId", "startedAt");

-- CreateIndex
CREATE INDEX "TestAttempt_candidateId_status_idx" ON "TestAttempt"("candidateId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TestItem_attemptId_index_key" ON "TestItem"("attemptId", "index");

-- AddForeignKey
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestItem" ADD CONSTRAINT "TestItem_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "TestAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestItem" ADD CONSTRAINT "TestItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaskTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
