import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Промпты созвона — `src/server/call/prompts/*.md`, читаются от process.cwd() (как defense);
 * standalone-сборка включает их через outputFileTracingIncludes (`./src/server/**\/prompts/*.md`).
 */
const cache = new Map<string, string>();

export function loadCallPrompt(name: 'interviewer' | 'evaluator' | 'test-review' | 'ownership'): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const text = readFileSync(path.join(process.cwd(), 'src/server/call/prompts', `${name}.md`), 'utf8');
  cache.set(name, text);
  return text;
}

/**
 * JSON внутри тега `<call_context>`: `<` экранируется как \u003c, поэтому текст кандидата не может
 * закрыть тег и открыть свой блок, а JSON остаётся валидным (stub разбирает его обратно).
 */
export function contextBlock(data: unknown): string {
  return `<call_context>\n${JSON.stringify(data, null, 1).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}\n</call_context>`;
}

const BLOCK_RE = /<call_context>\n([\s\S]*?)\n<\/call_context>/;

/** Обратная операция (stub, тесты). */
export function parseContextBlock<T>(text: string): T | null {
  const m = BLOCK_RE.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[1] as string) as T;
  } catch {
    return null;
  }
}
