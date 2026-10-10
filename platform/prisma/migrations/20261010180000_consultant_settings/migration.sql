-- CreateTable
CREATE TABLE "ConsultantSettings" (
    "candidateId" TEXT NOT NULL,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom" VARCHAR(500),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultantSettings_pkey" PRIMARY KEY ("candidateId")
);

-- AddForeignKey
ALTER TABLE "ConsultantSettings" ADD CONSTRAINT "ConsultantSettings_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
