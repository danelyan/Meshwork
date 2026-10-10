CREATE TABLE "UserSavedVacancy" (
    "userId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserSavedVacancy_pkey" PRIMARY KEY ("userId", "vacancyId")
);

CREATE TABLE "UserSavedCandidate" (
    "userId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserSavedCandidate_pkey" PRIMARY KEY ("userId", "candidateId")
);

CREATE INDEX "UserSavedVacancy_vacancyId_idx" ON "UserSavedVacancy"("vacancyId");
CREATE INDEX "UserSavedCandidate_candidateId_idx" ON "UserSavedCandidate"("candidateId");

ALTER TABLE "UserSavedVacancy" ADD CONSTRAINT "UserSavedVacancy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSavedVacancy" ADD CONSTRAINT "UserSavedVacancy_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSavedCandidate" ADD CONSTRAINT "UserSavedCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSavedCandidate" ADD CONSTRAINT "UserSavedCandidate_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
