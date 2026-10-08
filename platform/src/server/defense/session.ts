import type { LlmProvider } from '../llm/types';
import type { DefenseQuestion, DefenseVerdict } from './types';

export async function startDefense(
  candidateId: string,
  claimId: string,
  llm: LlmProvider,
): Promise<{ sessionId: string; question: DefenseQuestion }> {
  void candidateId;
  void claimId;
  void llm;
  throw new Error('not implemented: defense');
}

export async function answerDefense(
  candidateId: string,
  sessionId: string,
  answer: string,
  llm: LlmProvider,
): Promise<{ next?: DefenseQuestion; verdict?: DefenseVerdict }> {
  void candidateId;
  void sessionId;
  void answer;
  void llm;
  throw new Error('not implemented: defense');
}
