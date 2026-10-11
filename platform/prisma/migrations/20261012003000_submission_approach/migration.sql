-- Сдача проектного задания «подходом» (ТЗ: решить или предложить подход)
CREATE TYPE "ProjectSubmissionKind" AS ENUM ('code', 'approach');
ALTER TABLE "ProjectSubmission" ADD COLUMN "kind" "ProjectSubmissionKind" NOT NULL DEFAULT 'code',
  ADD COLUMN "approachText" TEXT;
