// Базовые демо-кандидаты получают утверждения по резюме, созвон открыт; повторный сид не дублирует.
import { seedDemoClaims, DEMO_RESUME_CLAIMS } from '../../../prisma/seed/demo-claims';
import { seedClaims } from '../../../prisma/seed/claims';
import { contentReadiness } from '@/server/call/readiness';
import { prisma, resetDb } from '../../helpers/db';

describe('seedDemoClaims (БД)', () => {
  beforeAll(async () => {
    await resetDb();
    for (const id of Object.keys(DEMO_RESUME_CLAIMS)) {
      await prisma.candidate.create({ data: { id, email: `${id}@example.test`, name: id, isDemo: true, consentAt: new Date() } });
    }
    await seedClaims(prisma);
  });
  afterAll(() => prisma.$disconnect());

  it('утверждения созданы, qualifying готов, повтор не дублирует', async () => {
    await seedDemoClaims(prisma);
    await seedDemoClaims(prisma);
    for (const [id, d] of Object.entries(DEMO_RESUME_CLAIMS)) {
      expect(await prisma.claim.count({ where: { candidateId: id } })).toBe(d.claims.length);
      expect((await contentReadiness(id, 'qualifying')).ready).toBe(true);
    }
  });
});
