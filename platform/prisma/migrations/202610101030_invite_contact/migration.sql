-- lane invite-contact (Q-35, Q-38).
-- 1) Candidate.contact — способ связи кандидата (почта или Telegram), открывается после accepted.
ALTER TABLE "Candidate" ADD COLUMN "contact" TEXT;

-- 2) Invitation: одна сумма salaryOffer → вилка salaryFrom..salaryTo (ТЗ 2.2).
-- Данные переносятся: from = to = salaryOffer. Строки без суммы (ранние тестовые) берут
-- вилку потребности, без потребности — 0. API строк без вилки не создаёт (InvitationInput).
ALTER TABLE "Invitation" ADD COLUMN "salaryFrom" INTEGER, ADD COLUMN "salaryTo" INTEGER;

UPDATE "Invitation" i
SET "salaryFrom" = COALESCE(i."salaryOffer", v."salaryFrom", 0),
    "salaryTo"   = COALESCE(i."salaryOffer", v."salaryTo", 0)
FROM "Invitation" i2
LEFT JOIN "Vacancy" v ON v."id" = i2."vacancyId"
WHERE i2."id" = i."id";

ALTER TABLE "Invitation" ALTER COLUMN "salaryFrom" SET NOT NULL, ALTER COLUMN "salaryTo" SET NOT NULL;
ALTER TABLE "Invitation" DROP COLUMN "salaryOffer";
