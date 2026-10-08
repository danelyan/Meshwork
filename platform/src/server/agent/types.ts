// Контракт агента-консультанта (лейн agent). E-01-plan.md § «Контракты», ТЗ § 4.1.
import type { ZodType } from 'zod';

import type { LlmProvider } from '../llm/types';

export type AgentEvent =
  /** «читаю резюме…» */
  | { type: 'step'; text: string }
  | { type: 'queue'; position: number }
  | { type: 'claims'; proposed: unknown[]; rejected: number; hiddenText?: number }
  | { type: 'ask'; question: string; options?: string[] }
  | { type: 'recommendations'; items: unknown[] }
  | { type: 'message'; text: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'done' };

export interface ToolContext {
  candidateId: string;
  conversationId: string;
  emit(e: AgentEvent): void;
  llm: LlmProvider;
}

export interface AgentTool<I, O> {
  name: string;
  description: string;
  input: ZodType<I>;
  output: ZodType<O>;
  handler(ctx: ToolContext, input: I): Promise<O>;
}

/** Лимит вызовов инструментов за один ход. */
export const MAX_TOOL_CALLS_PER_TURN = 6;

export interface TurnInput {
  candidateId: string;
  conversationId: string;
  text: string;
  /** Вложения первого хода: id из /api/uploads и ссылки. */
  uploadIds?: string[];
  urls?: string[];
}
