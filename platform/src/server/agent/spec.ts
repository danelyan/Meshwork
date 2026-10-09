import { zodToJsonSchema } from '@/server/llm/schema';
import type { ToolSpec } from '@/server/llm/types';
import type { AgentTool } from './types';

/**
 * JSON Schema инструментов для провайдера: режим `input` (модель присылает вход —
 * поля с `.default()` необязательны), без `$schema` (часть OpenAI-совместимых
 * бэкендов его не принимает). Общий хелпер LLM-слоя — llm/schema.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toolSpecs(tools: AgentTool<any, any>[]): ToolSpec[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: zodToJsonSchema(t.input),
  }));
}

/** Имена инструментов, которых у консультанта быть не должно (ТЗ § 2): запись, отклик, письма, категория. */
export const FORBIDDEN_TOOL_NAME_RE =
  /(confirm|write|save|update|set|delete|remove|apply|respond|reply_to|send|mail|email|message_employer|assign|grade|category|level|invite|accept|decline|http_request|raw_fetch|exec|shell)/i;
