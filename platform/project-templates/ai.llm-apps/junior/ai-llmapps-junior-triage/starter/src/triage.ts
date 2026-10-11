// Классификация обращений через LLM по контракту (contract.md).
import type { LlmClient } from './llm';

export type Category = 'billing' | 'bug' | 'account' | 'other';
export type Priority = 'low' | 'normal' | 'high';
export interface Triage {
  category: Category;
  priority: Priority;
  summary: string;
}

export type ParseResult =
  | { ok: true; value: Triage }
  | { ok: false; reason: 'not_json' | 'invalid_schema' | 'refusal'; detail?: string };

export type TriageResult =
  | { ok: true; value: Triage; attempts: number }
  | { ok: false; reason: 'empty_input' | 'not_json' | 'invalid_schema' | 'refusal' | 'llm_error'; attempts: number; detail?: string };

export function renderPrompt(template: string, vars: Record<string, string>): string {
  void template;
  void vars;
  throw new Error('not implemented');
}

export function escapeUserInput(text: string): string {
  void text;
  throw new Error('not implemented');
}

export function buildRequest(message: string): { system: string; user: string } {
  void message;
  throw new Error('not implemented');
}

export function parseReply(raw: string): ParseResult {
  void raw;
  throw new Error('not implemented');
}

export async function triage(message: string, llm: LlmClient, opts: { maxAttempts?: number } = {}): Promise<TriageResult> {
  void message;
  void llm;
  void opts;
  throw new Error('not implemented');
}
