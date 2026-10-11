import { z } from 'zod';
import type { CompleteRequest, ToolSpec } from './types';

/**
 * Zod 4 → JSON Schema для tools и строгого вывода.
 *
 * `io: 'input'` – схема описывает то, что модель должна прислать: поля с
 * `.default()` не обязательны, `additionalProperties: false` не ставится
 * (z.object в input-режиме, дока Zod «io»). Ключ `$schema` убираем: часть
 * OpenAI-совместимых бэкендов его не принимает. Непредставимые типы (date,
 * bigint, transform) – ошибка: схема инструмента должна быть чистым JSON.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

/** ToolSpec из Zod-схемы аргументов. */
export function toolSpec(name: string, description: string, args: z.ZodType): ToolSpec {
  return { name, description, parameters: zodToJsonSchema(args) };
}

/** Поле `schema` запроса из Zod-схемы ответа. Имя – [A-Za-z0-9_-], как требует OpenAI. */
export function schemaSpec(name: string, schema: z.ZodType): NonNullable<CompleteRequest['schema']> {
  return { name: name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64), jsonSchema: zodToJsonSchema(schema) };
}

/**
 * JSON Schema ответа модели (structured output): режим `output` – у объектов
 * `additionalProperties: false` (дока Zod «Object schemas»; OpenAI strict этого
 * требует), без `$schema`.
 */
export function responseJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema) as Record<string, unknown>;
  delete out.$schema;
  return out;
}
