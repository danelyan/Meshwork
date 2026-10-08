import { PrismaClient } from '@prisma/client';

/**
 * Базовый сид foundation: 3 демо-кандидата (вымышленные, isDemo = true).
 * Каталог, вакансии, задания и прочее сидят лейны (claims, recommend, eval) —
 * отдельными файлами prisma/seed/<lane>.ts, интегратор подключит их сюда.
 * Идемпотентен: upsert по фиксированным id.
 */
const prisma = new PrismaClient();

const DEMO_CANDIDATES = [
  {
    id: 'demo-backend-strong',
    email: 'demo.backend@example.test',
    name: 'Демо: Артём Соколов (backend, с ФСП)',
    specialization: 'backend' as const,
    fspState: 'linked' as const,
  },
  {
    id: 'demo-frontend-mid',
    email: 'demo.frontend@example.test',
    name: 'Демо: Вера Лебедева (frontend, без ФСП)',
    specialization: 'frontend' as const,
    fspState: 'no_achievements' as const,
  },
  {
    id: 'demo-injection',
    email: 'demo.injection@example.test',
    name: 'Демо: Кирилл Орлов (резюме с инъекцией)',
    specialization: 'backend' as const,
    fspState: 'not_linked' as const,
  },
];

async function main() {
  for (const c of DEMO_CANDIDATES) {
    await prisma.candidate.upsert({
      where: { id: c.id },
      update: { name: c.name, email: c.email, specialization: c.specialization, fspState: c.fspState, isDemo: true },
      create: { ...c, isDemo: true, consentAt: new Date() },
    });
  }
  console.log(`seed: ${DEMO_CANDIDATES.length} demo candidates`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
