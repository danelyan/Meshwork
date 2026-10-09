-- CreateEnum
CREATE TYPE "CandidateGoal" AS ENUM ('job_search', 'market_watch', 'grade_confirm');

-- CreateEnum
CREATE TYPE "WorkFormat" AS ENUM ('remote', 'hybrid', 'office', 'relocation');

-- CreateEnum
CREATE TYPE "FspParticipation" AS ENUM ('prize', 'participant', 'none');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "contact" TEXT,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "inn" TEXT;

-- Vacancy.stack и Vacancy.teamDescription уже добавлены миграцией 202610091001_employer_cabinet.

-- CreateTable
CREATE TABLE "CandidateProfile" (
    "candidateId" TEXT NOT NULL,
    "goal" "CandidateGoal",
    "claimedGrade" "Grade",
    "stack" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "workFormats" "WorkFormat"[] DEFAULT ARRAY[]::"WorkFormat"[],
    "salaryMin" INTEGER,
    "salaryExpected" INTEGER,
    "fspParticipation" "FspParticipation",
    "city" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("candidateId")
);

-- CreateTable
CREATE TABLE "OnboardingState" (
    "userId" TEXT NOT NULL,
    "stepId" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "skipped" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lines" JSONB NOT NULL DEFAULT '{}',
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingState_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "CandidateProfile" ADD CONSTRAINT "CandidateProfile_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingState" ADD CONSTRAINT "OnboardingState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
