import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GET as exportGet } from '@/app/api/admin/export/[file]/route';
import { GET as llmGet } from '@/app/api/admin/metrics/llm/route';
import { GET as matchingGet } from '@/app/api/admin/metrics/matching/route';
import { GET as testGet } from '@/app/api/admin/metrics/test/route';
import { ADMIN_COOKIE, signAdminToken } from '@/server/admin/session';
import { createStaff } from '@/server/admin/staff';

import { prisma, resetDb } from '../../../helpers/db';
import { jsonRequest } from '../../../helpers/requests';

const PASS = 'owner-pass-123';
const file = (f: string) => ({ params: Promise.resolve({ file: f }) });

async function sessionFor(role: 'owner' | 'moderator' | 'support') {
  const { staff } = await createStaff(null, { email: `${role}@example.ru`, name: role, role, password: PASS });
  await prisma.staffMember.update({ where: { id: staff.id }, data: { totpEnabledAt: new Date() } });
  const s = await prisma.adminSession.create({ data: { staffId: staff.id, expiresAt: new Date(Date.now() + 3600_000) } });
  return { staff, cookie: `${ADMIN_COOKIE}=${signAdminToken(s.id)}` };
}

async function seedData() {
  const c = await prisma.candidate.create({ data: { email: 'secret-person@example.ru', name: 'Секретный Иван', specialization: 'backend' } });
  await prisma.candidateCategory.create({ data: { candidateId: c.id, specialization: 'backend', grade: 'junior', confirmedAt: new Date(Date.now() - 3600_000) } });
  await prisma.agentRun.createMany({
    data: [
      { purpose: 'consultant', provider: 'p', model: 'm', latencyMs: 100, inputTokens: 90_000, outputTokens: 80_000, ok: true, jsonValid: true, candidateId: c.id },
      { purpose: 'consultant', provider: 'p', model: 'm', latencyMs: 300, inputTokens: 10, outputTokens: 10, ok: false, jsonValid: false, attempts: 3, candidateId: c.id },
    ],
  });
  return c;
}

describe('метрики и выгрузка (owner)', () => {
  afterAll(() => prisma.$disconnect());
  beforeEach(resetDb);

  it('moderator и support получают 403 на каждом маршруте, без сессии 401', async () => {
    for (const role of ['moderator', 'support'] as const) {
      const { cookie } = await sessionFor(role);
      const reqs = [
        () => testGet(jsonRequest('/api/admin/metrics/test', 'GET', undefined, cookie)),
        () => matchingGet(jsonRequest('/api/admin/metrics/matching', 'GET', undefined, cookie)),
        () => llmGet(jsonRequest('/api/admin/metrics/llm', 'GET', undefined, cookie)),
        () => exportGet(jsonRequest('/api/admin/export/test.csv', 'GET', undefined, cookie), file('test.csv')),
      ];
      for (const r of reqs) expect((await r()).status).toBe(403);
    }
    expect((await testGet(jsonRequest('/api/admin/metrics/test', 'GET'))).status).toBe(401);
    expect(await prisma.adminAuditLog.count({ where: { action: 'export_csv' } })).toBe(0);
  });

  it('owner: агрегаты LLM, кандидат у потолка только по id', async () => {
    const { cookie } = await sessionFor('owner');
    const c = await seedData();
    const res = await llmGet(jsonRequest('/api/admin/metrics/llm', 'GET', undefined, cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.byPurpose[0]).toMatchObject({ purpose: 'consultant', runs: 2, retries: 2, invalidJsonShare: 0.5 });
    expect(body.nearCeiling[0].candidateId).toBe(c.id);
    expect(JSON.stringify(body)).not.toContain('secret-person');
    expect((await testGet(jsonRequest('/api/admin/metrics/test', 'GET', undefined, cookie))).status).toBe(200);
    expect((await matchingGet(jsonRequest('/api/admin/metrics/matching', 'GET', undefined, cookie))).status).toBe(200);
  });

  it('выгрузка CSV: обезличена, пишет строку журнала; неизвестный вид — 404', async () => {
    const { cookie, staff } = await sessionFor('owner');
    await seedData();
    const res = await exportGet(jsonRequest('/api/admin/export/llm.csv?days=30', 'GET', undefined, cookie), file('llm.csv'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const csv = await res.text();
    expect(csv).toContain('consultant');
    expect(csv).not.toMatch(/secret-person|Секретный|@example/);
    const log = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'export_csv' } });
    expect(log).toMatchObject({ actorId: staff.id, targetType: 'metrics_export', targetId: 'llm' });
    expect((await exportGet(jsonRequest('/api/admin/export/users.csv', 'GET', undefined, cookie), file('users.csv'))).status).toBe(404);
  });

  it('воронка подбора: считает по категории и скрывает малые группы в CSV', async () => {
    const { cookie } = await sessionFor('owner');
    const c = await seedData();
    const company = await prisma.company.create({ data: { name: 'Acme' } });
    {
      await prisma.invitation.create({ data: { candidateId: c.id, companyId: company.id, status: 'accepted', salaryFrom: 1, salaryTo: 2, viewedAt: new Date() } });
      const body = await (await matchingGet(jsonRequest('/api/admin/metrics/matching', 'GET', undefined, cookie))).json();
      expect(body.rows[0]).toMatchObject({ specialization: 'backend', grade: 'junior', sent: 1, accepted: 1, viewed: 1 });
      const csv = await (await exportGet(jsonRequest('/api/admin/export/matching.csv', 'GET', undefined, cookie), file('matching.csv'))).text();
      expect(csv).toContain('<5');
    }
  });
  it('монитор теста: доля верных, корреляция с θ и пометка перекалибровки', async () => {
    const { cookie } = await sessionFor('owner');
    await prisma.taskTemplate.create({ data: { id: 'be.t1', taskId: 't1', title: 'Задание', specialization: 'backend', grade: 'junior', catalogIds: [], format: 'single', irtA: 1, irtB: 0 } });
    for (let n = 0; n < 40; n++) {
      const c = await prisma.candidate.create({ data: { email: `c${n}@example.ru`, name: `К${n}` } });
      const strong = n % 2 === 0;
      const a = await prisma.testAttempt.create({ data: { candidateId: c.id, specialization: 'backend', grade: 'junior', seed: n, theta: strong ? 1 : -1, policyVersion: 'v', expiresAt: new Date(Date.now() + 3600_000), status: 'passed' } });
      const asked = new Date(Date.now() - 60_000);
      await prisma.testItem.create({ data: { attemptId: a.id, index: 0, templateId: 'be.t1', instanceSeed: 1, params: {}, prompt: 'p', answerHint: '', answerKey: 'k', explanation: '', answer: 'x', correct: true, askedAt: asked, answeredAt: new Date(asked.getTime() + 20_000) } });
    }
    const body = await (await testGet(jsonRequest('/api/admin/metrics/test', 'GET', undefined, cookie))).json();
    expect(body.items[0]).toMatchObject({ templateId: 'be.t1', shown: 40, answered: 40, correctShare: 1, medianSec: 20 });
    expect(body.items[0].flags.join()).toContain('слишком лёгкое');
  });
});
