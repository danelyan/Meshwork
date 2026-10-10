import type { PrismaClient } from '@prisma/client';

import { CONSENT_TEXTS } from '../../src/server/consent/texts';

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
  // ADR 0005: демо-работодатель принял оферту и обязательство по данным — поиск и приглашения открыты.
  // Версии — из server/consent/texts.ts; повторный сид не плодит строки.
  for (const kind of ['pd_processing', 'employer_offer', 'employer_data_obligation'] as const) {
    const version = CONSENT_TEXTS[kind].version;
    const has = await prisma.consent.count({ where: { userId: e.userId, kind, version, revokedAt: null } });
    if (!has) await prisma.consent.create({ data: { userId: e.userId, kind, version } });
  }
  console.log('seed: 1 demo employer');
}
