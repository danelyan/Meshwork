import type { TestRecommendation } from './types';

export async function recommendTest(candidateId: string): Promise<TestRecommendation> {
  void candidateId;
  throw new Error('not implemented: recommend');
}
