// Детерминированные ответы заглушки для проектов (lane project, ADR 0003): project_spec и project_rubric.
// Разбирают тот же блок <project_context>, что видит модель, и собирают ответ правилами (project/fallback.ts).
import { fallbackSpec, fallbackVerdicts, parseContextBlock, splitWishes } from '../../project/fallback';
import type { CompleteRequest } from '../types';

export function stubProject(req: CompleteRequest): { kind: 'json'; json: unknown } | undefined {
  if (req.purpose !== 'project_spec' && req.purpose !== 'project_rubric') return undefined;
  const user = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const ctx = parseContextBlock(user);
  if (!ctx) return undefined;
  if (ctx.mode === 'spec') return { kind: 'json', json: fallbackSpec(ctx) };
  if (ctx.mode === 'compose') return { kind: 'json', json: { criteria: splitWishes(ctx.wishes) } };
  return { kind: 'json', json: { results: fallbackVerdicts(ctx) } };
}
