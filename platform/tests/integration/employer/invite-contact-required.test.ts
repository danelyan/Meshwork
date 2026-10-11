import { createInvitation } from '@/server/employer/invitations';

import { grantEmployerConsents } from '../../helpers/consents';
import { prisma, resetDb } from '../../helpers/db';

/** ТЗ 2.2 п. 2: приглашение содержит способ связи с компанией — без него отправка запрещена. */
describe('приглашение требует контакт компании', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(() => resetDb());

  async function setup(companyContact: string | null, email: string) {
    const company = await prisma.company.create({ data: { name: 'ООО Тест', isDemo: false, contact: companyContact } });
    const user = await prisma.user.create({ data: { name: 'HR', email, role: 'employer' } });
    const profile = await prisma.employerProfile.create({ data: { userId: user.id, companyId: company.id } });
    await grantEmployerConsents([user.id]);
    const candidateId = (await prisma.candidate.create({ data: { name: 'Ирина', email: 'irina@example.test' } })).id;
    return { ctx: { companyId: company.id, employerProfileId: profile.id }, candidateId };
  }
  const input = (candidateId: string) => ({ candidateId, message: 'Платёжная команда, бэкенд', salaryFrom: 100_000, salaryTo: 120_000 });

  it('нет контакта компании и почта отправителя служебная → 422, приглашения нет', async () => {
    const { ctx, candidateId } = await setup(null, 'user-1@users.invalid');
    await expect(createInvitation(ctx, input(candidateId))).rejects.toMatchObject({ code: 'company_contact_required', status: 422 });
    expect(await prisma.invitation.count()).toBe(0);
  });

  it('есть контакт компании (отправитель со служебной почтой) → создано', async () => {
    const { ctx, candidateId } = await setup('hr@co.example', 'user-2@users.invalid');
    await createInvitation(ctx, input(candidateId));
    expect(await prisma.invitation.count()).toBe(1);
  });

  it('контакта компании нет, но у отправителя обычная почта → создано', async () => {
    const { ctx, candidateId } = await setup(null, 'hr@romashka.test');
    await createInvitation(ctx, input(candidateId));
    expect(await prisma.invitation.count()).toBe(1);
  });
});
