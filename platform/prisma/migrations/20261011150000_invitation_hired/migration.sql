-- lane hired: финальный этап «нанят через компанию» (переход только accepted → hired).
-- Новое значение enum в этой миграции не используется (Postgres: значение из ADD VALUE нельзя применять до коммита транзакции).
ALTER TYPE "InvitationStatus" ADD VALUE 'hired';
ALTER TABLE "Invitation" ADD COLUMN "hiredAt" TIMESTAMP(3);
