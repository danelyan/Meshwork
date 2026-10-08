import type { TargetRec } from './types';

/** Обратный прогон матчера: вакансии, где кандидат ближе всего. */
export async function recommendTargets(candidateId: string, limit: number): Promise<TargetRec[]> {
  void candidateId;
  void limit;
  throw new Error('not implemented: recommend');
}
