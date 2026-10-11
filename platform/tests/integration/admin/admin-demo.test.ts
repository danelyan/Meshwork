import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST as piiPost } from '@/app/api/admin/candidates/[id]/pii/route';
import { POST as demoPost } from '@/app/api/admin/auth/demo/route';
import { POST as loginPost } from '@/app/api/admin/auth/login/route';
import { POST as logoutPost } from '@/app/api/admin/auth/logout/route';
import { GET as meGet } from '@/app/api/admin/auth/me/route';
import { GET as settingsGet } from '@/app/api/admin/settings/route';
import { PUT as settingPut } from '@/app/api/admin/settings/[key]/route';
import { DEMO_STAFF_EMAIL } from '@/server/admin/permissions';
import { ADMIN_COOKIE } from '@/server/admin/session';
import { resetRateLimits } from '@/server/auth/rate-limit';
import { resetEnvCache } from '@/server/env';

import { prisma, resetDb } from '../../helpers/db';
import { cookieFrom, jsonRequest } from '../../helpers/requests';

let prev: string | undefined;

function setDemo(on: boolean) {
  process.env.DEMO_LOGIN = on ? 'true' : 'false';
  resetEnvCache();
}

async function demoCookie(): Promise<string> {
  const res = await demoPost(jsonRequest('/api/admin/auth/demo', 'POST', {}));
  expect(res.status).toBe(200);
  return cookieFrom(res, ADMIN_COOKIE)!;
}

describe('демо-вход жюри в админку', () => {
  beforeEach(async () => {
    prev = process.env.DEMO_LOGIN;
    setDemo(true);
    await resetDb();
    resetRateLimits();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.DEMO_LOGIN;
    else process.env.DEMO_LOGIN = prev;
    resetEnvCache();
  });
  afterAll(() => prisma.$disconnect());

  it('кнопка даёт сессию owner без пароля; повторный вход — тот же сотрудник; вход пишется в журнал', async () => {
    const cookie = await demoCookie();
    const me = await meGet(jsonRequest('/api/admin/auth/me', 'GET', undefined, cookie));
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ role: 'owner', email: DEMO_STAFF_EMAIL });
    await demoCookie();
    expect(await prisma.staffMember.count({ where: { email: DEMO_STAFF_EMAIL } })).toBe(1);
    const logins = await prisma.adminAuditLog.findMany({ where: { action: 'staff.login' } });
    expect(logins).toHaveLength(2);
  });

  it('чтение доступно; изменение настроек и раскрытие ПДн — 403 без записи в журнал', async () => {
    const cookie = await demoCookie();
    expect((await settingsGet(jsonRequest('/api/admin/settings', 'GET', undefined, cookie))).status).toBe(200);
    const put = await settingPut(jsonRequest('/api/admin/settings/employer.dailyInvitationLimit', 'PUT', { value: 1, reason: 'проверка демо-входа' }, cookie), {
      params: Promise.resolve({ key: 'employer.dailyInvitationLimit' }),
    });
    expect(put.status).toBe(403);
    expect(((await put.json()) as { error: { message: string } }).error.message).toMatch(/только просмотр/);
    const pii = await piiPost(jsonRequest('/api/admin/candidates/x/pii', 'POST', { reason: 'проверка демо-входа' }, cookie), { params: Promise.resolve({ id: 'x' }) });
    expect(pii.status).toBe(403);
    expect(await prisma.adminAuditLog.count({ where: { action: { not: 'staff.login' } } })).toBe(0);
    expect(await prisma.platformSettingVersion.count()).toBe(0);
  });

  it('выход демо-сотруднику разрешён', async () => {
    const cookie = await demoCookie();
    expect((await logoutPost(jsonRequest('/api/admin/auth/logout', 'POST', {}, cookie))).status).toBe(200);
    expect((await meGet(jsonRequest('/api/admin/auth/me', 'GET', undefined, cookie))).status).toBe(401);
  });

  it('DEMO_LOGIN выключен: кнопка 403, а уже выданная демо-сессия перестаёт действовать', async () => {
    const cookie = await demoCookie();
    setDemo(false);
    expect((await demoPost(jsonRequest('/api/admin/auth/demo', 'POST', {}))).status).toBe(403);
    expect((await meGet(jsonRequest('/api/admin/auth/me', 'GET', undefined, cookie))).status).toBe(401);
  });

  it('паролем демо-сотрудником не войти', async () => {
    await demoCookie();
    const res = await loginPost(jsonRequest('/api/admin/auth/login', 'POST', { email: DEMO_STAFF_EMAIL, password: 'demo-no-password' }));
    expect(res.status).toBe(401);
  });
});
