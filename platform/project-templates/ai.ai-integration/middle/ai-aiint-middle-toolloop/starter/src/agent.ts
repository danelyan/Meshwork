// Цикл вызова инструментов по контракту (contract.md).
import type { Model, ToolInfo } from './model';

export interface ToolSpec extends ToolInfo {
  run(args: Record<string, unknown>): unknown | Promise<unknown>;
}

export type ToolErrorCode = 'unknown_tool' | 'invalid_arguments' | 'tool_error';
export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: { code: ToolErrorCode; message: string } };

export interface ToolRegistry {
  list(): ToolInfo[];
  call(name: string, args: unknown): Promise<ToolOutcome>;
}

export interface StepLog {
  step: number;
  tool: string;
  args: unknown;
  ok: boolean;
  result?: unknown;
  error?: { code: ToolErrorCode; message: string };
}

export interface AgentResult {
  answer: string;
  steps: StepLog[];
  modelCalls: number;
}

export type AgentErrorCode = 'bad_request' | 'step_limit' | 'bad_model_output' | 'model_failed';

export class AgentError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    public readonly steps: StepLog[] = [],
    message: string = code,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AgentError';
  }
}

export function createRegistry(tools: ToolSpec[]): ToolRegistry {
  void tools;
  throw new Error('not implemented');
}

export async function runAgent(options: { model: Model; registry: ToolRegistry; prompt: string; maxSteps?: number }): Promise<AgentResult> {
  void options;
  throw new Error('not implemented');
}
