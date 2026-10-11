// Общие фикстуры очередей модерации (E-08, фаза 2): демо-компания с работодателем, пул кандидатов, сотрудники трёх ролей.
import { ADMIN_COOKIE, signAdminToken } from '@/server/admin/session';
import { createStaff } from '@/server/admin/staff';
import { clearMailOutbox } from '@/server/mail';
import { signUserSession } from '@/server/session';

import { DEMO_EMPLOYER, seedAuth } from '../../../../prisma/seed/auth';
import { seedClaims } from '../../../../prisma/seed/claims';
import { DEMO_POOL, seedEmployer } from '../../../../prisma/seed/employer';
import { seedRecommend } from '../../../../prisma/seed/recommend';
import { grantEmployerConsents, linkCandidateUsers } from '../../../helpers/consents';
import { prisma, resetDb } from '../../../helpers/db';

export { DEMO_EMPLOYER, DEMO_POOL, prisma };

export const EMP = `cid=${signUserSession({ userId: DEMO_EMPLOYER.userId, role: 'employer', employerProfileId: DEMO_EMPLOYER.profileId })}`;
export const ctxEmp = { companyId: DEMO_EMPLOYER.companyId, employerProfileId: DEMO_EMPLOYER.profileId };
export const params = (id: string) => ({ params: Promise.resolve({ id }) });

export type Role = 'owner' | 'moderator' | 'support';
export interface StaffSession {
  id: string;
  cookie: string;
}

/** Сотрудник с включённым TOTP и живой сессией – без прохода входа. */
export async function staffSession(role: Role, n = 1): Promise<StaffSession> {
  const { staff } = await createStaff(null, { email: `${role}${n}@example.ru`, name: `${role} ${n}`, role, password: 'staff-pass-123' });
  await prisma.staffMember.update({ where: { id: staff.id }, data: { totpEnabledAt: new Date() } });
  const s = await prisma.adminSession.create({ data: { staffId: staff.id, expiresAt: new Date(Date.now() + 3600_000) } });
  return { id: staff.id, cookie: `${ADMIN_COOKIE}=${signAdminToken(s.id)}` };
}

/** Полная БД с нуля: каталог, пул кандидатов, демо-работодатель с согласиями, три сотрудника. */
export async function setupWorld(): Promise<Record<Role, StaffSession>> {
  await resetDb();
  await seedClaims(prisma);
  await prisma.user.createMany({ data: DEMO_POOL.map((c) => ({ id: `u-${c.id}`, name: c.id, role: 'candidate' as const })), skipDuplicates: true });
  await seedRecommend(prisma);
  await seedAuth(prisma);
  await seedEmployer(prisma);
  await prisma.candidate.updateMany({ data: { hiddenFromEmployers: false } });
  await linkCandidateUsers(DEMO_POOL.map((c) => c.id));
  await grantEmployerConsents([DEMO_EMPLOYER.userId]);
  clearMailOutbox();
  return { owner: await staffSession('owner'), moderator: await staffSession('moderator'), support: await staffSession('support') };
}

/** n жалоб на демо-компанию – по одной на отдельное приглашение (unique invitationId). */
export async function seedComplaints(n: number, status: 'open' | 'upheld' | 'dismissed' = 'open', offset = 0): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const cand = DEMO_POOL[(i + offset) % DEMO_POOL.length]!;
    const inv = await prisma.invitation.create({
      data: { companyId: ctxEmp.companyId, employerProfileId: ctxEmp.employerProfileId, candidateId: cand.id, salaryFrom: 1, salaryTo: 2, status: 'declined', createdAt: new Date(Date.now() - 2 * 86_400_000) },
      select: { id: true },
    });
    ids.push((await prisma.complaint.create({ data: { invitationId: inv.id, companyId: ctxEmp.companyId, candidateId: cand.id, reason: 'spam', status } })).id);
  }
  return ids;
}

export const auditRows = (targetId: string) => prisma.adminAuditLog.findMany({ where: { targetId }, orderBy: { createdAt: 'asc' } });

/** Фоновые письма (notifyInBackground) – дождаться микрозадач. */
export const flush = () => new Promise((r) => setTimeout(r, 20));
