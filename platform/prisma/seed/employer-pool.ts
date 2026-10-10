import type { PrismaClient } from '@prisma/client';

import { seedPoolProfiles, type DemoProfile } from './employer';

/**
 * Расширение демо-пула (решение владельца 10.10, Q-39): по две дополнительные записи на каждую
 * пару специализация × грейд, у всех демо-категория (тест не проходили, категория поставлена сидом).
 * Вместе с четырьмя профилями DEMO_POOL, у которых есть категория, в каждой паре получается
 * три кандидата с категорией и разным покрытием требований демо-вакансий. Все люди вымышлены.
 * Отдельный файл и отдельный список: тесты, которые читают DEMO_POOL по индексам, не затронуты.
 * Идемпотентно: upsert по стабильным id `demo-pool-<spec>-<grade>-<n>`.
 */
export const DEMO_POOL_EXTRA: DemoProfile[] = [
  // Backend · Junior: сильный по вакансии «Северного Потока» и слабый, с ФСП
  {
    id: 'demo-pool-be-j-3', name: 'Демо: Константин Романов', specialization: 'backend', fspState: 'not_linked',
    contact: 'k.romanov@example.com', category: { specialization: 'backend', grade: 'junior' }, stack: ['Java', 'Spring', 'PostgreSQL'],
    claims: [['be.lang-core', 'artifact'], ['be.rest-design', 'artifact'], ['be.sql-schema', 'artifact'], ['be.orm', 'third_party'],
      ['common.sql-queries', 'artifact'], ['be.error-handling', 'artifact'], ['be.framework', 'artifact'], ['common.http', 'artifact'],
      ['be.authn-impl', 'self_reported'], ['common.git', 'artifact']],
  },
  {
    id: 'demo-pool-be-j-4', name: 'Демо: Дарья Миронова', specialization: 'backend', fspState: 'linked',
    contact: 'd.mironova@example.com', category: { specialization: 'backend', grade: 'junior' }, stack: ['Go', 'SQLite'],
    claims: [['be.lang-core', 'self_reported'], ['common.sql-queries', 'self_reported'], ['common.git', 'artifact'],
      ['common.debugging', 'self_reported'], ['common.http', 'self_reported'], ['be.config-secrets', 'self_reported'], ['common.algo-complexity', 'third_party']],
  },
  // Backend · Middle: кэш, конкурентность и права доступа против очередей и согласованности
  {
    id: 'demo-pool-be-m-3', name: 'Демо: Руслан Хабибуллин', specialization: 'backend', fspState: 'not_linked',
    contact: 'r.khabibullin@example.com', category: { specialization: 'backend', grade: 'middle' }, stack: ['Kotlin', 'Spring', 'Redis'],
    claims: [['be.transactions', 'artifact'], ['be.sql-indexes', 'artifact'], ['be.rest-design', 'artifact'], ['be.cache', 'artifact'],
      ['be.concurrency', 'artifact'], ['be.authz', 'artifact'], ['be.observability', 'self_reported'], ['be.integration-tests', 'self_reported']],
  },
  {
    id: 'demo-pool-be-m-4', name: 'Демо: Софья Андреева', specialization: 'backend', fspState: 'linked',
    contact: 's.andreeva@example.com', category: { specialization: 'backend', grade: 'middle' }, stack: ['Python', 'Celery', 'RabbitMQ'],
    claims: [['be.message-queue', 'third_party'], ['be.retries-timeouts', 'self_reported'], ['be.idempotency', 'self_reported'],
      ['be.background-jobs', 'artifact'], ['be.sql-indexes', 'self_reported'], ['be.rest-design', 'self_reported'],
      ['be.distributed-consistency', 'self_reported'], ['be.observability', 'artifact']],
  },
  // Frontend · Junior: верстка и формы против чистого JavaScript
  {
    id: 'demo-pool-fe-j-3', name: 'Демо: Екатерина Дмитриева', specialization: 'frontend', fspState: 'not_linked',
    contact: 'e.dmitrieva@example.com', category: { specialization: 'frontend', grade: 'junior' }, stack: ['HTML', 'CSS', 'React'],
    claims: [['fe.html-semantic', 'artifact'], ['fe.css-layout', 'artifact'], ['fe.responsive', 'artifact'], ['fe.js-core', 'artifact'],
      ['fe.components', 'artifact'], ['fe.forms', 'artifact'], ['fe.api-client', 'self_reported'], ['common.git', 'artifact']],
  },
  {
    id: 'demo-pool-fe-j-4', name: 'Демо: Егор Савельев', specialization: 'frontend', fspState: 'linked',
    contact: 'e.saveliev@example.com', category: { specialization: 'frontend', grade: 'junior' }, stack: ['JavaScript', 'Svelte'],
    claims: [['fe.js-core', 'self_reported'], ['fe.dom-events', 'self_reported'], ['fe.event-loop', 'self_reported'],
      ['fe.routing', 'self_reported'], ['fe.css-layout', 'self_reported'], ['common.git', 'artifact'], ['common.algo-complexity', 'third_party']],
  },
  // Frontend · Middle: типы, производительность и доступность против состояния и клиента API
  {
    id: 'demo-pool-fe-m-3', name: 'Демо: Анастасия Крылова', specialization: 'frontend', fspState: 'not_linked',
    contact: 'a.krylova@example.com', category: { specialization: 'frontend', grade: 'middle' }, stack: ['Vue', 'Nuxt', 'TypeScript'],
    claims: [['fe.ts-typing', 'artifact'], ['fe.state-mgmt', 'self_reported'], ['fe.server-state', 'self_reported'], ['fe.web-perf', 'artifact'],
      ['fe.component-tests', 'self_reported'], ['fe.a11y', 'artifact'], ['fe.ssr', 'artifact'], ['fe.architecture', 'artifact']],
  },
  {
    id: 'demo-pool-fe-m-4', name: 'Демо: Максим Фомин', specialization: 'frontend', fspState: 'linked',
    contact: 'm.fomin@example.com', category: { specialization: 'frontend', grade: 'middle' }, stack: ['Angular', 'RxJS', 'TypeScript'],
    claims: [['fe.ts-typing', 'artifact'], ['fe.state-mgmt', 'artifact'], ['fe.render-lifecycle', 'artifact'], ['fe.api-client', 'artifact'],
      ['fe.bundler', 'self_reported'], ['fe.ssr', 'self_reported'], ['fe.routing', 'self_reported'], ['fe.web-perf', 'self_reported']],
  },
];

export async function seedEmployerPool(prisma: PrismaClient): Promise<void> {
  await seedPoolProfiles(prisma, DEMO_POOL_EXTRA);
  console.log(`seed(employer-pool): ${DEMO_POOL_EXTRA.length} extra demo candidates with test categories`);
}
