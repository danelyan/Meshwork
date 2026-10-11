import type { z } from 'zod';
import { LlmError, type ChatMessage, type CompleteRequest, type CompleteResult, type LlmProvider } from './types';

/** Убирает рассуждения `<think>…</think>` (Qwen/DeepSeek через vLLM) из видимого текста. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
}

/** Конец сбалансированного JSON-значения от `start` (`{` или `[`), с учётом строк; -1 – не закрыт. */
function balancedEnd(text: string, start: number): number {
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
    else if ((ch === '}' || ch === ']') && --depth === 0) return i;
  }
  return -1;
}

export type JsonParse = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Терпимый разбор JSON из ответа модели: целиком; иначе из блока ```json```;
 * иначе первое сбалансированное `{…}`/`[…]` в тексте. Семантику проверяет Zod у вызывающего.
 */
export function parseJsonLoose(raw: string): JsonParse {
  const text = stripThinking(raw);
  if (!text) return { ok: false, error: 'пустой ответ' };
  const tryParse = (s: string): JsonParse => {
    try {
      return { ok: true, value: JSON.parse(s) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
  const whole = tryParse(text);
  if (whole.ok) return whole;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) {
    const r = tryParse(fence[1].trim());
    if (r.ok) return r;
  }
  const start = text.search(/[{[]/);
  if (start === -1) return { ok: false, error: 'в ответе нет JSON' };
  const end = balancedEnd(text, start);
  if (end === -1) return { ok: false, error: 'JSON обрезан (не закрыта скобка)' };
  return tryParse(text.slice(start, end + 1));
}

/** Инструкция «верни JSON по схеме» для провайдеров без нативного json_schema. */
export function schemaInstruction(schema: NonNullable<CompleteRequest['schema']>): string {
  return [
    `Ответь ТОЛЬКО одним JSON-объектом без пояснений и без markdown.`,
    `JSON должен соответствовать схеме «${schema.name}»:`,
    JSON.stringify(schema.jsonSchema),
  ].join('\n');
}

function zodIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`)
    .join('; ');
}

export interface JsonCallResult<T> {
  value: T;
  /** Понадобился ли ремонт (вторая попытка). */
  repaired: boolean;
  /** Сумма токенов по обеим попыткам. */
  usage: CompleteResult['usage'];
  results: CompleteResult[];
}

/**
 * Строгий JSON-вывод с одним ремонтом: запрос со `schema`, проверка Zod;
 * невалидно → повтор с текстом ошибки; снова невалидно → LlmError('invalid_output').
 * `req.schema` должен быть задан (обычно `schemaSpec(name, zod)`).
 */
export async function completeJson<T>(
  llm: LlmProvider,
  req: CompleteRequest,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<JsonCallResult<T>> {
  if (!req.schema) throw new Error('completeJson: req.schema обязателен');
  const results: CompleteResult[] = [];
  const check = (res: CompleteResult): { ok: true; value: T } | { ok: false; error: string; raw: string } => {
    let candidate: unknown;
    let raw: string;
    if (res.kind === 'json' && res.json !== undefined) {
      candidate = res.json;
      raw = JSON.stringify(res.json);
    } else {
      raw = res.text ?? '';
      const parsed = parseJsonLoose(raw);
      if (!parsed.ok) return { ok: false, error: `невалидный JSON: ${parsed.error}`, raw };
      candidate = parsed.value;
    }
    const v = schema.safeParse(candidate);
    return v.success ? { ok: true, value: v.data } : { ok: false, error: `не по схеме: ${zodIssues(v.error)}`, raw };
  };

  const first = await llm.complete(req, signal);
  results.push(first);
  const c1 = check(first);
  const sum = () => ({
    inputTokens: results.reduce((s, r) => s + r.usage.inputTokens, 0),
    outputTokens: results.reduce((s, r) => s + r.usage.outputTokens, 0),
  });
  if (c1.ok) return { value: c1.value, repaired: false, usage: sum(), results };

  const repairMessages: ChatMessage[] = [
    ...req.messages,
    { role: 'assistant', content: c1.raw.slice(0, 8_000) },
    {
      role: 'user',
      content: `Ответ не принят: ${c1.error}. Верни исправленный ответ – только JSON по схеме «${req.schema.name}», без пояснений.`,
    },
  ];
  const second = await llm.complete({ ...req, messages: repairMessages }, signal);
  results.push(second);
  const c2 = check(second);
  if (c2.ok) return { value: c2.value, repaired: true, usage: sum(), results };
  throw new LlmError('invalid_output', `Модель дважды вернула невалидный JSON (${req.schema.name}): ${c2.error}`);
}
