import { z } from 'zod';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { invitationsSentToday, loadEmployerContext } from '@/server/employer';
import { categoryLabel } from '@/server/employer/ranking';
import { pseudonym } from '@/server/employer/privacy';
import { DAILY_INVITATION_LIMIT } from '@/server/employer/weights';

import type { InvitationDraft } from '../types';

import { resolveVacancy, type EmployerTool } from './shared';

const Input = z.object({
  candidateId: z.string().min(1).max(64),
  vacancyId: z.string().min(1).max(64).optional().describe('Потребность; не указана — единственная активная, если она есть'),
  salaryOffer: z.number().int().min(1).max(10_000_000).optional().describe('₽ в месяц; не указано — нижняя граница вилки'),
  message: z.string().trim().min(10).max(2000).optional().describe('Текст предложения: задачи, команда, формат'),
});
const Output = z
  .object({
    candidateId: z.string(),
    alias: z.string(),
    vacancyId: z.string().nullable(),
    vacancyTitle: z.string().nullable(),
    salaryOffer: z.number().int().nullable(),
    message: z.string(),
    limit: z.object({ sent: z.number().int(), limit: z.number().int(), left: z.number().int() }),
    blocked: z.enum(['daily_limit', 'open_invitation']).nullable(),
    sent: z.literal(false),
  })
  .strict();

const fmtRub = (n: number) => `${n.toLocaleString('ru-RU').replace(/ /g, ' ')} ₽`;

/**
 * Черновик приглашения (R-E-05). НЕ отправляет: отправка — кнопка в карточке, решает
 * человек. Лимит 20/сутки и открытое приглашение — сообщаются, не обходятся
 * (повторная проверка — в createInvitation под advisory-lock при отправке).
 */
export const draftInvitation: EmployerTool = {
  name: 'draft_invitation',
  description:
    'Подготовить черновик приглашения кандидату: зарплата и текст предложения. Ничего не отправляет — черновик появляется в ленте формой, отправляет работодатель кнопкой. Сообщает, сколько приглашений осталось на сутки и можно ли пригласить (лимит, открытое приглашение).',
  input: Input,
  output: Output,
  async handler(ctx, input: z.infer<typeof Input>) {
    const cand = await prisma.candidate.findFirst({ where: { id: input.candidateId, hiddenFromEmployers: false }, select: { id: true } });
    if (!cand) throw errors.notFound('Кандидат не найден');
    let vacancy = null;
    try {
      vacancy = await resolveVacancy(ctx.companyId, input.vacancyId);
    } catch (err) {
      if (input.vacancyId) throw err;
    }
    if (vacancy?.archived) throw errors.notFound('Потребность закрыта');
    const [emp, sent, open] = await Promise.all([
      loadEmployerContext(ctx.employerProfileId),
      invitationsSentToday(ctx.companyId),
      prisma.invitation.findFirst({ where: { companyId: ctx.companyId, candidateId: cand.id, status: { in: ['sent', 'viewed'] } }, select: { id: true } }),
    ]);
    const salary = input.salaryOffer ?? vacancy?.salaryFrom ?? null;
    const message =
      input.message ??
      [
        vacancy
          ? `${emp.companyName} ищет: ${vacancy.title}${/junior|middle/i.test(vacancy.title) ? '' : ` (${categoryLabel(vacancy)})`}.`
          : `${emp.companyName} хочет познакомиться.`,
        vacancy?.teamDescription ?? emp.companyDescription ?? '',
        vacancy?.stack.length ? `Стек: ${vacancy.stack.join(', ')}.` : '',
        salary ? `Предлагаем ${fmtRub(salary)} в месяц.` : '',
        'Если интересно — прими приглашение, и мы свяжемся, чтобы обсудить детали.',
      ]
        .filter(Boolean)
        .join(' ');
    const left = Math.max(0, DAILY_INVITATION_LIMIT - sent);
    const draft: InvitationDraft = {
      candidateId: cand.id,
      alias: pseudonym(cand.id),
      vacancyId: vacancy?.id ?? null,
      vacancyTitle: vacancy?.title ?? null,
      salaryOffer: salary,
      message,
      limit: { sent, limit: DAILY_INVITATION_LIMIT, left },
      blocked: open ? 'open_invitation' : left === 0 ? 'daily_limit' : null,
    };
    ctx.emit({ type: 'invitation_draft', draft });
    return { ...draft, sent: false as const };
  },
};
