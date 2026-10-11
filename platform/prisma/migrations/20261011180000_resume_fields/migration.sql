-- CreateEnum
CREATE TYPE "ResumeFieldStatus" AS ENUM ('applied', 'suggested', 'dismissed');

-- AlterTable
ALTER TABLE "CandidateProfile" ADD COLUMN     "experienceYears" INTEGER,
ADD COLUMN     "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "softSkills" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "ResumeField" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "uploadId" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "quote" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "status" "ResumeFieldStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResumeField_candidateId_key_key" ON "ResumeField"("candidateId", "key");

-- AddForeignKey
ALTER TABLE "ResumeField" ADD CONSTRAINT "ResumeField_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeField" ADD CONSTRAINT "ResumeField_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

