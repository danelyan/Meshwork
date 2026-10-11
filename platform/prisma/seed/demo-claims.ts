import type { PrismaClient } from '@prisma/client';

import { catalogFromFile } from '../../src/server/claims/catalog-file';

/**
 * Утверждения базовых демо-кандидатов demo-frontend-mid и demo-injection (у demo-backend-strong
 * они приходят из разбора резюме). Без них call-gate (src/server/call/readiness.ts) держит
 * квалифицирующий созвон закрытым. Набор строго по резюме eval/demo/demo-2 и demo-3: уровень
 * self_reported, статус proposed (кандидат подтверждает сам); пробелы из expected.json
 * (fe.component-tests, fe.ts-typing) и «знаю названия» из резюме demo-3 не включены, вне резюме
 * (в т.ч. из скрытого текста) ничего нет. Утверждения создаются, только если у кандидата их ещё
 * нет: повторный сид не затирает то, что появилось при работе на стенде. Все люди вымышлены.
 */
export const DEMO_RESUME_CLAIMS: Record<string, { stack: string[]; claims: string[] }> = {
  'demo-frontend-mid': {
    stack: ['React', 'JavaScript', 'CSS'],
    claims: ['fe.components', 'fe.forms', 'fe.api-client', 'fe.responsive', 'fe.css-layout', 'fe.js-core', 'common.git'],
  },
  'demo-injection': {
    stack: ['Java', 'Spring Boot', 'PostgreSQL'],
    claims: ['be.lang-core', 'be.framework', 'be.rest-design', 'common.sql-queries', 'common.git'],
  },
};

export async function seedDemoClaims(prisma: PrismaClient): Promise<void> {
  const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
  let created = 0;
  for (const [candidateId, d] of Object.entries(DEMO_RESUME_CLAIMS)) {
    if (!(await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true } }))) continue;
    if ((await prisma.claim.count({ where: { candidateId } })) > 0) continue;
    for (const catalogId of d.claims) {
      const entry = catalog.get(catalogId);
      if (!entry) throw new Error(`seed(demo-claims): нет записи каталога ${catalogId}`);
      await prisma.claim.create({
        data: {
          candidateId, catalogId, statement: entry.statement, level: 'self_reported',
          quote: `${d.stack.join(', ')}: ${entry.statement.charAt(0).toLowerCase()}${entry.statement.slice(1)}`,
          sourceRef: 'cv-demo.pdf#p1', sourceKind: 'resume', confidence: 'medium', limits: entry.limits,
          suggestedProof: entry.proof, status: 'proposed',
        },
      });
      created++;
    }
  }
  console.log(`seed(demo-claims): ${created} claims for base demo candidates`);
}
