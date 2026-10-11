import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
      const rows = await prisma.claim.findMany({ where: { candidateId: id }, select: { quote: true, sourceRef: true } });
      expect(rows).toHaveLength(Object.keys(d.claims).length);
      // Цитата — дословная строка резюме, источник — файл этого кандидата.
      const resume = readFileSync(join(process.cwd(), 'eval/demo', d.file.replace('.pdf', ''), 'resume.md'), 'utf8');
      for (const r of rows) {
        expect(resume).toContain(r.quote);
        expect(r.sourceRef).toBe(`${d.file}#p1`);
      }
      expect((await contentReadiness(id, 'qualifying')).ready).toBe(true);
    }
  });
});
