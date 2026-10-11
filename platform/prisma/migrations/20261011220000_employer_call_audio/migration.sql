-- ADR 0008 п. 3: запись живой защиты — обе стороны. Дорожка работодателя и его подтверждение записи при входе.
-- AlterTable
ALTER TABLE "CallSession" ADD COLUMN     "employerAudioPath" TEXT;

-- AlterTable
ALTER TABLE "CallParticipant" ADD COLUMN     "recordingConsentAt" TIMESTAMP(3),
ADD COLUMN     "recordingConsentVersion" TEXT;
