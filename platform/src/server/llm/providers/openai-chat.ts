import OpenAI from 'openai';
import { toLlmError } from '../errors';
import { schemaInstruction } from '../json-output';
import { LlmError, type CompleteRequest, type CompleteResult, type LlmProvider, type ToolCall } from '../types';
import { parseToolArguments, textOrJson, toolNameIndex, type Fetch } from './common';

/**
 * OpenAI-совместимый Chat Completions: Cloud.ru Foundation Models (GigaChat),
 * Yandex OpenAI-совместимый эндпоинт (DeepSeek, Qwen), vLLM.
 * `tools` + `tool_choice`, `response_format: { type: 'json_schema', json_schema: { name, schema, strict } }`.
 * Бэкенд без function calling → `supportsTools: false`, client включает план В.
 * Бэкенд без json_schema → `supportsJsonSchema: false`, схема уходит в system.
 */
export interface OpenAiChatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Имя в журнале AgentRun (cloudru, yandex-openai, vllm); по умолчанию 'openai-chat'. */
  name?: string;
  supportsTools?: boolean;
  supportsJsonSchema?: boolean;
  /** `strict` в tools и json_schema; по умолчанию false. */
  strict?: boolean;
  /** Заголовки сверх Bearer (например, `OpenAI-Project`/`x-folder-id` для Yandex). */
  headers?: Record<string, string>;
  fetch?: Fetch;
  timeoutMs?: number;
}

type ChatMsg =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toChatMessages(req: CompleteRequest, nativeSchema: boolean): ChatMsg[] {
  const names = toolNameIndex(req);
  const system = req.schema && !nativeSchema ? `${req.system}\n\n${schemaInstruction(req.schema)}` : req.system;
  const out: ChatMsg[] = [{ role: 'system', content: system }];
  for (const m of req.messages) {
    if (m.role === 'tool') {
      if (!m.toolCallId) throw new LlmError('bad_request', 'Сообщение tool без toolCallId');
      if (names.has(m.toolCallId)) out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
      else out.push({ role: 'user', content: `Результат инструмента (${m.toolCallId}):\n${m.content}` });
    } else if (m.role === 'assistant') {
      out.push(
        m.toolCalls?.length
          ? {
              role: 'assistant',
              content: m.content.trim() ? m.content : null,
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) },
              })),
            }
          : { role: 'assistant', content: m.content },
      );
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export function toChatBody(req: CompleteRequest, model: string, cfg: Pick<OpenAiChatConfig, 'strict' | 'supportsJsonSchema'>) {
  const strict = cfg.strict ?? false;
  const nativeSchema = cfg.supportsJsonSchema ?? true;
  const body: Record<string, unknown> = { model, messages: toChatMessages(req, nativeSchema) };
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters, strict },
    }));
    const choice = req.toolChoice ?? 'auto';
    body.tool_choice = typeof choice === 'object' ? { type: 'function', function: { name: choice.name } } : choice;
  }
  if (req.schema && nativeSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: req.schema.name, schema: req.schema.jsonSchema, strict },
    };
  }
  return body;
}

interface ChatBody {
  choices?: {
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      refusal?: string | null;
      tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: unknown } }[] | null;
      /** Устаревший формат одиночного вызова (gpt2giga/старые прокси). */
      function_call?: { name?: string; arguments?: unknown } | null;
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export function fromChatBody(res: ChatBody, req: CompleteRequest): Pick<CompleteResult, 'kind' | 'text' | 'toolCalls' | 'json' | 'usage'> {
  const usage = { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
  const choice = res.choices?.[0];
  if (!choice?.message) throw new LlmError('server_error', 'openai-chat: пустой ответ (нет choices)');
  const msg = choice.message;
  const calls: ToolCall[] = [];
  for (const [i, c] of (msg.tool_calls ?? []).entries()) {
    if (!c.function?.name) continue;
    calls.push({ id: c.id || `call_${i + 1}`, name: c.function.name, arguments: parseToolArguments(c.function.arguments) });
  }
  if (!calls.length && msg.function_call?.name) {
    calls.push({ id: 'call_1', name: msg.function_call.name, arguments: parseToolArguments(msg.function_call.arguments) });
  }
  const text = msg.content ?? msg.refusal ?? '';
  if (calls.length) return { kind: 'tool_calls', toolCalls: calls, usage, ...(text.trim() ? { text } : {}) };
  return { ...textOrJson(text, req), usage };
}

export function createOpenAiChatProvider(cfg: OpenAiChatConfig): LlmProvider {
  const name = cfg.name ?? 'openai-chat';
  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl,
    maxRetries: 0,
    timeout: cfg.timeoutMs ?? 120_000,
    ...(cfg.headers ? { defaultHeaders: cfg.headers } : {}),
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
  });

  return {
    name,
    model: cfg.model,
    supportsTools: cfg.supportsTools ?? true,
    supportsJsonSchema: cfg.supportsJsonSchema ?? true,
    async complete(req: CompleteRequest, signal?: AbortSignal): Promise<CompleteResult> {
      const started = Date.now();
      let raw: ChatBody;
      try {
        const body = toChatBody(req, cfg.model, cfg) as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
        raw = (await client.chat.completions.create(body, { signal })) as unknown as ChatBody;
      } catch (err) {
        throw toLlmError(err, name, signal);
      }
      return { ...fromChatBody(raw, req), latencyMs: Date.now() - started, provider: name, model: cfg.model };
    },
  };
}
