import { parseJsonLoose, stripThinking } from '../json-output';
import type { CompleteRequest, CompleteResult } from '../types';

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Аргументы вызова инструмента приходят строкой JSON; битая строка → `{ _raw }` (как у stub), агент отклонит её по Zod. */
export function parseToolArguments(raw: unknown): unknown {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  const parsed = parseJsonLoose(raw);
  return parsed.ok ? parsed.value : { _raw: raw };
}

/**
 * Итог по тексту ответа: при запрошенной схеме – kind 'json', если текст
 * разбирается как JSON; иначе kind 'text' с сырым текстом (jsonValid=false
 * в журнале, ремонт делает вызывающий – см. completeJson).
 */
export function textOrJson(
  text: string,
  req: CompleteRequest,
): Pick<CompleteResult, 'kind' | 'text' | 'json'> {
  if (req.schema) {
    const parsed = parseJsonLoose(text);
    if (parsed.ok) return { kind: 'json', json: parsed.value };
    return { kind: 'text', text };
  }
  return { kind: 'text', text: stripThinking(text) };
}

/** Имя инструмента из toolCalls предыдущих assistant-сообщений по id вызова. */
export function toolNameIndex(req: CompleteRequest): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of req.messages) for (const c of m.toolCalls ?? []) map.set(c.id, c.name);
  return map;
}
