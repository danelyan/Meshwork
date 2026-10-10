import { createInvitation, notifyCandidateInvited, respondInvitation } from '@/server/employer/invitations';
import { clearMailOutbox, mailOutbox } from '@/server/mail';

import { prisma, resetDb } from '../../helpers/db';

/** Фоновое письмо: ждём, пока появится в журнале (fire-and-forget не блокирует запрос). */
async function waitForMail(kind: string) {
  for (let i = 0; i < 50; i++) {
    const m = mailOutbox().find((x) => x.kind === kind);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 20));
  }
  return undefined;
}

describe('уведомления о приглашениях (lane email-auth)', () => {
  let ctx: { companyId: string; employerProfileId: string };
  let candidateId: string;

  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
    clearMailOutbox();
    const company = await prisma.company.create({ data: { name: 'ООО Ромашка', isDemo: false } });
    const user = await prisma.user.create({ data: { name: 'HR', email: 'hr@romashka.test', role: 'employer' } });
    const profile = await prisma.employerProfile.create({ data: { userId: user.id, companyId: company.id } });
    ctx = { companyId: company.id, employerProfileId: profile.id };
    candidateId = (await prisma.candidate.create({ data: { name: 'Ирина', email: 'irina@example.test' } })).id;
  });

  it('новое приглашение → письмо кандидату с компанией и зарплатой; принятие → письмо работодателю', async () => {
    const inv = await createInvitation(ctx, { candidateId, message: 'Платёжная команда, бэкенд', salaryFrom: 250_000, salaryTo: 300_000 });
    const toCandidate = await waitForMail('invitation');
    expect(toCandidate).toMatchObject({ to: 'irina@example.test', subject: 'Новое приглашение от «ООО Ромашка»' });
    expect(toCandidate!.text).toContain('250');
    expect(toCandidate!.text).toContain('300');

    await respondInvitation(candidateId, inv.id, 'accept');
    expect(await waitForMail('invitation_accepted')).toMatchObject({ to: 'hr@romashka.test' });
  });

  it('отклонение → письмо «отклонил»; служебный адрес кандидата — письма нет', async () => {
    const inv = await createInvitation(ctx, { candidateId, message: 'Платёжная команда, бэкенд', salaryFrom: 100_000, salaryTo: 100_000 });
    await waitForMail('invitation');
    await respondInvitation(candidateId, inv.id, 'decline');
    expect(await waitForMail('invitation_declined')).toMatchObject({ to: 'hr@romashka.test' });

    clearMailOutbox();
    await prisma.candidate.update({ where: { id: candidateId }, data: { email: 'user-x@users.invalid' } });
    await notifyCandidateInvited(inv.id);
    expect(mailOutbox()).toHaveLength(0);
  });
});
