import { withErrors } from '@/server/errors';
import { gapMap } from '@/server/recommend/gap-map';
import { recommendTargets } from '@/server/recommend/targets';
import { recommendTasks } from '@/server/recommend/tasks';
import { recommendTest } from '@/server/recommend/test';
import { requireCandidate } from '@/server/session';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const Query = z.object({
  /** vacancy:<id> или category:<spec>:<grade>; без него — пробелы не считаются */
  target: z
    .string()
    .max(100)
    .regex(/^(vacancy:[A-Za-z0-9_-]{1,64}|category:(backend|frontend):(junior|middle))$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

/** Тест, пробелы к выбранной цели, задания под пробелы, цели-вакансии. Всё детерминированно. */
export const GET = withErrors(async (req: Request) => {
  const candidateId = requireCandidate(req);
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const test = await recommendTest(candidateId);
  const targets = await recommendTargets(candidateId, q.limit);
  let gaps: Awaited<ReturnType<typeof gapMap>> = [];
  if (q.target) {
    const [kind, ...rest] = q.target.split(':');
    gaps = await gapMap(candidateId, { kind: kind as 'vacancy' | 'category', id: rest.join(':') });
  }
  const tasks = await recommendTasks(candidateId, gaps.slice(0, 10).map((g) => g.id), q.limit);
  return Response.json({ test, gaps, tasks, targets });
});
