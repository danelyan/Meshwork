import type { InvitationStatus } from '@prisma/client';

export const SPEC_LABEL = { backend: 'Backend', frontend: 'Frontend' } as const;
export const GRADE_LABEL = { junior: 'Junior', middle: 'Middle' } as const;

/** Статус приглашения текстом (не только цветом). */
export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  sent: 'отправлено',
  viewed: 'просмотрено',
  accepted: 'принято',
  declined: 'отклонено',
};

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
