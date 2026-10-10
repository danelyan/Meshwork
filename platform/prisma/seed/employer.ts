import type { PrismaClient } from '@prisma/client';

import type { Specialization } from '../../src/lib/directions';
import { catalogFromFile } from '../../src/server/claims/catalog-file';

/**
 * Сид lane employer: синтетические демо-кандидаты с подтверждёнными утверждениями
 * (чтобы подборка работодателя была непустой) и поля потребностей демо-компании.
 * Все люди вымышлены, isDemo = true. Категории у части профилей — ДЕМО: тест они
 * не проходили (теста пока нет, его делает лейн test), категория поставлена сидом,
 * чтобы было видно влияние категории на ранжирование. Вызывать после seedClaims
 * и seedRecommend. Идемпотентен: утверждения и категории пула пересоздаются.
 */
type Level = 'self_reported' | 'artifact' | 'third_party' | 'platform';
type Spec = Specialization;
type Grade = 'junior' | 'middle';

export interface DemoProfile {
  id: string;
  name: string;
  specialization: Spec | null;
  fspState: 'not_linked' | 'no_achievements' | 'unavailable' | 'linked';
  /** ДЕМО-категория (не из теста) или null. */
  category: { specialization: Spec; grade: Grade } | null;
  /** Контакт для принятого приглашения; без него — производный от id. */
  contact?: string;
  /** Технологии — попадают в цитаты (по ним работает фильтр «стек»). */
  stack: string[];
  claims: [catalogId: string, level: Level][];
  /** lane directions: подкатегория из справочника (src/lib/directions.ts); не задана — null. */
  subcategoryId?: string;
}

export const DEMO_POOL: DemoProfile[] = [
  {
    id: 'demo-pool-be-m-pay', name: 'Демо: Глеб Соколов', specialization: 'backend', fspState: 'linked',
    category: { specialization: 'backend', grade: 'middle' }, stack: ['Go', 'PostgreSQL', 'Kafka'],
    claims: [['be.idempotency', 'artifact'], ['be.transactions', 'third_party'], ['be.message-queue', 'artifact'], ['be.retries-timeouts', 'self_reported'],
      ['be.sql-indexes', 'artifact'], ['be.rest-design', 'artifact'], ['be.lang-core', 'artifact'], ['common.sql-queries', 'artifact']],
  },
  {
    id: 'demo-pool-be-m-infra', name: 'Демо: Ирина Белова', specialization: 'backend', fspState: 'no_achievements',
    category: null, stack: ['Java', 'Spring', 'Redis'],
    claims: [['be.authz', 'artifact'], ['be.concurrency', 'self_reported'], ['be.cache', 'artifact'], ['be.integration-tests', 'artifact'],
      ['be.observability', 'artifact'], ['be.distributed-consistency', 'self_reported'], ['be.framework', 'artifact'], ['common.http', 'artifact']],
  },
  {
    id: 'demo-pool-be-j-1', name: 'Демо: Артём Ковалёв', specialization: 'backend', fspState: 'linked',
    category: { specialization: 'backend', grade: 'junior' }, stack: ['Python', 'Django', 'PostgreSQL'],
    claims: [['be.lang-core', 'artifact'], ['be.rest-design', 'self_reported'], ['be.sql-schema', 'artifact'], ['be.orm', 'artifact'],
      ['common.sql-queries', 'artifact'], ['be.error-handling', 'self_reported'], ['common.git', 'artifact'], ['common.algo-complexity', 'third_party']],
  },
  {
    id: 'demo-pool-be-j-2', name: 'Демо: Полина Орлова', specialization: 'backend', fspState: 'not_linked',
    category: null, stack: ['Node.js', 'NestJS'],
    claims: [['be.framework', 'artifact'], ['be.api-validation', 'artifact'], ['be.authn-impl', 'self_reported'], ['be.config-secrets', 'self_reported'],
      ['common.http', 'artifact'], ['common.debugging', 'self_reported'], ['be.lang-core', 'self_reported']],
  },
  {
    id: 'demo-pool-fe-m-1', name: 'Демо: Никита Захаров', specialization: 'frontend', fspState: 'linked',
    category: { specialization: 'frontend', grade: 'middle' }, stack: ['React', 'TypeScript', 'Redux'],
    claims: [['fe.ts-typing', 'artifact'], ['fe.state-mgmt', 'artifact'], ['fe.server-state', 'artifact'], ['fe.web-perf', 'self_reported'],
      ['fe.component-tests', 'artifact'], ['fe.a11y', 'self_reported'], ['fe.render-lifecycle', 'artifact'], ['fe.api-client', 'artifact']],
  },
  {
    id: 'demo-pool-fe-m-2', name: 'Демо: Вера Лебедева', specialization: 'frontend', fspState: 'no_achievements',
    category: null, stack: ['Next.js', 'Webpack', 'Playwright'],
    claims: [['fe.render-lifecycle', 'artifact'], ['fe.architecture', 'artifact'], ['fe.ssr', 'artifact'], ['fe.e2e-tests', 'self_reported'],
      ['fe.bundler', 'artifact'], ['fe.api-client', 'artifact'], ['fe.ts-typing', 'self_reported']],
  },
  {
    id: 'demo-pool-fe-j-1', name: 'Демо: Тимур Гусев', specialization: 'frontend', fspState: 'linked',
    category: { specialization: 'frontend', grade: 'junior' }, stack: ['HTML', 'CSS', 'React'],
    claims: [['fe.html-semantic', 'artifact'], ['fe.css-layout', 'artifact'], ['fe.responsive', 'artifact'], ['fe.js-core', 'third_party'],
      ['fe.components', 'self_reported'], ['fe.forms', 'self_reported'], ['common.git', 'artifact']],
  },
  {
    id: 'demo-pool-fe-j-2', name: 'Демо: Алина Морозова', specialization: 'frontend', fspState: 'not_linked',
    category: null, stack: ['JavaScript', 'Vue'],
    claims: [['fe.js-core', 'artifact'], ['fe.event-loop', 'self_reported'], ['fe.api-client', 'artifact'], ['fe.dom-events', 'artifact'],
      ['fe.routing', 'self_reported'], ['common.git', 'artifact']],
  },
];

/** Поля потребностей демо-компании «Северный Поток» (вакансии засеяны лейном recommend). */
export const DEMO_NEED_DETAILS: Record<string, { teamDescription: string; stack: string[] }> = {
  'demo-vac-be-j-1': { teamDescription: 'Команда личного кабинета клиента: REST API и отчёты по счетам (демо).', stack: ['Python', 'PostgreSQL'] },
  'demo-vac-be-m-1': { teamDescription: 'Команда платежей: приём и проведение переводов, очереди, повторы (демо).', stack: ['Go', 'PostgreSQL', 'Kafka'] },
  'demo-vac-fe-j-2': { teamDescription: 'Команда веб-приложения банка: формы и экраны операций (демо).', stack: ['JavaScript', 'React'] },
};

const SOURCE_FOR: Record<Level, { kind: 'resume' | 'github' | 'codeforces'; ref: (id: string) => string }> = {
  self_reported: { kind: 'resume', ref: () => 'cv-demo.pdf#p1' },
  artifact: { kind: 'github', ref: (id) => `github:demo/${id}#README` },
  third_party: { kind: 'codeforces', ref: () => 'codeforces:demo' },
  platform: { kind: 'resume', ref: () => 'platform:defense' },
};

/** Цитата для демо: стек + формулировка каталога (вымышленный текст). */
export function demoQuote(p: DemoProfile, statement: string): string {
  return `${p.stack.join(', ')}: ${statement.charAt(0).toLowerCase()}${statement.slice(1)}`;
}

/** Идемпотентно засевает профили пула: upsert кандидата, утверждения и категория пересоздаются. */
export async function seedPoolProfiles(prisma: PrismaClient, profiles: DemoProfile[]): Promise<void> {
  const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
  const now = new Date();
  for (const p of profiles) {
    const email = `${p.id}@example.test`;
    // lane invite-contact: вымышленный контакт, который работодатель увидит после принятия приглашения (Q-35).
    const contact = p.contact ?? `${p.id.replace(/^demo-pool-/, 'candidate.')}@example.com`;
    await prisma.candidate.upsert({
      where: { id: p.id },
      update: { name: p.name, email, contact, specialization: p.specialization, subcategoryId: p.subcategoryId ?? null, fspState: p.fspState, isDemo: true },
      create: { id: p.id, name: p.name, email, contact, specialization: p.specialization, subcategoryId: p.subcategoryId ?? null, fspState: p.fspState, isDemo: true, consentAt: now },
    });
    await prisma.claim.deleteMany({ where: { candidateId: p.id } });
    await prisma.candidateCategory.deleteMany({ where: { candidateId: p.id } });
    for (const [catalogId, level] of p.claims) {
      const entry = catalog.get(catalogId);
      if (!entry) throw new Error(`seed(employer): нет записи каталога ${catalogId}`);
      const src = SOURCE_FOR[level];
      await prisma.claim.create({
        data: {
          candidateId: p.id, catalogId, statement: entry.statement, level, quote: demoQuote(p, entry.statement),
          sourceRef: src.ref(p.id), sourceKind: src.kind, confidence: 'high', limits: entry.limits,
          suggestedProof: entry.proof, status: 'confirmed', confirmedAt: now,
        },
      });
    }
    if (p.category) await prisma.candidateCategory.create({ data: { candidateId: p.id, ...p.category } });
  }
}

export async function seedEmployer(prisma: PrismaClient): Promise<void> {
  await seedPoolProfiles(prisma, DEMO_POOL);
  for (const [id, d] of Object.entries(DEMO_NEED_DETAILS)) {
    await prisma.vacancy.updateMany({ where: { id }, data: d });
  }
  console.log(`seed(employer): ${DEMO_POOL.length} demo candidates with confirmed claims, ${Object.keys(DEMO_NEED_DETAILS).length} needs detailed`);
}
