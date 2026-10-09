import OpenAI from 'openai';
import { toLlmError } from '../errors';
import { schemaInstruction } from '../json-output';
import { LlmError, type CompleteRequest, type CompleteResult, type LlmProvider, type ToolCall } from '../types';
import { parseToolArguments, textOrJson, toolNameIndex, type Fetch } from './common';

/**
 * Yandex AI Studio, Responses API (`https://ai.api.cloud.yandex.net/v1/responses`)
 * через пакет `openai` с `baseURL` — так в quickstart Yandex (JS: `openai.responses.create`,
 * Python: `OpenAI(api_key, project=folder, base_url)`).
 *
 * Формат (Responses API, по доке OpenAI и курсу Yandex AI Studio):
 *  - модель `gpt://<folderId>/<model>`;
 *  - `instructions` = system; история — `input` из сообщений, вызовов `function_call`
 *    и результатов `function_call_output` (без `previous_response_id`: держим
 *    историю у себя, `store: false` — ПДн из резюме не хранятся у провайдера);
 *  - tools плоские: `{ type: 'function', name, description, parameters, strict }`;
 *  - строгий JSON — `text.format = { type: 'json_schema', name, schema, strict }`
 *    (курс AI Studio: `responses.parse(text_format=…)`); вместе с `tools` не шлём —
 *    дока «Структурированный вывод» запрещает совмещать, схема уходит в instructions.
 * Авторизация: `Authorization: Api-Key <ключ>`; IAM-токен (`t1.…`) — `Bearer`.
 */
export interface YandexResponsesConfig {
  apiKey: string;
  folderId: string;
  /** Имя модели (`aliceai-llm`) или готовый URI `gpt://…`. */
  model: string;
  baseUrl: string;
  /** `strict` в tools и json_schema. По умолчанию false: схемы из Zod не всегда «strict-совместимы». */
  strict?: boolean;
  /** Хранить ответы у провайдера (нужно только для previous_response_id). По умолчанию false. */
  store?: boolean;
  /** Модель без function calling → client включит план В. По умолчанию true. */
  supportsTools?: boolean;
  supportsJsonSchema?: boolean;
  /** Для тестов: подмена fetch (записанные ответы без сети). */
  fetch?: Fetch;
  /** Таймаут HTTP в SDK; основной таймаут держит client (AbortSignal). */
  timeoutMs?: number;
}

export function yandexModelUri(folderId: string, model: string): string {
  return model.startsWith('gpt://') ? model : `gpt://${folderId}/${model}`;
}

export function yandexAuthHeader(key: string): string {
  return /^t\d\./.test(key) ? `Bearer ${key}` : `Api-Key ${key}`;
}

type InputItem =
  | { role: 'user' | 'assistant' | 'system'; content: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

/** Сообщения контракта → `input` Responses API. */
export function toResponsesInput(req: CompleteRequest): InputItem[] {
  const names = toolNameIndex(req);
  const items: InputItem[] = [];
  for (const m of req.messages) {
    if (m.role === 'tool') {
      if (!m.toolCallId) throw new LlmError('bad_request', 'Сообщение tool без toolCallId');
      // Результат без предшествующего вызова Responses API не примет — подстрахуемся текстом.
      if (!names.has(m.toolCallId)) {
        items.push({ role: 'user', content: `Результат инструмента (${m.toolCallId}):\n${m.content}` });
      } else {
        items.push({ type: 'function_call_output', call_id: m.toolCallId, output: m.content });
      }
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      if (m.content.trim()) items.push({ role: 'assistant', content: m.content });
      for (const c of m.toolCalls) {
        items.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.arguments ?? {}) });
      }
      continue;
    }
    items.push({ role: m.role, content: m.content });
  }
  return items;
}

export function toResponsesBody(
  req: CompleteRequest,
  model: string,
  cfg: Pick<YandexResponsesConfig, 'strict' | 'store' | 'supportsJsonSchema'>,
) {
  const strict = cfg.strict ?? false;
  // Дока AI Studio «Структурированный вывод»: параметры формата ответа не совмещать с `tools`
  // в одном запросе. Если вызывающий прислал и то и другое — схема уходит текстом в instructions.
  const nativeSchema = (cfg.supportsJsonSchema ?? true) && !req.tools?.length;
  const body: Record<string, unknown> = {
    model,
    instructions: req.schema && !nativeSchema ? `${req.system}\n\n${schemaInstruction(req.schema)}` : req.system,
    input: toResponsesInput(req),
    store: cfg.store ?? false,
  };
  if (req.maxTokens !== undefined) body.max_output_tokens = req.maxTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      strict,
    }));
    const choice = req.toolChoice ?? 'auto';
    body.tool_choice = typeof choice === 'object' ? { type: 'function', name: choice.name } : choice;
  }
  if (req.schema && nativeSchema) {
    body.text = { format: { type: 'json_schema', name: req.schema.name, schema: req.schema.jsonSchema, strict } };
  }
  return body;
}

interface ResponsesOutputItem {
  type?: string;
  call_id?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  content?: { type?: string; text?: string; refusal?: string }[];
}
interface ResponsesBody {
  status?: string;
  error?: { code?: string; message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: ResponsesOutputItem[];
  usage?: { input_tokens?: number; output_tokens?: number } | null;
}

/** Ответ Responses API → kind/text/toolCalls/json контракта. */
export function fromResponsesBody(res: ResponsesBody, req: CompleteRequest): Pick<CompleteResult, 'kind' | 'text' | 'toolCalls' | 'json' | 'usage'> {
  if (res.status === 'failed' || res.error) {
    throw new LlmError('server_error', `yandex: генерация не удалась (${res.error?.code ?? res.status}: ${res.error?.message ?? ''})`.trim());
  }
  const usage = { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 };
  const calls: ToolCall[] = [];
  const texts: string[] = [];
  let refusal: string | undefined;
  for (const item of res.output ?? []) {
    if (item.type === 'function_call' && item.name) {
      calls.push({ id: item.call_id ?? item.id ?? `call_${calls.length + 1}`, name: item.name, arguments: parseToolArguments(item.arguments) });
    } else if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && typeof part.text === 'string') texts.push(part.text);
        if (part.type === 'refusal' && part.refusal) refusal = part.refusal;
      }
    }
  }
  if (calls.length) return { kind: 'tool_calls', toolCalls: calls, usage, ...(texts.length ? { text: texts.join('') } : {}) };
  const text = texts.join('') || refusal || '';
  return { ...textOrJson(text, req), usage };
}

export function createYandexResponsesProvider(cfg: YandexResponsesConfig): LlmProvider {
  const name = 'yandex';
  const model = yandexModelUri(cfg.folderId, cfg.model);
  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl,
    project: cfg.folderId,
    defaultHeaders: { Authorization: yandexAuthHeader(cfg.apiKey) },
    maxRetries: 0, // ретраи — в client.ts (только 429/5xx, с журналом)
    timeout: cfg.timeoutMs ?? 120_000,
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
  });

  return {
    name,
    model,
    supportsTools: cfg.supportsTools ?? true,
    supportsJsonSchema: cfg.supportsJsonSchema ?? true,
    async complete(req: CompleteRequest, signal?: AbortSignal): Promise<CompleteResult> {
      const started = Date.now();
      let raw: ResponsesBody;
      try {
        // Тело собираем сами (Yandex-совместимое подмножество) — типы SDK шире, чем нужно.
        const body = toResponsesBody(req, model, cfg) as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming;
        raw = (await client.responses.create(body, { signal })) as unknown as ResponsesBody;
      } catch (err) {
        throw toLlmError(err, name, signal);
      }
      return { ...fromResponsesBody(raw, req), latencyMs: Date.now() - started, provider: name, model };
    },
  };
}
