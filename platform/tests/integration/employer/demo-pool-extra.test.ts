// Q-39: под любую демо-потребность (Backend/Frontend × Junior/Middle) в подборке не меньше трёх
// кандидатов с категорией и разными баллами; повторный сид не плодит дубли.
import { matchForVacancy } from '@/server/employer/matching';

import { seedAuth } from '../../../prisma/seed/auth';
import { seedClaims } from '../../../prisma/seed/claims';
import { seedEmployer } from '../../../prisma/seed/employer';
import { DEMO_POOL_EXTRA, seedEmployerPool } from '../../../prisma/seed/employer-pool';
import { DEMO_VACANCIES, seedRecommend } from '../../../prisma/seed/recommend';
import { prisma, resetDb } from '../../helpers/db';

async function seedAll() {
  await seedClaims(prisma);
  await seedRecommend(prisma);
  await seedAuth(prisma);
  await seedEmployer(prisma);
  await seedEmployerPool(prisma);
}

describe('расширенный демо-пул (БД)', () => {
  beforeAll(async () => {
    await resetDb();
    await seedAll();
  });
  afterAll(() => prisma.$disconnect());

  it.each(DEMO_VACANCIES.map((v) => [v.id, v] as const))('%s: ≥ 3 кандидатов с категорией, баллы различаются, есть доказанное', async (_id, v) => {
    const m = await matchForVacancy(v.companyId, v.id, {}, 50);
    if (process.env.DUMP_POOL) console.log(v.id, m.items.map((i) => `${i.candidateId.replace('demo-pool-', '')}:${i.score}/${i.covered}of${i.total}/p${i.provenCount}${i.categoryMatch ? 'C' : ''}`).join('  '));
    const sameCat = m.items.filter((i) => i.categoryMatch);
    expect(sameCat.length).toBeGreaterThanOrEqual(3);
    expect(new Set(sameCat.map((i) => i.score)).size).toBeGreaterThanOrEqual(3);
    expect(sameCat.some((i) => i.provenCount > 0)).toBe(true);
  });

  it('у каждой пары специализация × грейд три кандидата с категорией; контакт заполнен', async () => {
    const cats = await prisma.candidateCategory.groupBy({ by: ['specialization', 'grade'], where: { candidateId: { startsWith: 'demo-pool-' } }, _count: true });
    expect(cats).toHaveLength(4);
    for (const c of cats) expect(c._count).toBe(3);
    const noContact = await prisma.candidate.count({ where: { id: { startsWith: 'demo-pool-' }, OR: [{ contact: null }, { contact: '' }] } });
    expect(noContact).toBe(0);
  });

  it('повторный сид не создаёт дублей', async () => {
    const snap = async () => ({
      candidates: await prisma.candidate.count({ where: { id: { startsWith: 'demo-pool-' } } }),
      claims: await prisma.claim.count({ where: { candidateId: { startsWith: 'demo-pool-' } } }),
      categories: await prisma.candidateCategory.count({ where: { candidateId: { startsWith: 'demo-pool-' } } }),
    });
    const before = await snap();
    await seedAll();
    expect(await snap()).toEqual(before);
    expect(before.candidates).toBe(8 + DEMO_POOL_EXTRA.length);
  });
});
