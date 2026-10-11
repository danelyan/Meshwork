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
      const rows = await prisma.claim.findMany({ where: { candidateId: id }, select: { quote: true, sourceRef: true, catalogId: true, wording: true } });
      // Формулировка для карточки — ручная, под цитату и в роде кандидата.
      for (const r of rows) expect(r.wording).toBe(d.wording[r.catalogId]);
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

  it('уже засеянный стенд: формулировки дописываются, правку кандидата не трогают', async () => {
    const [julia] = Object.keys(DEMO_RESUME_CLAIMS);
    await prisma.claim.updateMany({ where: { candidateId: julia }, data: { wording: null } });
    const edited = await prisma.claim.findFirstOrThrow({ where: { candidateId: julia } });
    await prisma.claim.update({ where: { id: edited.id }, data: { status: 'edited', statement: 'Своя правка' } });
    await seedDemoClaims(prisma);
    const rows = await prisma.claim.findMany({ where: { candidateId: julia } });
    for (const r of rows) {
      if (r.id === edited.id) expect(r.wording).toBeNull();
      else expect(r.wording).toBe(DEMO_RESUME_CLAIMS[julia!]!.wording[r.catalogId]);
    }
  });
});
