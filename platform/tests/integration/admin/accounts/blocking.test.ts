// E-08 фаза 3: блокировка пользователя и компании – граница доверия. Каждый путь входа, отзыв сессий, выдача
// работодателю, отправка приглашений, права ролей и журнал.
import { DELETE as companyUnblock, POST as companyBlock } from '@/app/api/admin/companies/[id]/block/route';
import { DELETE as userUnblock, POST as userBlock } from '@/app/api/admin/users/[id]/block/route';
import { POST as login } from '@/app/api/auth/login/route';
import { GET as yandexCallback } from '@/app/api/auth/yandex/callback/route';
import { GET as yandexStart } from '@/app/api/auth/yandex/route';
import { POST as demoLogin } from '@/app/api/demo/login/route';
import { GET as myInvites } from '@/app/api/invitations/route';
import { ADMIN_COOKIE, signAdminToken } from '@/server/admin/session';
import { createStaff } from '@/server/admin/staff';
import { CONSENT_VERSION } from '@/server/auth/consent';
import { hashPassword } from '@/server/auth/password';
import { OAUTH_COOKIE } from '@/server/auth/yandex';
import { resetRateLimits } from '@/server/auth/rate-limit';
import { sessionInputFor, withProfiles } from '@/server/auth/users';
import { createInvitation } from '@/server/employer/invitations';
import { loadPool } from '@/server/employer/matching';
import { resetEnvCache } from '@/server/env';
import { loadCatalog } from '@/server/recommend/evidence';
import { recommendTargets } from '@/server/recommend/targets';
import { signUserSession } from '@/server/session';

import { DEMO_EMPLOYER, seedAuth } from '../../../../prisma/seed/auth';
import { seedClaims } from '../../../../prisma/seed/claims';
import { DEMO_POOL, seedEmployer } from '../../../../prisma/seed/employer';
import { seedRecommend } from '../../../../prisma/seed/recommend';
import { grantEmployerConsents, linkCandidateUsers } from '../../../helpers/consents';
import { prisma, resetDb } from '../../../helpers/db';
import { cookieFrom, jsonRequest } from '../../../helpers/requests';

const PASS = 'staff-pass-123';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const A = DEMO_POOL[0]!;
const B = DEMO_POOL[1]!;
const empCtx = { companyId: DEMO_EMPLOYER.companyId, employerProfileId: DEMO_EMPLOYER.profileId };
const invite = (candidateId: string) => createInvitation(empCtx, { candidateId, message: 'Платёжная команда, Go и Kafka, высокая нагрузка', salaryFrom: 200000, salaryTo: 260000 });

async function staffCookie(role: 'owner' | 'moderator' | 'support') {
  const { staff } = await createStaff(null, { email: `${role}-${Math.random().toString(36).slice(2, 8)}@example.ru`, name: role, role, password: PASS });
  await prisma.staffMember.update({ where: { id: staff.id }, data: { totpEnabledAt: new Date() } });
  const s = await prisma.adminSession.create({ data: { staffId: staff.id, expiresAt: new Date(Date.now() + 3600_000) } });
  return { staffId: staff.id, cookie: `${ADMIN_COOKIE}=${signAdminToken(s.id)}` };
}

const blockU = (id: string, cookie: string, body: unknown = { reason: 'Фейковый профиль по жалобе' }) => userBlock(jsonRequest(`/api/admin/users/${id}/block`, 'POST', body, cookie), params(id));
const unblockU = (id: string, cookie: string, body: unknown = { reason: 'Разобрались, ошибка' }) => userUnblock(jsonRequest(`/api/admin/users/${id}/block`, 'DELETE', body, cookie), params(id));
const blockC = (id: string, cookie: string, body: unknown = { reason: 'Массовые фейковые приглашения' }) => companyBlock(jsonRequest(`/api/admin/companies/${id}/block`, 'POST', body, cookie), params(id));
const unblockC = (id: string, cookie: string, body: unknown = { reason: 'Апелляция принята' }) => companyUnblock(jsonRequest(`/api/admin/companies/${id}/block`, 'DELETE', body, cookie), params(id));

/** Кука сессии аккаунта так, как её выдаёт вход (sessionInputFor). */
async function loginCookie(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: withProfiles });
  return `cid=${signUserSession(sessionInputFor(user))}`;
}
const candidateRequest = (cookie: string) => myInvites(jsonRequest('/api/invitations', 'GET', undefined, cookie));

describe('E-08 фаза 3: блокировка пользователя и компании', () => {
  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
  });
  beforeEach(async () => {
    resetRateLimits();
    // Журнал защищён триггером от DELETE – между тестами чистим TRUNCATE (как resetDb).
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "AdminAuditLog", "AdminSession", "StaffMember" CASCADE');
    await prisma.invitation.deleteMany();
    await prisma.vacancy.deleteMany();
    await seedRecommend(prisma);
    await seedAuth(prisma);
    await seedEmployer(prisma);
    await prisma.candidate.updateMany({ data: { hiddenFromEmployers: false } });
    await linkCandidateUsers(DEMO_POOL.map((c) => c.id));
    await prisma.user.updateMany({ data: { blockedAt: null, blockedUntil: null, blockedReason: null, blockedById: null } });
    await prisma.company.updateMany({ data: { blockedAt: null, blockedUntil: null, blockedReason: null, blockedById: null } });
    await grantEmployerConsents([DEMO_EMPLOYER.userId]);
  });
  afterAll(() => prisma.$disconnect());

  it('блокировка → следующий запрос с прежней кукой отклонён (401 session_stale, кука стёрта); после разблокировки старая кука не оживает', async () => {
    const owner = await staffCookie('owner');
    const userId = (await prisma.user.findUniqueOrThrow({ where: { candidateId: A.id } })).id;
    const cid = await loginCookie(userId);
    expect((await candidateRequest(cid)).status).toBe(200);

    const r = await blockU(userId, owner.cookie);
    expect(r.status).toBe(200);
    const next = await candidateRequest(cid);
    expect(next.status).toBe(401);
    expect((await next.json()).error.code).toBe('session_stale');
    expect(next.headers.get('set-cookie')).toMatch(/cid=;/);

    const support = await staffCookie('support');
    expect((await unblockU(userId, support.cookie)).status).toBe(200);
    expect((await candidateRequest(cid)).status).toBe(401); // выданная до блокировки – отозвана навсегда
    const fresh = await loginCookie(userId);
    expect((await candidateRequest(fresh)).status).toBe(200); // новый вход после разблокировки работает
  });

  it('срок блокировки истёк – вход снова открыт; срок в прошлом при блокировке – 400', async () => {
    const owner = await staffCookie('owner');
    const userId = (await prisma.user.findUniqueOrThrow({ where: { candidateId: A.id } })).id;
    expect((await blockU(userId, owner.cookie, { reason: 'Временная блокировка', until: new Date(Date.now() - 60_000).toISOString() })).status).toBe(400);
    expect((await blockU(userId, owner.cookie, { reason: 'Временная блокировка', until: new Date(Date.now() + 3600_000).toISOString() })).status).toBe(200);
    await expect(loginCookie(userId)).rejects.toMatchObject({ code: 'account_blocked', status: 403 });
    await prisma.user.update({ where: { id: userId }, data: { blockedUntil: new Date(Date.now() - 1000) } });
    expect((await candidateRequest(await loginCookie(userId))).status).toBe(200);
  });

  it('вход по почте и паролю заблокированным – 403 account_blocked, кука не выдана', async () => {
    const owner = await staffCookie('owner');
    const email = 'blocked.user@example.test';
    const u = await prisma.user.create({ data: { name: 'Почта', email, passwordHash: await hashPassword('very-secret-1'), emailVerifiedAt: new Date(), accounts: { create: { provider: 'email', providerAccountId: email } } } });
    const ok = await login(jsonRequest('https://fsp.example.test/api/auth/login', 'POST', { email, password: 'very-secret-1' }));
    expect(ok.status).toBe(200);
    const oldCid = cookieFrom(ok)!;
    expect((await blockU(u.id, owner.cookie)).status).toBe(200);
    const res = await login(jsonRequest('https://fsp.example.test/api/auth/login', 'POST', { email, password: 'very-secret-1' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('account_blocked');
    expect(cookieFrom(res)).toBeUndefined();
    // Сессия с паролем (8-частная кука) тоже отозвана.
    const me = await candidateRequest(oldCid);
    expect(me.status).toBe(401);
  });

  it('вход через Яндекс заблокированным – редирект /auth?error=account_blocked без куки сессии', async () => {
    const saved = { ...process.env };
    process.env.YANDEX_CLIENT_ID = 'test-client-id';
    process.env.YANDEX_CLIENT_SECRET = 'test-client-secret';
    process.env.APP_URL = 'http://localhost:3000';
    resetEnvCache();
    try {
      const owner = await staffCookie('owner');
      const u = await prisma.user.create({ data: { name: 'Яндекс', accounts: { create: { provider: 'yandex', providerAccountId: '7770001' } } } });
      expect((await blockU(u.id, owner.cookie)).status).toBe(200);
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.startsWith('https://oauth.yandex.ru/token') ? { access_token: 'y0_t', token_type: 'bearer', expires_in: 3600 } : { id: '7770001', login: 'y', real_name: 'Яндекс', default_email: 'y@yandex.ru' };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }));
      const start = yandexStart(new Request(`http://localhost:3000/api/auth/yandex?consent=${CONSENT_VERSION}`));
      const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
      const oauth = cookieFrom(start, OAUTH_COOKIE)!;
      const res = await yandexCallback(new Request(`http://localhost:3000/api/auth/yandex/callback?code=1234567&state=${state}`, { headers: { cookie: oauth } }));
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('http://localhost:3000/auth?error=account_blocked');
      expect(cookieFrom(res)).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      process.env = saved;
      resetEnvCache();
    }
  });

  it('демо-вход за кандидата с заблокированным аккаунтом – 403, кука не выдана', async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { candidateId: A.id } });
    await prisma.user.update({ where: { id: u.id }, data: { blockedAt: new Date() } });
    const res = await demoLogin(jsonRequest('/api/demo/login', 'POST', { candidateId: A.id }));
    expect(res.status).toBe(403);
    expect(cookieFrom(res)).toBeUndefined();
    // Старая демо-кука без аккаунта (3 части) этого кандидата тоже отклонена.
    const { signSession } = await import('@/server/session');
    expect((await candidateRequest(`cid=${signSession(A.id)}`)).status).toBe(401);
  });

  it('заблокированный кандидат выпадает из подборки/поиска и не получает приглашений; кандидат без аккаунта остаётся', async () => {
    const owner = await staffCookie('owner');
    const catalog = await loadCatalog();
    const before = (await loadPool(catalog)).map((p) => p.evidence.id);
    expect(before).toContain(A.id);
    const userId = (await prisma.user.findUniqueOrThrow({ where: { candidateId: A.id } })).id;
    await blockU(userId, owner.cookie);
    const after = (await loadPool(catalog)).map((p) => p.evidence.id);
    expect(after).not.toContain(A.id);
    expect(after).toContain(B.id);
    await expect(invite(A.id)).rejects.toMatchObject({ status: 404 });

    await prisma.user.update({ where: { candidateId: B.id }, data: { candidateId: null } });
    expect((await loadPool(catalog)).map((p) => p.evidence.id)).toContain(B.id);
  });

  it('заблокированная компания не отправляет приглашения (403 company_blocked) и её вакансии скрыты; разблокировка возвращает', async () => {
    const mod = await staffCookie('moderator');
    expect((await invite(A.id)).status).toBe('sent');
    expect((await blockC(empCtx.companyId, mod.cookie)).status).toBe(200);
    await expect(invite(B.id)).rejects.toMatchObject({ code: 'company_blocked', status: 403 });
    const targets = await recommendTargets(A.id, 100);
    expect(targets.some((t) => t.companyId === empCtx.companyId)).toBe(false);

    expect((await unblockC(empCtx.companyId, mod.cookie)).status).toBe(200);
    expect((await invite(B.id)).status).toBe('sent');
  });

  it('блокировка, поставленная параллельно с отправкой, не даёт вставить приглашение после её коммита', async () => {
    const mod = await staffCookie('moderator');
    await blockC(empCtx.companyId, mod.cookie);
    const results = await Promise.allSettled([invite(A.id), invite(B.id)]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(await prisma.invitation.count({ where: { companyId: empCtx.companyId } })).toBe(0);
  });

  it('права: блокировка пользователя – только owner, разблокировка – owner/support, компания – owner/moderator; без сессии 401', async () => {
    const userId = (await prisma.user.findUniqueOrThrow({ where: { candidateId: A.id } })).id;
    const mod = await staffCookie('moderator');
    const sup = await staffCookie('support');
    expect((await blockU(userId, mod.cookie)).status).toBe(403);
    expect((await blockU(userId, sup.cookie)).status).toBe(403);
    expect((await blockU(userId, '')).status).toBe(401);
    expect((await blockC(empCtx.companyId, sup.cookie)).status).toBe(403);
    await prisma.user.update({ where: { id: userId }, data: { blockedAt: new Date() } });
    expect((await unblockU(userId, mod.cookie)).status).toBe(403);
    expect(await prisma.adminAuditLog.count({ where: { NOT: { action: { startsWith: 'staff.' } } } })).toBe(0);
    // Пользовательская кука вместо админской – 401.
    const userCid = `cid=${signUserSession({ userId: DEMO_EMPLOYER.userId, role: 'employer', employerProfileId: DEMO_EMPLOYER.profileId })}`;
    expect((await blockU(userId, userCid)).status).toBe(401);
  });

  it('причина обязательна; общий демо-аккаунт не блокируется; повторная разблокировка – 409', async () => {
    const owner = await staffCookie('owner');
    const userId = (await prisma.user.findUniqueOrThrow({ where: { candidateId: A.id } })).id;
    expect((await blockU(userId, owner.cookie, { reason: '' })).status).toBe(400);
    await prisma.user.update({ where: { id: DEMO_EMPLOYER.userId }, data: { isDemo: true } });
    expect((await blockU(DEMO_EMPLOYER.userId, owner.cookie)).status).toBe(409);
    expect((await unblockU(userId, owner.cookie)).status).toBe(409);
    expect((await blockU('nope', owner.cookie)).status).toBe(404);
  });

  it('журнал: блокировка и разблокировка пишут действие, причину, до/после, исполнителя – без ПДн', async () => {
    const owner = await staffCookie('owner');
    const userId = (await prisma.user.findUniqueOrThrow({ where: { candidateId: A.id } })).id;
    await blockU(userId, owner.cookie);
    await unblockU(userId, owner.cookie);
    await blockC(empCtx.companyId, owner.cookie);
    await unblockC(empCtx.companyId, owner.cookie);
    const rows = await prisma.adminAuditLog.findMany({ where: { NOT: { action: { startsWith: 'staff.' } } }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual(['block_user', 'unblock_user', 'block_company', 'block_company.unblocked']);
    expect(rows[0]).toMatchObject({ actorId: owner.staffId, targetType: 'user', targetId: userId, reason: 'Фейковый профиль по жалобе' });
    expect(rows[2]).toMatchObject({ targetType: 'company', targetId: empCtx.companyId });
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(A.name);
    expect(dump).not.toContain('@');
  });
});
