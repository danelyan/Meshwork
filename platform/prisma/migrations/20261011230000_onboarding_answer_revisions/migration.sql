-- CreateTable
CREATE TABLE "OnboardingAnswerRevision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "value" JSONB,
    "previous" JSONB,
    "source" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingAnswerRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingAnswerRevision_userId_createdAt_idx" ON "OnboardingAnswerRevision"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "OnboardingAnswerRevision" ADD CONSTRAINT "OnboardingAnswerRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
