import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as auditGet } from '@/app/api/admin/audit/route';
import { POST as loginPost } from '@/app/api/admin/auth/login/route';
import { POST as logoutPost } from '@/app/api/admin/auth/logout/route';
import { GET as meGet } from '@/app/api/admin/auth/me/route';
import { POST as totpPost } from '@/app/api/admin/auth/totp/route';
import { PATCH as staffPatch } from '@/app/api/admin/staff/[id]/route';
import { GET as staffGet, POST as staffPost } from '@/app/api/admin/staff/route';
import { ADMIN_COOKIE, ADMIN_PRE_COOKIE, signAdminToken } from '@/server/admin/session';
import { createStaff } from '@/server/admin/staff';
import { base32Decode, totpAt } from '@/server/admin/totp';
import { resetRateLimits } from '@/server/auth/rate-limit';
import { signUserSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom, jsonRequest } from '../../helpers/requests';

const PASS = 'owner-pass-123';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function owner() {
  const { staff } = await createStaff(null, { email: 'Owner@Example.ru', name: 'Владелец', role: 'owner', password: PASS });
  return staff;
}

/** Шаг 1 → { pre, body } */
async function passwordStep(email = 'owner@example.ru', password = PASS) {
  const res = await loginPost(jsonRequest('/api/admin/auth/login', 'POST', { email, password }));
  return { res, pre: cookieFrom(res, ADMIN_PRE_COOKIE), body: (await res.json()) as { step: string; secret?: string } };
}

async function fullLogin(): Promise<{ cookie: string; secret: string }> {
  const { pre, body } = await passwordStep();
  expect(body.step).toBe('setup');
  const code = totpAt(base32Decode(body.secret!), Date.now());
  const res = await totpPost(jsonRequest('/api/admin/auth/totp', 'POST', { code }, pre));
  expect(res.status).toBe(200);
  return { cookie: cookieFrom(res, ADMIN_COOKIE)!, secret: body.secret! };
}

/** Сотрудник с включённым TOTP и живой сессией — без прохода входа (для проверки прав). */
async function sessionFor(role: 'moderator' | 'support') {
  const { staff } = await createStaff(null, { email: `${role}@example.ru`, name: role, role, password: PASS });
  await prisma.staffMember.update({ where: { id: staff.id }, data: { totpEnabledAt: new Date() } });
  const s = await prisma.adminSession.create({ data: { staffId: staff.id, expiresAt: new Date(Date.now() + 3600_000) } });
  return { staff, cookie: `${ADMIN_COOKIE}=${signAdminToken(s.id)}` };
}

describe('вход персонала и гвард /api/admin', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb();
    resetRateLimits();
  });

  it('пароль + неверный TOTP → отказ без куки; верный → кука fsp_admin и строки журнала', async () => {
    const o = await owner();
    const { res, pre, body } = await passwordStep();
    expect(res.status).toBe(200);
    expect(body.step).toBe('setup');
    expect(pre).toBeTruthy();
    expect(cookieFrom(res, ADMIN_COOKIE)).toBeUndefined();

    const good = totpAt(base32Decode(body.secret!), Date.now());
    const bad = String((Number(good) + 1) % 1_000_000).padStart(6, '0');
    const r1 = await totpPost(jsonRequest('/api/admin/auth/totp', 'POST', { code: bad }, pre));
    expect(r1.status).toBe(401);
    expect(cookieFrom(r1, ADMIN_COOKIE)).toBeUndefined();
    expect((await prisma.staffMember.findUniqueOrThrow({ where: { id: o.id } })).totpEnabledAt).toBeNull();

    const r2 = await totpPost(jsonRequest('/api/admin/auth/totp', 'POST', { code: good }, pre));
    expect(r2.status).toBe(200);
    const cookie = cookieFrom(r2, ADMIN_COOKIE)!;
    expect(cookie).toBeTruthy();
    expect(r2.headers.get('set-cookie')).toMatch(/fsp_admin=a\.[^;]+;.*HttpOnly/i);

    const me = await meGet(jsonRequest('/api/admin/auth/me', 'GET', undefined, cookie));
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ role: 'owner', email: 'owner@example.ru' });
    const actions = (await prisma.adminAuditLog.findMany({ where: { actorId: o.id }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['staff.totp_enabled', 'staff.login']));

    // Повтор того же кода (тот же 30-секундный шаг) отклоняется.
    const again = await passwordStep();
    expect(again.body.step).toBe('totp');
    const r3 = await totpPost(jsonRequest('/api/admin/auth/totp', 'POST', { code: good }, again.pre));
    expect(r3.status).toBe(401);
  });

  it('без промежуточной куки шаг TOTP закрыт; неверный пароль и отключённый сотрудник — одинаковый 401', async () => {
    const o = await owner();
    const noPre = await totpPost(jsonRequest('/api/admin/auth/totp', 'POST', { code: '123456' }));
    expect(noPre.status).toBe(401);
    const wrong = await passwordStep('owner@example.ru', 'wrong-pass-1');
    expect(wrong.res.status).toBe(401);
    expect(wrong.pre).toBeUndefined();
    const nobody = await passwordStep('nobody@example.ru', PASS);
    expect(nobody.res.status).toBe(401);
    await prisma.staffMember.update({ where: { id: o.id }, data: { disabledAt: new Date() } });
    const disabled = await passwordStep();
    expect(disabled.res.status).toBe(401);
    expect(disabled.body).toEqual(wrong.body);
  });

  it('/api/admin/* без куки → 401; пользовательская cid не принимается ни под своим, ни под чужим именем', async () => {
    await owner();
    expect((await staffGet(jsonRequest('/api/admin/staff', 'GET'))).status).toBe(401);
    expect((await auditGet(jsonRequest('/api/admin/audit', 'GET'))).status).toBe(401);
    const user = await prisma.user.create({ data: { name: 'U', role: 'employer' } });
    const cid = signUserSession({ userId: user.id, role: 'employer' });
    expect((await staffGet(jsonRequest('/api/admin/staff', 'GET', undefined, `cid=${cid}`))).status).toBe(401);
    expect((await staffGet(jsonRequest('/api/admin/staff', 'GET', undefined, `${ADMIN_COOKIE}=${cid}`))).status).toBe(401);
    // Подписанная кука на несуществующую сессию — тоже 401.
    expect((await staffGet(jsonRequest('/api/admin/staff', 'GET', undefined, `${ADMIN_COOKIE}=${signAdminToken('nosuchsession')}`))).status).toBe(401);
  });

  it('права: модератор и поддержка не видят персонал и журнал (403), owner видит', async () => {
    const { cookie } = await (async () => {
      await owner();
      return fullLogin();
    })();
    const mod = await sessionFor('moderator');
    const sup = await sessionFor('support');
    for (const c of [mod.cookie, sup.cookie]) {
      expect((await staffGet(jsonRequest('/api/admin/staff', 'GET', undefined, c))).status).toBe(403);
      expect((await auditGet(jsonRequest('/api/admin/audit', 'GET', undefined, c))).status).toBe(403);
      expect((await meGet(jsonRequest('/api/admin/auth/me', 'GET', undefined, c))).status).toBe(200);
    }
    expect((await staffGet(jsonRequest('/api/admin/staff', 'GET', undefined, cookie))).status).toBe(200);
    const feed = (await (await auditGet(jsonRequest('/api/admin/audit?action=staff.', 'GET', undefined, cookie))).json()) as { items: unknown[] };
    expect(feed.items.length).toBeGreaterThan(0);
  });

  it('управление персоналом: причина обязательна, отключение отзывает сессии, себя менять нельзя, журнал пишется', async () => {
    const o = await owner();
    const { cookie } = await fullLogin();
    const mod = await sessionFor('moderator');
    const noReason = await staffPatch(jsonRequest(`/api/admin/staff/${mod.staff.id}`, 'PATCH', { disabled: true, reason: '' }, cookie), ctx(mod.staff.id));
    expect(noReason.status).toBe(400);
    const self = await staffPatch(jsonRequest(`/api/admin/staff/${o.id}`, 'PATCH', { role: 'support', reason: 'проверка самоснятия' }, cookie), ctx(o.id));
    expect(self.status).toBe(400);
    const ok = await staffPatch(jsonRequest(`/api/admin/staff/${mod.staff.id}`, 'PATCH', { disabled: true, reason: 'увольнение сотрудника' }, cookie), ctx(mod.staff.id));
    expect(ok.status).toBe(200);
    expect((await meGet(jsonRequest('/api/admin/auth/me', 'GET', undefined, mod.cookie))).status).toBe(401);
    const row = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'staff.disable', targetId: mod.staff.id } });
    expect(row).toMatchObject({ actorId: o.id, reason: 'увольнение сотрудника', targetType: 'staff' });

    const invite = await staffPost(jsonRequest('/api/admin/staff', 'POST', { email: 'new@example.ru', name: 'Новый', role: 'support' }, cookie));
    expect(invite.status).toBe(201);
    expect(((await invite.json()) as { temporaryPassword: string }).temporaryPassword).toHaveLength(16);
  });

  it('CSRF: мутация с чужим Origin → 403; выход отзывает сессию', async () => {
    await owner();
    const { cookie } = await fullLogin();
    const evil = jsonRequest('/api/admin/auth/logout', 'POST', {}, cookie);
    evil.headers.set('origin', 'https://evil.example');
    expect((await logoutPost(evil)).status).toBe(403);
    expect((await logoutPost(jsonRequest('/api/admin/auth/logout', 'POST', {}, cookie))).status).toBe(200);
    expect((await meGet(jsonRequest('/api/admin/auth/me', 'GET', undefined, cookie))).status).toBe(401);
  });

  it('журнал неизменяем на уровне БД', async () => {
    const row = await prisma.adminAuditLog.create({ data: { action: 'staff.create' } });
    await expect(prisma.adminAuditLog.update({ where: { id: row.id }, data: { reason: 'x' } })).rejects.toThrow();
    await expect(prisma.adminAuditLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});
