-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('pd_processing', 'call_recording', 'ai_assessment', 'employer_visibility', 'research', 'marketing', 'identity_disclosure', 'employer_offer', 'employer_data_obligation');

-- CreateEnum
CREATE TYPE "ObjectionSubject" AS ENUM ('grade_test', 'call', 'defense');

-- CreateEnum
CREATE TYPE "ObjectionStatus" AS ENUM ('open', 'answered');

-- AlterTable
ALTER TABLE "Consent" ADD COLUMN     "context" JSONB,
ADD COLUMN     "kind" "ConsentKind" NOT NULL DEFAULT 'pd_processing',
ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AssessmentObjection" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "subject" "ObjectionSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "ObjectionStatus" NOT NULL DEFAULT 'open',
    "answer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "AssessmentObjection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentObjection_candidateId_createdAt_idx" ON "AssessmentObjection"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "AssessmentObjection_status_createdAt_idx" ON "AssessmentObjection"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Consent_userId_kind_revokedAt_idx" ON "Consent"("userId", "kind", "revokedAt");

-- AddForeignKey
ALTER TABLE "AssessmentObjection" ADD CONSTRAINT "AssessmentObjection_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- lane consent (ADR 0005): перенос существующих записей.
-- Согласие на запись созвона писалось в ту же таблицу своей версией (CALL_RECORDING_CONSENT_VERSION).
UPDATE "Consent" SET "kind" = 'call_recording' WHERE "version" LIKE '%call-recording%';

-- Принятые до этой миграции приглашения уже раскрыли имя и контакты: фиксируем это как раскрытие
-- по конкретному приглашению, чтобы логика «контакты после accepted» не закрыла их задним числом.
INSERT INTO "Consent" ("id", "userId", "kind", "version", "acceptedAt", "context")
SELECT 'mig_' || i."id", u."id", 'identity_disclosure', 'legacy-accepted-invitation', COALESCE(i."respondedAt", i."createdAt"), jsonb_build_object('invitationId', i."id")
FROM "Invitation" i JOIN "User" u ON u."candidateId" = i."candidateId"
WHERE i."status" = 'accepted';

-- Показ работодателям теперь требует отдельного согласия (Г4). Личные (не демо) аккаунты его не давали:
-- профиль скрывается, включить показ можно в кабинете. Демо-аккаунты получают согласия при демо-входе.
UPDATE "Candidate" c SET "hiddenFromEmployers" = true
FROM "User" u WHERE u."candidateId" = c."id" AND u."isDemo" = false;
