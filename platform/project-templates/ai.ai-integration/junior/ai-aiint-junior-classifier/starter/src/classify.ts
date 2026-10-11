// Классификатор по контракту (contract.md).
import type { Llm } from './llm';

export interface ClassifyInput {
  text: string;
  labels: string[];
}

export interface Classification {
  label: string;
  confidence: number;
  attempts: number;
}

export type ClassifyErrorCode = 'bad_request' | 'llm_failed' | 'invalid_output';

export class ClassifyError extends Error {
  constructor(
    public readonly code: ClassifyErrorCode,
    public readonly attempts: number = 0,
    message: string = code,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ClassifyError';
  }
}

export class ReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplyError';
  }
}

export function buildPrompt(input: ClassifyInput): string {
  void input;
  throw new Error('not implemented');
}

export function parseReply(raw: string, labels: string[]): { label: string; confidence: number } {
  void raw;
  void labels;
  throw new Error('not implemented');
}

export async function classify(llm: Llm, input: ClassifyInput, options?: { maxAttempts?: number }): Promise<Classification> {
  void llm;
  void input;
  void options;
  throw new Error('not implemented');
}
