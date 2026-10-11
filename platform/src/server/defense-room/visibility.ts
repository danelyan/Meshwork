// Какие защиты кандидата видит компания (ADR 0008, «Что работодатель видит и когда»).
// ИИ-защита (aiDefense=true) — сравнимый сигнал для всех: до accepted только вердикт под псевдонимом.
// Живая защита (aiDefense=false) принадлежит компании, по чьему приглашению прошла, и видна только ей:
//  - защита проекта — компании вакансии, к которой относится задание сабмита;
//  - защита без сабмита (ответы на вопросы работодателей) — компаниям, чьи вопросы в ней отвечены.
// Чужой компании живая защита не видна ни в выдаче, ни в карточке, ни через ассистента, ни в комнате.
import type { Prisma } from '@prisma/client';

/** Живая защита, принадлежащая компании. */
export function ownedLiveDefense(companyId: string): Prisma.CallSessionWhereInput {
  return {
    aiDefense: false,
    OR: [
      { projectSubmission: { projectTask: { vacancy: { companyId } } } },
      { projectSubmissionId: null, questions: { some: { companyId } } },
    ],
  };
}

/** Защиты, которые компания может видеть; null — компании нет (общий срез): только ИИ-защита. */
export function defenseVisibleTo(companyId: string | null): Prisma.CallSessionWhereInput {
  return companyId ? { OR: [{ aiDefense: true }, ownedLiveDefense(companyId)] } : { aiDefense: true };
}
