import { stubProject } from './stub-project';
import {
  LlmError,
  type ChatMessage,
  type CompleteRequest,
  type CompleteResult,
  type LlmProvider,
  type LlmPurpose,
  type ToolCall,
} from '../types';
import { stubCallEvaluator, stubCallInterviewer } from './stub-call';

/**
 * Детерминированная заглушка LLM для разработки и тестов (LLM_PROVIDER=stub).
 * Порядок решения (первое сработавшее):
 *  1. Фикстура `registerStubResponse(purpose, fn)` вернула не undefined.
 *  2. Маркер `[[error 429]]` / `[[error 503 текст]]` в последнем сообщении user → LlmError с этим статусом.
 *  3. Есть tools, toolChoice ≠ 'none', последнее сообщение — от user и в нём
 *     `[[tool:name {json}]]` (можно несколько) → kind 'tool_calls'.
 *     toolChoice {name} без маркера → вызов этого инструмента с `{}`.
 *  3a. purpose call_interviewer / call_evaluator → детерминированный ответ по `<call_context>` (stub-call.ts).
 *  4. Есть schema → kind 'json': маркер `[[json {...}]]` или минимально валидный
 *     объект, сгенерированный по JSON Schema.
 *  5. Иначе — kind 'text': маркер `[[reply текст]]`; после результатов
 *     инструментов — сводка; иначе ответ по ключевым словам или эхо.
 * Маркер `[[delay 300]]` — задержка ответа (мс), уважает AbortSignal.
 */

export type StubFixture = (
  req: CompleteRequest,
) =>
  | Partial<Pick<CompleteResult, 'kind' | 'text' | 'toolCalls' | 'json'>>
  | undefined
  | Promise<Partial<Pick<CompleteResult, 'kind' | 'text' | 'toolCalls' | 'json'>> | undefined>;

const fixtures = new Map<LlmPurpose, StubFixture[]>();

/** Подменить ответ заглушки для purpose. Последняя зарегистрированная — первой. Возвращает «снять». */
export function registerStubResponse(purpose: LlmPurpose, fn: StubFixture): () => void {
  const list = fixtures.get(purpose) ?? [];
  list.unshift(fn);
  fixtures.set(purpose, list);
  return () => {
    const cur = fixtures.get(purpose);
    if (!cur) return;
    const idx = cur.indexOf(fn);
    if (idx !== -1) cur.splice(idx, 1);
  };
}

export function clearStubResponses(): void {
  fixtures.clear();
}

const TOOL_RE = /\[\[tool:([A-Za-z0-9_.-]+)(?:\s+(\{[\s\S]*?\}))?\]\]/g;
const JSON_MARK_RE = /\[\[json\s+/;
const REPLY_RE = /\[\[reply\s+([\s\S]*?)\]\]/;
const ERROR_RE = /\[\[error\s+(\d{3})(?:\s+([^\]]*))?\]\]/;
const DELAY_RE = /\[\[delay\s+(\d{1,6})\]\]/;

function lastUser(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === 'user') return messages[i];
  return undefined;
}

/** Парсит `{json}` после маркера; JSON, обрезанный ленивым regex на `}`, дочитывается по балансу скобок. */
function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  let n = 0;
  for (const m of text.matchAll(TOOL_RE)) {
    const name = m[1] as string;
    let args: unknown = {};
    if (m[2] !== undefined) {
      const start = (m.index ?? 0) + m[0].indexOf('{');
      const json = balancedJson(text, start);
      try {
        args = JSON.parse(json);
      } catch {
        args = { _raw: json };
      }
    }
    calls.push({ id: `call_${++n}_${name}`, name, arguments: args });
  }
  return calls;
}

function balancedJson(text: string, start: number): string {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if ((ch === '}' || ch === ']') && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minItems?: number;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
  minimum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  format?: string;
};

/** Минимально валидное значение по JSON Schema (draft-07 / 2020-12, как выдаёт z.toJSONSchema). */
export function minimalFromSchema(schema: object, root: object = schema, depth = 0): unknown {
  const s = schema as JsonSchema;
  const r = root as JsonSchema;
  if (depth > 20) return null;
  if (s.const !== undefined) return s.const;
  if (s.default !== undefined) return s.default;
  if (s.enum?.length) return s.enum[0];
  if (s.$ref) {
    const name = s.$ref.replace(/^#\/(\$defs|definitions)\//, '');
    const target = r.$defs?.[name] ?? r.definitions?.[name];
    return target ? minimalFromSchema(target, root, depth + 1) : null;
  }
  const variant = s.anyOf?.[0] ?? s.oneOf?.[0];
  if (variant) return minimalFromSchema(variant, root, depth + 1);
  if (s.allOf?.length) {
    return Object.assign({}, ...s.allOf.map((x) => minimalFromSchema(x, root, depth + 1) as object));
  }
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') ?? s.type[0] : s.type;
  switch (type ?? (s.properties ? 'object' : undefined)) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const key of s.required ?? []) {
        const prop = s.properties?.[key];
        out[key] = prop ? minimalFromSchema(prop, root, depth + 1) : null;
      }
      return out;
    }
    case 'array':
      return Array.from({ length: s.minItems ?? 0 }, () =>
        s.items ? minimalFromSchema(s.items, root, depth + 1) : null,
      );
    case 'string':
      if (s.format === 'date-time') return '1970-01-01T00:00:00.000Z';
      if (s.format === 'uri' || s.format === 'url') return 'https://example.com';
      return 'x'.repeat(s.minLength ?? 0);
    case 'integer':
    case 'number':
      return s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : 0);
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return null;
  }
}

const tokens = (text: string) => Math.ceil(text.length / 4);

function keywordReply(text: string): string {
  const t = text.toLowerCase();
  if (/привет|здравств/.test(t)) return 'Привет! Я консультант (заглушка). Пришли резюме или ссылку - соберу профиль.';
  if (/тест/.test(t)) return 'Категорию даёт только тест. Могу подсказать, какой тест пройти (заглушка).';
  if (/ваканс|компани/.test(t)) return 'Подберу вакансии платформы по твоему профилю (заглушка).';
  return `Заглушка LLM: ${text.trim().slice(0, 200) || 'пустое сообщение'}`;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new LlmError('aborted', 'Запрос отменён'));
      },
      { once: true },
    );
  });
}

export interface StubOptions {
  /** Задержка каждого ответа, мс (для тестов очереди). */
  latencyMs?: number;
  model?: string;
}

export function createStubProvider(opts: StubOptions = {}): LlmProvider {
  const name = 'stub';
  const model = opts.model ?? 'stub-1';

  async function decide(req: CompleteRequest): Promise<Pick<CompleteResult, 'kind' | 'text' | 'toolCalls' | 'json'>> {
    for (const fn of fixtures.get(req.purpose) ?? []) {
      const r = await fn(req);
      if (r !== undefined) {
        const kind = r.kind ?? (r.toolCalls ? 'tool_calls' : r.json !== undefined ? 'json' : 'text');
        return { ...r, kind };
      }
    }
    const last = req.messages[req.messages.length - 1];
    const user = lastUser(req.messages);
    const userText = user?.content ?? '';
    const lastIsUser = last?.role === 'user';

    const err = lastIsUser ? ERROR_RE.exec(userText) : null;
    if (err) {
      const status = Number(err[1]);
      throw new LlmError(
        status === 429 ? 'rate_limited' : status >= 500 ? 'server_error' : 'bad_request',
        err[2]?.trim() || `stub error ${status}`,
        status,
      );
    }

    if (req.purpose === 'call_interviewer' || req.purpose === 'call_evaluator') {
      const built = req.purpose === 'call_interviewer' ? stubCallInterviewer(req) : stubCallEvaluator(req);
      if (built && !(lastIsUser && JSON_MARK_RE.test(userText))) return built;
    }

    if (req.tools?.length && req.toolChoice !== 'none' && lastIsUser) {
      const calls = parseToolCalls(userText);
      if (calls.length) return { kind: 'tool_calls', toolCalls: calls };
      if (typeof req.toolChoice === 'object') {
        return { kind: 'tool_calls', toolCalls: [{ id: `call_1_${req.toolChoice.name}`, name: req.toolChoice.name, arguments: {} }] };
      }
    }

    if (req.schema) {
      // lane project: project_spec / project_rubric по <project_context> (маркер [[json]] важнее)
      const project = lastIsUser && JSON_MARK_RE.test(userText) ? undefined : stubProject(req);
      if (project) return project;
      const mark = lastIsUser ? JSON_MARK_RE.exec(userText) : null;
      if (mark) {
        const start = mark.index + mark[0].length;
        if (userText[start] === '{' || userText[start] === '[') {
          try {
            return { kind: 'json', json: JSON.parse(balancedJson(userText, start)) };
          } catch {
            /* невалидный JSON в маркере — генерируем по схеме */
          }
        }
      }
      return { kind: 'json', json: minimalFromSchema(req.schema.jsonSchema) };
    }

    const reply = REPLY_RE.exec(userText);
    if (reply && lastIsUser) return { kind: 'text', text: (reply[1] as string).trim() };
    if (last?.role === 'tool') {
      const names = new Set<string>();
      for (const m of req.messages) for (const c of m.toolCalls ?? []) names.add(c.name);
      return { kind: 'text', text: `Заглушка LLM: получил результаты инструментов (${[...names].join(', ') || '-'}).` };
    }
    return { kind: 'text', text: keywordReply(userText) };
  }

  return {
    name,
    model,
    supportsTools: true,
    supportsJsonSchema: true,
    async complete(req: CompleteRequest, signal?: AbortSignal): Promise<CompleteResult> {
      const started = Date.now();
      if (signal?.aborted) throw new LlmError('aborted', 'Запрос отменён');
      const delay = DELAY_RE.exec(lastUser(req.messages)?.content ?? '');
      const ms = (delay ? Number(delay[1]) : 0) + (opts.latencyMs ?? 0);
      if (ms > 0) await wait(ms, signal);
      const out = await decide(req);
      const inputText = req.system + req.messages.map((m) => m.content).join('\n');
      const outputText = out.text ?? JSON.stringify(out.json ?? out.toolCalls ?? '');
      return {
        ...out,
        usage: { inputTokens: tokens(inputText), outputTokens: tokens(outputText) },
        latencyMs: Date.now() - started,
        provider: name,
        model,
      };
    },
  };
}
