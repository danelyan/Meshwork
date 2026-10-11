import { PrismaClient } from '@prisma/client';

import { loadPlatformEnv } from '../scripts/load-env.mjs';

import { seedAuth } from './seed/auth';
import { seedClaims } from './seed/claims';
import { seedContent } from './seed/content';
import { seedDemoClaims } from './seed/demo-claims';
import { seedDemoPersonas } from './seed/demo-personas';
import { seedDirections } from './seed/directions';
import { seedEmployer } from './seed/employer';
import { seedEmployerPool } from './seed/employer-pool';
import { seedRecommend } from './seed/recommend';
import { seedTest } from './seed/test';

/**
 * Базовый сид foundation: 3 демо-кандидата (вымышленные, isDemo = true).
 * Каталог, вакансии, задания и прочее сидят лейны (claims, recommend, eval) –
 * отдельными файлами prisma/seed/<lane>.ts; они подключены ниже, в main().
 * Идемпотентен: upsert по фиксированным id.
 */
// До создания клиента: иначе общий Prisma Client возьмёт .env чужого каталога.
loadPlatformEnv();
const prisma = new PrismaClient();

const DEMO_CANDIDATES = [
  {
    id: 'demo-backend-strong',
    email: 'demo.backend@example.test',
    contact: 'd.ryabinin@example.com',
    name: 'Демо: Дмитрий Рябинин (backend, с ФСП)',
    specialization: 'backend' as const,
    fspState: 'linked' as const,
  },
  {
    id: 'demo-frontend-mid',
    email: 'demo.frontend@example.test',
    contact: 'yu.vlasova@example.com',
    name: 'Демо: Юлия Власова (frontend, без ФСП)',
    specialization: 'frontend' as const,
    fspState: 'no_achievements' as const,
  },
  {
    id: 'demo-injection',
    email: 'demo.injection@example.test',
    contact: 'm.lisitsyn@example.com',
    name: 'Демо: Матвей Лисицын (резюме со скрытым текстом)',
    specialization: 'backend' as const,
    fspState: 'not_linked' as const,
  },
];

async function main() {
  for (const c of DEMO_CANDIDATES) {
    await prisma.candidate.upsert({
      where: { id: c.id },
      update: { name: c.name, email: c.email, contact: c.contact, specialization: c.specialization, fspState: c.fspState, isDemo: true },
      create: { ...c, isDemo: true, consentAt: new Date() },
    });
  }
  console.log(`seed: ${DEMO_CANDIDATES.length} demo candidates`);
  // Порядок важен: recommend ссылается на каталог утверждений.
  await seedClaims(prisma);
  await seedRecommend(prisma);
  // Утверждения demo-frontend-mid и demo-injection: иначе созвон закрыт call-gate.
  await seedDemoClaims(prisma);
  await seedTest(prisma);
  // После recommend: демо-работодатель ссылается на засеянную компанию.
  await seedAuth(prisma);
  // lane employer: пул демо-кандидатов с подтверждёнными утверждениями, детали потребностей.
  await seedEmployer(prisma);
  // Q-39: по паре специализация × грейд не меньше трёх кандидатов с категорией.
  await seedEmployerPool(prisma);
  // lane directions: справочник подкатегорий и демо-кандидаты ai (после каталога утверждений).
  await seedDirections(prisma);
  // Курированные демо-персоны по этапам пути (окно входа, /demo): после каталога, компаний и demo-claims.
  await seedDemoPersonas(prisma);
  // Контент работодательской стороны: 10 компаний, вакансии всех направлений, проектное задание у каждой, логины, активность.
  await seedContent(prisma);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
