import type { TaskRec } from './types';

/** Только из банка заданий (Task), детерминированно. gapIds = catalogId. */
export async function recommendTasks(candidateId: string, gapIds: string[], limit: number): Promise<TaskRec[]> {
  void candidateId;
  void gapIds;
  void limit;
  throw new Error('not implemented: recommend');
}
