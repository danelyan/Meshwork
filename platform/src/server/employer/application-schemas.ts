// Zod-схемы самоотклика (R-C-12). Отдельный чистый модуль: его читает генератор OpenAPI (scripts/build-openapi.ts).
import { z } from 'zod';

/** ПРЕДЛОЖЕНИЕ агента: не больше 20 откликов кандидата за сутки — защита работодателей от рассылки «на все». */
export const DAILY_APPLICATION_LIMIT = 20;
export const APPLICATION_MESSAGE_MAX = 1000;

/** POST /api/career/vacancies/{id}/apply. disclosureVersion — подтверждённая галочка раскрытия (версия текста Г5). */
export const ApplicationInput = z.object({
  message: z.string().trim().max(APPLICATION_MESSAGE_MAX, `Сообщение — не длиннее ${APPLICATION_MESSAGE_MAX} символов`).nullish(),
  disclosureVersion: z.string().min(1).max(64).optional(),
});

/** PATCH /api/employer/applications/{id} — ответ работодателя. */
export const ApplicationAnswer = z.object({ action: z.enum(['accept', 'decline']) });
