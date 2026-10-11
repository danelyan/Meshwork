import { SPECIALIZATIONS } from '@/lib/directions';
import { GRADES } from '@/lib/grades';
import { prisma } from '@/server/db';
import { withErrors } from '@/server/errors';
import { gapMap } from '@/server/recommend/gap-map';
import { recommendTargets } from '@/server/recommend/targets';
import { recommendTasks } from '@/server/recommend/tasks';
import { recommendTest } from '@/server/recommend/test';
import { requireCandidate } from '@/server/session';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const Query = z.object({
  /** vacancy:<id> или category:<spec>:<grade>; без него – цель по умолчанию (см. defaultTarget) */
  target: z
    .string()
    .max(100)
    .regex(new RegExp(`^(vacancy:[A-Za-z0-9_-]{1,64}|category:(${SPECIALIZATIONS.join('|')}):(${GRADES.join('|')}))$`))
    .optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

/**
 * Цель по умолчанию, когда UI её не передал: категория из последнего теста →
 * лучшая вакансия по покрытию → категория, которую предлагает правило теста
 * (у кандидата без подтверждённых утверждений вакансий в целях нет).
 */
async function defaultTarget(
  candidateId: string,
  targets: Awaited<ReturnType<typeof recommendTargets>>,
  test: Awaited<ReturnType<typeof recommendTest>>,
): Promise<string> {
  const cat = await prisma.candidateCategory.findFirst({
    where: { candidateId },
    orderBy: { confirmedAt: 'desc' },
    select: { specialization: true, grade: true },
  });
  if (cat) return `category:${cat.specialization}:${cat.grade}`;
  if (targets[0]) return `vacancy:${targets[0].vacancyId}`;
  return `category:${test.specialization}:${test.grade}`;
}

/** Тест, пробелы к выбранной цели, задания под пробелы, цели-вакансии. Всё детерминированно. */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const test = await recommendTest(candidateId);
  const targets = await recommendTargets(candidateId, q.limit);
  const target = q.target ?? (await defaultTarget(candidateId, targets, test));
  const [kind, ...rest] = target.split(':');
  const gaps = await gapMap(candidateId, { kind: kind as 'vacancy' | 'category', id: rest.join(':') });
  const tasks = await recommendTasks(candidateId, gaps.slice(0, 10).map((g) => g.id), q.limit);
  return Response.json({ target, test, gaps, tasks, targets });
});
