-- lane call: счётчик запусков оценщика (повторы finish после 503 ограничены)
ALTER TABLE "CallSession" ADD COLUMN "finishAttempts" INTEGER NOT NULL DEFAULT 0;
