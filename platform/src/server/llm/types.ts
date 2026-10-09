// Контракт LLM-слоя (E-01-plan.md § «Контракты»). Реализации: providers/*.

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** у assistant */
  toolCalls?: ToolCall[];
  /** у tool */
  toolCallId?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema */
  parameters: object;
}

export type LlmPurpose = 'consultant' | 'extractor' | 'evaluator' | 'interviewer' | 'smoke';

export interface CompleteRequest {
  purpose: LlmPurpose;
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: 'auto' | 'none' | { name: string };
  /** строгий JSON-вывод */
  schema?: { name: string; jsonSchema: object };
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface CompleteResult {
  kind: 'text' | 'tool_calls' | 'json';
  text?: string;
  toolCalls?: ToolCall[];
  json?: unknown;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  provider: string;
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsTools: boolean;
  readonly supportsJsonSchema: boolean;
  complete(req: CompleteRequest, signal?: AbortSignal): Promise<CompleteResult>;
}

/**
 * Ошибка провайдера. Провайдеры (лейн llm) бросают её с HTTP-статусом —
 * по нему client решает, ретраить ли. Ошибки SDK openai (`APIError`) тоже
 * несут `.status` и распознаются client'ом без обёртки.
 */
export type LlmErrorCode =
  | 'timeout'
  | 'aborted'
  | 'rate_limited'
  | 'server_error'
  | 'bad_request'
  | 'auth'
  | 'invalid_output'
  /** Запрос не влез в контекст модели (HTTP 400 с текстом о лимите токенов): ретраить тем же телом бессмысленно, вызывающий ужимает историю. */
  | 'context_length'
  | 'unavailable';

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LlmError';
  }
}

/** Контекст вызова через getLlm(): журнал AgentRun и позиция в очереди. */
export interface LlmCallContext {
  candidateId?: string;
  conversationId?: string;
  /** 1 — следующий на очереди. Вызывается при постановке и при каждом сдвиге. */
  onQueue?: (position: number) => void;
}
