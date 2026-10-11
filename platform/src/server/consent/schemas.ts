// Zod-схемы API согласий и возражений (ADR 0005). Их же читает генератор OpenAPI (scripts/build-openapi.ts).
import { z } from 'zod';

import { CONSENT_KINDS } from './texts';

export const ConsentKindSchema = z.enum(CONSENT_KINDS);

/** POST /api/consents — дать согласие. identity_disclosure — только с context.invitationId. */
export const GrantConsentBody = z.object({
  kind: ConsentKindSchema,
  version: z.string().min(1).max(64),
  context: z.object({ invitationId: z.string().min(1).max(64).optional() }).nullish(),
});

/** DELETE /api/consents/{kind}?invitationId= | ?applicationId= (раскрытие по самоотклику) */
export const RevokeConsentQuery = z.object({ invitationId: z.string().min(1).max(64).optional(), applicationId: z.string().min(1).max(64).optional() });

export const ObjectionSubjectSchema = z.enum(['grade_test', 'call', 'defense']);

/** POST /api/objections — оспорить оценку (ст. 16 152-ФЗ). */
export const ObjectionBody = z.object({
  subject: ObjectionSubjectSchema,
  subjectId: z.string().min(1).max(64),
  text: z.string().trim().min(10, 'Опишите, с чем не согласны (от 10 символов)').max(4000),
});

/** POST /api/dev/objections — ответ оператора (dev-панель). */
export const ObjectionAnswerBody = z.object({ id: z.string().min(1).max(64), answer: z.string().trim().min(1).max(4000) });
