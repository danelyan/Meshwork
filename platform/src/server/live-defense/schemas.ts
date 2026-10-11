import { z } from 'zod';

/** POST /api/employer/invitations/:id/live-defense – предложить 2–5 слотов (время ISO 8601, UTC; интерфейс вводит по МСК). */
export const LiveSlotsInput = z.object({
  slots: z.array(z.string().min(10).max(40)).min(2).max(5),
  durationMin: z.union([z.literal(30), z.literal(45)]),
  comment: z.string().max(300).nullish(),
});

/** POST /api/invitations/:id/live-defense/choose – выбрать слот; recordingConsentVersion – дать согласие на запись тем же действием. */
export const LiveChooseInput = z.object({
  slotId: z.string().min(1).max(64),
  recordingConsentVersion: z.string().min(1).max(64).optional(),
});

/** «Ни один не подходит» – когда удобно. */
export const LiveNoneFitInput = z.object({ comment: z.string().min(3).max(300) });

/** Отмена с причиной (любая сторона, не позднее чем за 1 час). */
export const LiveCancelInput = z.object({ reason: z.string().min(3).max(300) });
