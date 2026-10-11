import { z } from 'zod';

/** Zod-схемы маршрутов защиты проекта (OpenAPI собирается из них, scripts/build-openapi.ts). */

const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const DefenseStartInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('project'), projectSubmissionId: Id }),
  z.object({ mode: z.literal('questions') }),
]);

export const DefenseTurnInput = z.object({ text: z.string().max(4000) });

export const SignalInput = z
  .object({
    /** Кандидат указывает работодателя: `employer:<userId>`; работодателю не нужно (адресат — кандидат). */
    to: z.string().max(80).optional(),
    sdp: z
      .object({ type: z.enum(['offer', 'answer', 'pranswer', 'rollback']), sdp: z.string().max(20_000).optional() })
      .optional(),
    ice: z
      .object({
        candidate: z.string().max(1000),
        sdpMid: z.string().max(64).nullable().optional(),
        sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
        usernameFragment: z.string().max(256).nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .refine((b) => b.sdp !== undefined || b.ice !== undefined, { message: 'Нужен sdp или ice', path: ['sdp'] });

/** Вход в живую защиту: подтверждение, что разговор записывается, включая голос работодателя (ADR 0008 п. 3). */
export const JoinCallInput = z.object({ recordingConsent: z.boolean().optional() });

/** Сегмент дорожки работодателя: смещение от начала защиты, мс. */
export const EmployerAudioQuery = z.object({ startMs: z.coerce.number().int().min(0).max(24 * 60 * 60 * 1000).default(0) });

export const EmployerAudioSegmentQuery = z.object({ segment: z.string().max(40).regex(/^\d{3}-\d{1,9}\.webm$/) });

export const MuteAiInput = z.object({ muted: z.boolean() });

export const SayInput = z.object({ text: z.string().min(1).max(1000) });

export const EmployerQuestionInput = z.object({
  candidateId: Id,
  text: z.string().min(5).max(1000),
  projectSubmissionId: Id.optional(),
});

export const EmployerQuestionsQuery = z.object({ candidateId: Id });

/** ИИ-защита проверенного сабмита до приглашения (ADR 0008 п. 1). */
export const AiDefenseStartInput = z.object({ projectSubmissionId: Id });
