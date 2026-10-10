import type { PrismaClient } from '@prisma/client';

import { SUBCATEGORIES } from '../../src/lib/directions';

import { seedPoolProfiles, type DemoProfile } from './employer';

/**
 * Сид lane directions (ADR 0003, дополнение 10.10):
 * 1. Справочник Subcategory — 17 подкатегорий из src/lib/directions.ts (единый источник для кода и UI);
 *    статус active — подкатегории с шаблоном проекта к сдаче, остальные planned.
 * 2. Демо-кандидаты направления ai — по одному на грейд и ещё по одному, без и с ФСП (вымышленные, isDemo).
 *    Категории — ДЕМО (поставлены сидом, тест не проходили), как в employer-pool.ts. Утверждения — из ai.*
 *    и common.* каталога. Идемпотентно: upsert по стабильным id `demo-ai-<grade>-<n>`; префикс не demo-pool-,
 *    чтобы счётчики пула в тестах employer не менялись.
 */
export const DEMO_POOL_AI: DemoProfile[] = [
  {
    id: 'demo-ai-j-1', name: 'Демо: Алина Захарова', specialization: 'ai', subcategoryId: 'ai.llm-apps', fspState: 'not_linked',
    contact: 'a.zakharova@example.com', category: { specialization: 'ai', grade: 'junior' }, stack: ['Python', 'GigaChat', 'Qdrant', 'FastAPI'],
    claims: [['ai.prompting', 'artifact'], ['ai.structured-output', 'artifact'], ['ai.rag', 'artifact'], ['ai.vector-search', 'self_reported'],
      ['ai.llm-api', 'artifact'], ['ai.pii-masking', 'self_reported'], ['common.git', 'artifact'], ['common.http', 'self_reported']],
  },
  {
    id: 'demo-ai-j-2', name: 'Демо: Тимур Галиев', specialization: 'ai', subcategoryId: 'ai.data-science', fspState: 'linked',
    contact: 't.galiev@example.com', category: { specialization: 'ai', grade: 'junior' }, stack: ['Python', 'pandas', 'scikit-learn', 'SQL'],
    claims: [['ai.pandas-sql', 'artifact'], ['ai.ml-metrics', 'artifact'], ['ai.ml-baseline', 'artifact'], ['ai.feature-pipeline', 'self_reported'],
      ['common.sql-queries', 'artifact'], ['common.algo-complexity', 'third_party'], ['common.git', 'self_reported']],
  },
  {
    id: 'demo-ai-m-1', name: 'Демо: Олег Воронцов', specialization: 'ai', subcategoryId: 'ai.llm-apps', fspState: 'no_achievements',
    contact: 'o.vorontsov@example.com', category: { specialization: 'ai', grade: 'middle' }, stack: ['Python', 'vLLM', 'pgvector', 'LangChain'],
    claims: [['ai.rag', 'artifact'], ['ai.llm-eval', 'artifact'], ['ai.tool-use', 'artifact'], ['ai.prompt-injection', 'artifact'],
      ['ai.llm-cost', 'self_reported'], ['ai.structured-output', 'artifact'], ['ai.llm-fallback', 'self_reported'], ['common.docker-local', 'artifact']],
  },
  {
    id: 'demo-ai-m-2', name: 'Демо: Полина Ершова', specialization: 'ai', subcategoryId: 'ai.mlops', fspState: 'not_linked',
    contact: 'p.ershova@example.com', category: { specialization: 'ai', grade: 'middle' }, stack: ['Python', 'MLflow', 'CatBoost', 'Docker'],
    claims: [['ai.model-serving', 'artifact'], ['ai.model-versioning', 'artifact'], ['ai.monitoring-drift', 'self_reported'], ['ai.validation', 'artifact'],
      ['ai.data-leakage', 'artifact'], ['ai.ml-metrics', 'artifact'], ['common.ci-basics', 'artifact'], ['common.docker-local', 'artifact']],
  },
];

export async function seedDirections(prisma: PrismaClient): Promise<void> {
  for (const s of SUBCATEGORIES) {
    const { id, ...data } = s;
    await prisma.subcategory.upsert({ where: { id }, update: data, create: s });
  }
  await seedPoolProfiles(prisma, DEMO_POOL_AI);
  console.log(`seed(directions): ${SUBCATEGORIES.length} subcategories, ${DEMO_POOL_AI.length} ai demo candidates`);
}
