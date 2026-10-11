import { z } from 'zod';

import { invitationsSentToday, listVacancies, loadEmployerContext } from '@/server/employer';
import { getSetting } from '@/server/admin/settings';

import type { EmployerTool } from './shared';

const Input = z.object({});
const Output = z.object({
  company: z.object({ name: z.string(), description: z.string().nullable() }),
  needs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      specialization: z.string(),
      grade: z.string(),
      salaryFrom: z.number(),
      salaryTo: z.number(),
      stack: z.array(z.string()),
      requirements: z.number().int(),
      invitations: z.number().int(),
    }),
  ),
  archivedNeeds: z.number().int(),
  invitations: z.object({ sentLast24h: z.number().int(), limit: z.number().int(), left: z.number().int() }),
});

/** Компания, активные потребности и лимит приглашений за скользящие сутки. */
export const getEmployerContext: EmployerTool = {
  name: 'get_employer_context',
  description:
    'Компания работодателя, его активные потребности (id, название, специализация, грейд, вилка, стек, число требований и приглашений) и сколько приглашений осталось на сутки (лимит 20). Вызывай в начале разговора и когда нужен id потребности.',
  input: Input,
  output: Output,
  async handler(ctx) {
    const [emp, vacancies, sent, dailyLimit] = await Promise.all([
      loadEmployerContext(ctx.employerProfileId),
      listVacancies(ctx.companyId),
      invitationsSentToday(ctx.companyId),
      getSetting('employer.dailyInvitationLimit'),
    ]);
    const active = vacancies.filter((v) => !v.archived);
    return {
      company: { name: emp.companyName, description: emp.companyDescription },
      needs: active.map((v) => ({
        id: v.id,
        title: v.title,
        specialization: v.specialization,
        grade: v.grade,
        salaryFrom: v.salaryFrom,
        salaryTo: v.salaryTo,
        stack: v.stack,
        requirements: v.needs.length,
        invitations: v.invitations,
      })),
      archivedNeeds: vacancies.length - active.length,
      invitations: { sentLast24h: sent, limit: dailyLimit, left: Math.max(0, dailyLimit - sent) },
    };
  },
};
