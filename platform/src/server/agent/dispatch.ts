import type { ToolCall } from '@/server/llm/types';
import { wrapExternal } from './external';
import type { AgentTool, ToolContext } from './types';

/** Результат инструмента в сообщении role: tool не длиннее этого (JSON режется с пометкой). */
export const TOOL_RESULT_MAX_CHARS = 24_000;

export interface DispatchResult {
  /** Содержимое сообщения role: tool. */
  content: string;
  ok: boolean;
  /** Валидированный результат (для событий, тестов). */
  output?: unknown;
  errorCode?: 'unknown_tool' | 'invalid_arguments' | 'invalid_output' | 'tool_failed' | 'aborted';
  terminal: boolean;
}

function errorJson(code: string, message: string, details?: unknown): string {
  return JSON.stringify(details === undefined ? { error: { code, message } } : { error: { code, message, details } });
}

export function serializeToolResult(result: unknown, maxChars = TOOL_RESULT_MAX_CHARS): string {
  const json = JSON.stringify(result) ?? 'null';
  if (json.length <= maxChars) return json;
  return `${json.slice(0, maxChars)}\n[… результат обрезан: ${json.length - maxChars} символов]`;
}

/**
 * Один вызов инструмента: имя → Zod-вход → хендлер → Zod-выход → строка для
 * модели. Любая ошибка возвращается модели как результат `{ error }`, цикл не
 * падает (ТЗ: невалидные аргументы → ошибка инструменту). Untrusted-результат
 * оборачивается в `<external_data>` целиком.
 */
export async function dispatchToolCall<C extends { signal?: AbortSignal } = ToolContext>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: AgentTool<any, any, C>[],
  ctx: C,
  call: ToolCall,
): Promise<DispatchResult> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) {
    return {
      ok: false,
      terminal: false,
      errorCode: 'unknown_tool',
      content: errorJson('unknown_tool', `Инструмента «${call.name}» нет. Доступны: ${tools.map((t) => t.name).join(', ')}`),
    };
  }
  const raw = call.arguments === undefined || call.arguments === null || call.arguments === '' ? {} : call.arguments;
  const parsed = tool.input.safeParse(typeof raw === 'string' ? tryJson(raw) : raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return {
      ok: false,
      terminal: false,
      errorCode: 'invalid_arguments',
      content: errorJson('invalid_arguments', `Аргументы ${call.name} не прошли проверку – исправь и вызови снова`, issues),
    };
  }
  if (ctx.signal?.aborted) {
    return { ok: false, terminal: true, errorCode: 'aborted', content: errorJson('aborted', 'Ход отменён') };
  }
  let output: unknown;
  try {
    output = await tool.handler(ctx, parsed.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'tool_failed';
    return { ok: false, terminal: false, errorCode: 'tool_failed', content: errorJson(code, message.slice(0, 500)) };
  }
  const checked = tool.output.safeParse(output);
  if (!checked.success) {
    const issues = checked.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return {
      ok: false,
      terminal: false,
      errorCode: 'invalid_output',
      content: errorJson('invalid_output', `Результат ${call.name} не прошёл проверку схемы`, issues),
    };
  }
  const json = serializeToolResult(checked.data);
  return {
    ok: true,
    terminal: Boolean(tool.terminal),
    output: checked.data,
    content: tool.untrusted ? wrapExternal(`tool:${tool.name}`, json) : json,
  };
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}
