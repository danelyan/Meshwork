-- ADR 0008 п. 1: ИИ-защита проекта до приглашения — признак сессии защиты (CallSession.kind = defense).
-- AlterTable
ALTER TABLE "CallSession" ADD COLUMN "aiDefense" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "CallSession_projectSubmissionId_aiDefense_startedAt_idx" ON "CallSession"("projectSubmissionId", "aiDefense", "startedAt");
