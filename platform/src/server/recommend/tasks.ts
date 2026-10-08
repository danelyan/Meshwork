import { prisma } from '../db';
import type { Grade } from '../types';

import { assertCandidate, loadCatalog, loadProvenGrade } from './evidence';
import type { TaskRec } from './types';
import { GRADE_INDEX } from './weights';

export interface TaskRow {
  id: string;
  title: string;
  family: string;
  grade: Grade;
  catalogIds: string[];
}

/** Чистое ядро. Порядок: больше закрытых пробелов → ближе к доказанному грейду +1 → id. */
export function rankTasks(
  tasks: TaskRow[],
  gapIds: string[],
  provenGrade: Grade | null,
  statements: Map<string, string>,
  limit: number,
): TaskRec[] {
  const wanted = new Set(gapIds);
  const goal = (provenGrade ? GRADE_INDEX[provenGrade] : -1) + 1; // «на шаг выше доказанного»
  const rows = tasks
    .map((t) => ({ t, closes: [...new Set(t.catalogIds)].filter((id) => wanted.has(id)).sort() }))
    .filter((x) => x.closes.length > 0);
  rows.sort(
    (a, b) =>
      b.closes.length - a.closes.length ||
      Math.abs(GRADE_INDEX[a.t.grade] - goal) - Math.abs(GRADE_INDEX[b.t.grade] - goal) ||
      a.t.id.localeCompare(b.t.id),
  );
  return rows.slice(0, Math.max(0, limit)).map(({ t, closes }) => ({
    taskId: t.id,
    title: t.title,
    family: t.family,
    grade: t.grade,
    closes,
    reason: `Закрывает пробелы: ${closes.map((id) => statements.get(id) ?? id).join('; ')}`,
  }));
}

/** Только из банка заданий (Task), детерминированно. gapIds = catalogId. */
export async function recommendTasks(candidateId: string, gapIds: string[], limit: number): Promise<TaskRec[]> {
  await assertCandidate(candidateId);
  if (gapIds.length === 0) return [];
  const [tasks, catalog, grade] = await Promise.all([
    prisma.task.findMany({ where: { catalogIds: { hasSome: gapIds } } }),
    loadCatalog(),
    loadProvenGrade(candidateId),
  ]);
  const statements = new Map([...catalog.values()].map((e) => [e.id, e.statement]));
  return rankTasks(tasks, gapIds.filter((id) => catalog.has(id)), grade, statements, limit);
}
