import type { PrismaClient } from '@prisma/client';

/**
 * Сид lane auth: демо-работодатель (вымышленный) — представитель уже засеянной
 * компании demo-co-northstream (seed/recommend.ts). Вход — /auth → «Демо-вход».
 * Идемпотентен. Вызывать после seedRecommend.
 */
export const DEMO_EMPLOYER = {
  userId: 'demo-employer',
  profileId: 'demo-employer-northstream',
  companyId: 'demo-co-northstream',
  name: 'Демо: Анна Кравец (HR, работодатель)',
  email: 'demo.employer@example.test',
};

export async function seedAuth(prisma: PrismaClient): Promise<void> {
  const e = DEMO_EMPLOYER;
  const now = new Date();
  await prisma.user.upsert({
    where: { id: e.userId },
    update: { name: e.name, email: e.email, role: 'employer', isDemo: true },
    create: { id: e.userId, name: e.name, email: e.email, role: 'employer', isDemo: true, onboardedAt: now },
  });
  await prisma.employerProfile.upsert({
    where: { userId: e.userId },
    update: { companyId: e.companyId },
    create: { id: e.profileId, userId: e.userId, companyId: e.companyId },
  });
  console.log('seed: 1 demo employer');
}
