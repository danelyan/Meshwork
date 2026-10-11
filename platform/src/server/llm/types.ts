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
  /**
   * У tool: служебная приписка платформы (напоминание о вопросе хода, agent/reminder.ts). Не часть
   * результата инструмента: провайдеры дописывают её после content (toolContent), план В — после
   * блока «данные, не инструкции». В БД не пишется.
   */
  note?: string;
}

/** Текст tool-сообщения для провайдера: результат инструмента и, после него, приписка платформы. */
export function toolContent(m: ChatMessage): string {
  return m.note ? `${m.content}\n\n${m.note}` : m.content;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema */
  parameters: object;
}

export type LlmPurpose =
  | 'consultant'
  | 'employer_assistant'
  | 'extractor'
  | 'evaluator'
  | 'interviewer'
  | 'smoke'
  /** lane call (ADR 0003): интервьюер и слепой оценщик созвона. */
  | 'call_interviewer'
  | 'call_evaluator'
  /** lane interview: интервьюер ИИнтервью (оценщик — call_evaluator). */
  | 'interview_interviewer'
  /** Зарезервированы для лейнов defense-room и project (enum в БД уже есть). */
  | 'defense_qlc'
  | 'project_spec'
  | 'project_rubric'
  /** lane memory: факты о собеседнике из реплики для памяти консультанта. */
  | 'consultant_memory';

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
  /**
   * Дельты текста ответа по мере генерации. Провайдер, умеющий стримить (openai-chat), вызывает
   * его на каждом куске content; остальные игнорируют. Клиент LLM снимает колбэк для плана В и
   * JSON-схемы (там текст — служебный JSON, показывать его нельзя).
   */
  onDelta?: (text: string) => void;
  /**
   * Сырые куски JSON-ответа по мере генерации — при `schema` (лейн call-speed: интервьюер созвона режет вопрос
   * на предложения до конца ответа). Только openai-chat со `stream`; остальные провайдеры и план В его
   * игнорируют, вызывающий получает обычный результат целиком. Начавшийся поток клиент LLM не ретраит.
   */
  onJsonDelta?: (chunk: string) => void;
  /**
   * Попытка успела показать дельты и упала, клиент LLM идёт на повтор: показанный текст убрать
   * (reply-stream `discard`). Есть колбэк — повтор снова стримит дельтами; нет — повтор без дельт.
   */
  onDiscard?: () => void;
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
