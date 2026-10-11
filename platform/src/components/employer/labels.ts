import type { InvitationStatus } from '@prisma/client';

export { SPEC_LABEL } from '@/lib/directions';
export { GRADE_LABEL } from '@/lib/grades';

/** Статус приглашения текстом (не только цветом). */
export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  sent: 'отправлено',
  viewed: 'просмотрено',
  accepted: 'принято',
  declined: 'отклонено',
  hired: 'нанят',
  withdrawn: 'отозвано',
  closed_hired: 'закрыто: нанят другой компанией',
};

/** Работодателю: кандидат принял приглашение, но ни контакта, ни настоящей почты нет (Q-35). */
export const NO_CANDIDATE_CONTACT = 'Кандидат не указал контакт';
/** Кандидату: компания не указала способ связи. */
export const NO_COMPANY_CONTACT = 'Компания не указала способ связи';

export function salaryRange(from: number, to: number): string {
  return `${from.toLocaleString('ru-RU')} - ${to.toLocaleString('ru-RU')} ₽`;
}

/** Тип источника доказательства для работодателя (R-E-07): только название, без ссылки и цитаты. */
export const SOURCE_TYPE_LABEL: Record<'github' | 'codeforces' | 'stackoverflow' | 'article' | 'fsp', string> = {
  github: 'GitHub',
  codeforces: 'Codeforces',
  stackoverflow: 'Stack Overflow',
  article: 'статья',
  fsp: 'ФСП',
};

/** Оговорка у категории, оценки созвона и защиты (ст. 16 152-ФЗ, ADR 0005): оценка ИИ – подсказка, решает работодатель. */
export const ASSESSMENT_DISCLAIMER = 'Оценка - подсказка для решения, а не решение: решение о найме принимает работодатель; кандидат может оспорить оценку.';
