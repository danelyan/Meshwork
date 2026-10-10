-- CreateEnum
CREATE TYPE "MemorySource" AS ENUM ('chat', 'user');

-- AlterEnum
ALTER TYPE "LlmPurpose" ADD VALUE 'consultant_memory';

-- CreateTable
CREATE TABLE "ConsultantMemory" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT,
    "employerProfileId" TEXT,
    "text" VARCHAR(200) NOT NULL,
    "source" "MemorySource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultantMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsultantMemory_candidateId_createdAt_idx" ON "ConsultantMemory"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultantMemory_employerProfileId_createdAt_idx" ON "ConsultantMemory"("employerProfileId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConsultantMemory" ADD CONSTRAINT "ConsultantMemory_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultantMemory" ADD CONSTRAINT "ConsultantMemory_employerProfileId_fkey" FOREIGN KEY ("employerProfileId") REFERENCES "EmployerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

