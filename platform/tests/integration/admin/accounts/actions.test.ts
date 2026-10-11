// E-08 фаза 3: скрытие кандидата, сброс кулдауна (R-C-09), удаление по запросу субъекта ПДн, демо-данные.
import { POST as cooldownPost, GET as cooldownGet } from '@/app/api/admin/candidates/[id]/cooldown/route';
import { POST as hidePost } from '@/app/api/admin/candidates/[id]/hide/route';
import { GET as demoGet, POST as demoPost } from '@/app/api/admin/demo/route';
import { POST as erasePost } from '@/app/api/admin/users/[id]/erase/route';
import { POST as privacyPost } from '@/app/api/profile/privacy/route';
import { ADMIN_COOKIE, signAdminToken } from '@/server/admin/session';
import { createStaff } from '@/server/admin/staff';
import { resetRateLimits } from '@/server/auth/rate-limit';
import { loadPool } from '@/server/employer/matching';
import { loadCatalog } from '@/server/recommend/evidence';
import { signUserSession } from '@/server/session';
import { checkEligibility } from '@/server/test';

import { DEMO_EMPLOYER, seedAuth } from '../../../../prisma/seed/auth';
import { seedClaims } from '../../../../prisma/seed/claims';
import { DEMO_POOL, seedEmployer } from '../../../../prisma/seed/employer';
import { seedRecommend } from '../../../../prisma/seed/recommend';
import { grantCandidateConsents, grantConsents, linkCandidateUsers } from '../../../helpers/consents';
import { prisma, resetDb } from '../../../helpers/db';
import { jsonRequest } from '../../../helpers/requests';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const A = DEMO_POOL[0]!;

async function staffCookie(role: 'owner' | 'moderator' | 'support') {
  const { staff } = await createStaff(null, { email: `${role}-${Math.random().toString(36).slice(2, 8)}@example.ru`, name: role, role, password: 'staff-pass-123' });
  await prisma.staffMember.update({ where: { id: staff.id }, data: { totpEnabledAt: new Date() } });
  const s = await prisma.adminSession.create({ data: { staffId: staff.id, expiresAt: new Date(Date.now() + 3600_000) } });
  return { staffId: staff.id, cookie: `${ADMIN_COOKIE}=${signAdminToken(s.id)}` };
}
const actions = async () => (await prisma.adminAuditLog.findMany({ where: { NOT: { action: { startsWith: 'staff.' } } }, orderBy: { createdAt: 'asc' } }));

const hide = (id: string, cookie: string, body: unknown) => hidePost(jsonRequest(`/api/admin/candidates/${id}/hide`, 'POST', body, cookie), params(id));
const reset = (id: string, cookie: string, body: unknown = { reason: 'Сбой стенда во время попытки' }) => cooldownPost(jsonRequest(`/api/admin/candidates/${id}/cooldown`, 'POST', body, cookie), params(id));
const erase = (id: string, cookie: string, body: unknown) => erasePost(jsonRequest(`/api/admin/users/${id}/erase`, 'POST', body, cookie), params(id));
const demo = (cookie: string, body?: unknown) => (body === undefined ? demoGet(jsonRequest('/api/admin/demo', 'GET', undefined, cookie)) : demoPost(jsonRequest('/api/admin/demo', 'POST', body, cookie)));

describe('E-08 фаза 3: действия над кандидатами, удаление, демо', () => {
  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
  });
  beforeEach(async () => {
    resetRateLimits();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "AdminAuditLog", "AdminSession", "StaffMember", "PlatformSetting", "PlatformSettingVersion" CASCADE');
    await prisma.invitation.deleteMany();
    await prisma.vacancy.deleteMany();
    await seedRecommend(prisma);
    await seedAuth(prisma);
    await seedEmployer(prisma);
    await prisma.candidate.updateMany({ data: { hiddenFromEmployers: false } });
    await linkCandidateUsers(DEMO_POOL.map((c) => c.id));
  });
  afterAll(() => prisma.$disconnect());

  it('скрыть кандидата: выпадает из подборки, сам вернуть не может; вернуть – по его согласию Г4; журнал', async () => {
    const mod = await staffCookie('moderator');
    const userId = (await prisma.user.findUniqueOrThrow({ where: { candidateId: A.id } })).id;
    await grantConsents(userId, ['employer_visibility']);
    const catalog = await loadCatalog();
    expect((await hide(A.id, mod.cookie, { hidden: true, reason: 'Фейковый профиль по жалобе' })).status).toBe(200);
    expect((await loadPool(catalog)).map((p) => p.evidence.id)).not.toContain(A.id);

    const cid = `cid=${signUserSession({ userId, role: 'candidate', candidateId: A.id })}`;
    const self = await privacyPost(jsonRequest('/api/profile/privacy', 'POST', { hiddenFromEmployers: false }, cid));
    expect(self.status).toBe(403);
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: A.id } })).hiddenFromEmployers).toBe(true);
    expect((await hide(A.id, mod.cookie, { hidden: true, reason: 'Повторно скрыть' })).status).toBe(409);

    const back = await hide(A.id, mod.cookie, { hidden: false, reason: 'Профиль подтверждён' });
    expect(await back.json()).toEqual({ hiddenFromEmployers: false, hiddenByModerator: false });
    expect((await loadPool(catalog)).map((p) => p.evidence.id)).toContain(A.id);
    // Кандидат снова сам управляет видимостью.
    expect((await privacyPost(jsonRequest('/api/profile/privacy', 'POST', { hiddenFromEmployers: true }, cid))).status).toBe(200);
    expect((await privacyPost(jsonRequest('/api/profile/privacy', 'POST', { hiddenFromEmployers: false }, cid))).status).toBe(200);

    const rows = await actions();
    expect(rows.map((r) => r.action)).toEqual(['hide_candidate.hidden', 'hide_candidate.shown']);
    expect(rows[0]).toMatchObject({ targetType: 'candidate', targetId: A.id, actorId: mod.staffId, reason: 'Фейковый профиль по жалобе' });
  });

  it('вернуть кандидата без согласия Г4 – остаётся скрыт (выбор самого кандидата); support не скрывает (403)', async () => {
    const mod = await staffCookie('moderator');
    const sup = await staffCookie('support');
    await prisma.consent.deleteMany({ where: { kind: 'employer_visibility' } });
    expect((await hide(A.id, sup.cookie, { hidden: true, reason: 'Фейковый профиль' })).status).toBe(403);
    await hide(A.id, mod.cookie, { hidden: true, reason: 'Фейковый профиль' });
    const back = await hide(A.id, mod.cookie, { hidden: false, reason: 'Ошибка модерации' });
    expect(await back.json()).toEqual({ hiddenFromEmployers: true, hiddenByModerator: false });
  });

  it('сброс кулдауна: смена грейда и пересдача снова доступны, категория не меняется; новые интервалы считаются от новых попыток', async () => {
    const sup = await staffCookie('support');
    const C = 'cand-cooldown';
    await prisma.candidate.create({ data: { id: C, email: 'c@example.test', name: 'К', specialization: 'backend', subcategoryId: 'backend.web-api' } });
    await grantCandidateConsents([C]);
    const now = new Date();
    await prisma.candidateCategory.create({ data: { candidateId: C, specialization: 'backend', grade: 'junior', subcategoryId: 'backend.web-api', confirmedAt: new Date(now.getTime() - 3600_000) } });
    await prisma.testAttempt.create({ data: { candidateId: C, specialization: 'backend', subcategoryId: 'backend.web-api', grade: 'junior', status: 'passed', seed: 1, policyVersion: 'v-test', startedAt: new Date(now.getTime() - 7200_000), finishedAt: new Date(now.getTime() - 3600_000), expiresAt: new Date(now.getTime() + 3600_000) } });
    expect((await checkEligibility(C, 'backend', 'middle')).code).toBe('grade_change_too_soon');
    expect((await checkEligibility(C, 'backend', 'junior')).code).toBe('retake_too_soon');

    const r = await reset(C, sup.cookie);
    expect(r.status).toBe(200);
    expect((await checkEligibility(C, 'backend', 'middle')).allowed).toBe(true);
    expect((await checkEligibility(C, 'backend', 'junior')).allowed).toBe(true);
    expect(await prisma.candidateCategory.findMany({ where: { candidateId: C }, select: { grade: true } })).toEqual([{ grade: 'junior' }]);

    // Попытка после сброса снова запускает интервал.
    const later = new Date(Date.now() + 1000);
    await prisma.testAttempt.create({ data: { candidateId: C, specialization: 'backend', subcategoryId: 'backend.web-api', grade: 'junior', status: 'not_confirmed', seed: 2, policyVersion: 'v-test', startedAt: later, finishedAt: later, expiresAt: new Date(later.getTime() + 3600_000) } });
    expect((await checkEligibility(C, 'backend', 'junior', new Date(later.getTime() + 1000))).code).toBe('retake_too_soon');

    const state = await (await cooldownGet(jsonRequest(`/api/admin/candidates/${C}/cooldown`, 'GET', undefined, sup.cookie), params(C))).json();
    expect(state.resetAt).toBeTruthy();
    const rows = await actions();
    expect(rows.map((x) => x.action)).toEqual(['reset_cooldown']);
    expect(rows[0]).toMatchObject({ targetType: 'candidate', targetId: C, reason: 'Сбой стенда во время попытки', actorId: sup.staffId });
  });

  it('сброс кулдауна: moderator – 403, без причины – 400, нет кандидата – 404', async () => {
    const mod = await staffCookie('moderator');
    const owner = await staffCookie('owner');
    expect((await reset(A.id, mod.cookie)).status).toBe(403);
    expect((await reset(A.id, owner.cookie, { reason: '' })).status).toBe(400);
    expect((await reset('nope', owner.cookie)).status).toBe(404);
    expect(await actions()).toEqual([]);
  });

  it('удаление по запросу: двойное подтверждение (id), только owner/support, журнал без ПДн в транзакции удаления', async () => {
    const sup = await staffCookie('support');
    const mod = await staffCookie('moderator');
    const u = await prisma.user.create({ data: { name: 'Иван Удаляемый', email: 'ivan.erase@example.test', role: 'candidate', candidate: { create: { email: 'ivan.erase@example.test', name: 'Иван Удаляемый' } } } });
    expect((await erase(u.id, mod.cookie, { confirm: u.id, reason: 'Запрос субъекта ПДн №12' })).status).toBe(403);
    expect((await erase(u.id, sup.cookie, { confirm: 'wrong', reason: 'Запрос субъекта ПДн №12' })).status).toBe(400);
    expect((await erase(u.id, sup.cookie, { confirm: u.id, reason: '' })).status).toBe(400);
    expect(await prisma.user.findUnique({ where: { id: u.id } })).not.toBeNull();

    const r = await erase(u.id, sup.cookie, { confirm: u.id, reason: 'Запрос субъекта ПДн №12' });
    expect(r.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
    expect(await prisma.candidate.count({ where: { email: 'ivan.erase@example.test' } })).toBe(0);
    const rows = await actions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'erase_account', targetType: 'user', targetId: u.id, actorId: sup.staffId });
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain('Иван');
    expect(dump).not.toContain('ivan.erase');
  });

  it('удаление общего демо-аккаунта – отказ 403, журнал не пишется (откат вместе с удалением)', async () => {
    const owner = await staffCookie('owner');
    await prisma.user.update({ where: { id: DEMO_EMPLOYER.userId }, data: { isDemo: true } });
    const r = await erase(DEMO_EMPLOYER.userId, owner.cookie, { confirm: DEMO_EMPLOYER.userId, reason: 'Запрос субъекта ПДн' });
    expect(r.status).toBe(403);
    expect(await actions()).toEqual([]);
  });

  it('демо: список, мусор e2e удаляется только из показанного, переключатель демо в подборке; только owner', async () => {
    const owner = await staffCookie('owner');
    const mod = await staffCookie('moderator');
    const sup = await staffCookie('support');
    expect((await demo(mod.cookie)).status).toBe(403);
    expect((await demo(sup.cookie)).status).toBe(403);

    const demoCo = await prisma.company.findFirstOrThrow({ where: { isDemo: true } });
    const needs = [{ catalogId: 'x', weight: 1 }];
    const junkV = await prisma.vacancy.create({ data: { companyId: demoCo.id, title: 'E2E Frontend Junior 1', specialization: 'frontend', grade: 'junior', salaryFrom: 1, salaryTo: 2, needs } });
    const keptV = await prisma.vacancy.create({ data: { companyId: demoCo.id, title: 'Frontend Junior', specialization: 'frontend', grade: 'junior', salaryFrom: 1, salaryTo: 2, needs } });
    const guest = await prisma.user.create({ data: { name: 'Гость', role: 'employer', isDemo: true, accounts: { create: { provider: 'demo', providerAccountId: 'guest-e2e' } } } });
    const guestCo = await prisma.company.create({ data: { name: 'ООО Переключатель', isDemo: false, employers: { create: { userId: guest.id } } } });
    const realUser = await prisma.user.create({ data: { name: 'Реальный', role: 'employer' } });
    const realCo = await prisma.company.create({ data: { name: 'ООО Переключатель', isDemo: false, employers: { create: { userId: realUser.id } } } });

    const list = await (await demo(owner.cookie)).json();
    expect(list.showDemo).toBe(true);
    expect(list.junk.vacancies.map((v: { id: string }) => v.id)).toEqual([junkV.id]);
    expect(list.junk.companies.map((c: { id: string }) => c.id)).toEqual([guestCo.id]);
    expect(list.users.find((x: { id: string }) => x.id === guest.id)).toMatchObject({ kind: 'guest', label: expect.stringMatching(/^Гость /) });

    const res = await demo(owner.cookie, { action: 'cleanup', reason: 'Чистка после e2e', vacancyIds: [junkV.id, keptV.id], companyIds: [guestCo.id, realCo.id] });
    expect(await res.json()).toEqual({ vacancies: 1, companies: 1, users: 1 });
    expect(await prisma.vacancy.findUnique({ where: { id: junkV.id } })).toBeNull();
    expect(await prisma.vacancy.findUnique({ where: { id: keptV.id } })).not.toBeNull();
    expect(await prisma.company.findUnique({ where: { id: guestCo.id } })).toBeNull();
    expect(await prisma.company.findUnique({ where: { id: realCo.id } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: guest.id } })).toBeNull();

    const catalog = await loadCatalog();
    expect((await loadPool(catalog)).length).toBeGreaterThan(0);
    expect((await demo(owner.cookie, { action: 'show_demo', value: false, reason: 'Показ жюри без демо' })).status).toBe(200);
    expect((await loadPool(catalog)).every((p) => !DEMO_POOL.some((d) => d.id === p.evidence.id))).toBe(true);
    expect(await prisma.platformSettingVersion.count()).toBe(1);
    await demo(owner.cookie, { action: 'show_demo', value: true, reason: 'Вернуть демо' });
    expect((await loadPool(catalog)).map((p) => p.evidence.id)).toContain(A.id);

    const rows = await actions();
    expect(rows.map((r) => r.action)).toEqual(['manage_demo.cleanup_vacancies', 'manage_demo.erase_guest', 'manage_demo.show_in_matching', 'manage_demo.show_in_matching']);
    expect(rows.every((r) => r.actorId === owner.staffId && r.reason)).toBe(true);
  });
});
