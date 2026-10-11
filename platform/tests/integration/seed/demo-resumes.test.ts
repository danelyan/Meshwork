// Цитаты утверждений демо-кандидатов — дословные строки их резюме; выдуманного источника cv-demo.pdf больше нет.
import { seedClaims } from '../../../prisma/seed/claims';
import { PERSONA_PROFILES } from '../../../prisma/seed/demo-personas';
import { DEMO_POOL, seedPoolProfiles } from '../../../prisma/seed/employer';
import { DEMO_POOL_EXTRA } from '../../../prisma/seed/employer-pool';
import { DEMO_POOL_AI } from '../../../prisma/seed/directions';
import { DEMO_POOL_CATEGORIES } from '../../../prisma/seed/pool-categories';
import { resumeFor, resumeFileName } from '../../../prisma/seed/resumes';
import { catalogFromFile } from '@/server/claims/catalog-file';
import { prisma, resetDb } from '../../helpers/db';

const ALL = [...DEMO_POOL, ...DEMO_POOL_EXTRA, ...DEMO_POOL_AI, ...DEMO_POOL_CATEGORIES, ...PERSONA_PROFILES];

describe('резюме демо-кандидатов (БД)', () => {
  beforeAll(async () => {
    await resetDb();
    await seedClaims(prisma);
    // Старая запись прежнего сида: после повторного сида она заменяется строкой резюме.
    await seedPoolProfiles(prisma, ALL);
    await prisma.claim.updateMany({ where: { sourceKind: 'resume' }, data: { sourceRef: 'cv-demo.pdf#p1', quote: 'Go, Kafka: выдумка' } });
    await seedPoolProfiles(prisma, ALL);
  });
  afterAll(() => prisma.$disconnect());

  it('у всех isDemo-кандидатов цитата с опорой на резюме входит в текст их резюме, cv-demo нет', async () => {
    const catalog = new Map(catalogFromFile().map((e) => [e.id, e.statement]));
    const rows = await prisma.claim.findMany({ where: { candidate: { isDemo: true } }, select: { candidateId: true, catalogId: true, quote: true, sourceRef: true, sourceKind: true, level: true } });
    expect(rows.length).toBeGreaterThan(500);
    expect(rows.filter((r) => r.sourceRef.startsWith('cv-demo'))).toHaveLength(0);
    const byId = new Map(ALL.map((p) => [p.id, p]));
    let checked = 0;
    for (const r of rows.filter((x) => x.level === 'self_reported')) {
      const text = resumeFor(byId.get(r.candidateId)!, (id) => catalog.get(id)!).text;
      expect(text, `${r.candidateId} ${r.catalogId}`).toContain(r.quote);
      expect(r.sourceRef).toBe(`${resumeFileName(r.candidateId)}#p1`);
      expect(r.sourceKind).toBe('resume');
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });
});
