import { GET as list } from '@/app/api/demo/login/route';
import { ALL_PERSONAS } from '@/server/demo/personas';
import { resetEnvCache } from '@/server/env';

import { seedAuth } from '../../../prisma/seed/auth';
import { seedClaims } from '../../../prisma/seed/claims';
import { seedDemoPersonas } from '../../../prisma/seed/demo-personas';
import { seedRecommend } from '../../../prisma/seed/recommend';
import { prisma, resetDb } from '../../helpers/db';
import { ALL_COMPANIES } from '../../../prisma/seed/content/index';
import { employerUserId } from '../../../prisma/seed/content/types';

// Курированные демо-персоны (src/server/demo/personas.ts): каждая подтверждена реальными записями в БД.
describe('демо-персоны по этапам пути', () => {
  beforeAll(async () => {
    process.env.DEMO_LOGIN = 'true';
    resetEnvCache();
    await resetDb();
    await seedClaims(prisma);
    await seedRecommend(prisma);
    await seedAuth(prisma);
    await prisma.candidate.createMany({ data: [
      { id: 'demo-frontend-mid', email: 'f@example.test', name: 'Юлия', isDemo: true },
      { id: 'demo-injection', email: 'i@example.test', name: 'Матвей', isDemo: true },
    ] });
    await seedDemoPersonas(prisma);
    await seedDemoPersonas(prisma); // идемпотентность
  });
  afterAll(async () => {
    delete process.env.DEMO_LOGIN;
    resetEnvCache();
    await prisma.$disconnect();
  });

  it('GET отдаёт все персоны, кроме тех, чьих записей нет, и пул подборки в них не входит', async () => {
    const body = await (await list()).json();
    const ids: string[] = body.personas.map((p: { id: string }) => p.id);
    // Представители компаний из seed/content сидятся отдельно (seedContent), здесь их записей нет — route их скрывает.
    const contentEmployers = new Set(ALL_COMPANIES.filter((c) => c.employer).map((c) => employerUserId(c.slug)));
    expect(ids).toEqual(ALL_PERSONAS.map((p) => p.id).filter((id) => !contentEmployers.has(id)));
    expect(ids.some((id) => id.startsWith('demo-pool-') || id.startsWith('demo-ai-'))).toBe(false);
  });

  it('этап 2: знакомство не завершено, есть ответы', async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { candidateId: 'demo-intro' }, include: { onboarding: true } });
    expect(u.onboardedAt).toBeNull();
    expect(u.onboarding?.answers).toMatchObject({ goal: 'job_search', specialization: 'backend' });
  });

  it('этапы 4 и 5: категория из теста, попытка passed; у сильного созвон с вердиктом, утверждения platform, ФСП', async () => {
    for (const id of ['demo-tested', 'demo-strong']) {
      expect(await prisma.candidateCategory.count({ where: { candidateId: id, source: 'test' } })).toBe(1);
      expect(await prisma.testAttempt.count({ where: { candidateId: id, status: 'passed' } })).toBe(1);
      expect(await prisma.claim.count({ where: { candidateId: id, status: 'confirmed' } })).toBeGreaterThan(5);
    }
    const call = await prisma.callSession.findFirstOrThrow({ where: { candidateId: 'demo-strong', kind: 'qualifying', status: 'finished' } });
    expect(call.verdictJson).not.toBeNull();
    expect(await prisma.claim.count({ where: { candidateId: 'demo-strong', level: 'platform' } })).toBeGreaterThan(0);
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: 'demo-strong' } })).fspState).toBe('linked');
    expect(await prisma.candidateCategory.count({ where: { candidateId: 'demo-intro' } })).toBe(0);
  });

  it('этапы 6–8: приглашения компании «Гранит Софт» sent / accepted / hired; у нанятого hiredAt', async () => {
    const inv = await prisma.invitation.findMany({ where: { companyId: 'demo-co-granit' }, orderBy: { createdAt: 'desc' } });
    const by = Object.fromEntries(inv.map((i) => [i.candidateId, i]));
    expect(by['demo-invited']?.status).toBe('sent');
    expect(by['demo-accepted']?.status).toBe('accepted');
    expect(by['demo-hired']?.status).toBe('hired');
    expect(by['demo-hired']?.hiredAt).not.toBeNull();
    expect(by['demo-invited']?.hiredAt).toBeNull();
  });
});
