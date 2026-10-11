import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Промпты защиты проекта — `src/server/defense-room/prompts/*.md`, читаются от process.cwd()
 * (как defense/prompt-utils.ts; в standalone-сборку их кладёт outputFileTracingIncludes из next.config.ts).
 */
/** Версия текстов промптов комнаты (qlc, interviewer, evaluator): поднимается при правке любого из них. */
export const ROOM_PROMPT_VERSION = 'defense-room-prompts-v2-2026-10-12';

const cache = new Map<string, string>();

export function loadRoomPrompt(name: 'qlc' | 'interviewer' | 'evaluator'): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const text = readFileSync(path.join(process.cwd(), 'src/server/defense-room/prompts', `${name}.md`), 'utf8');
  cache.set(name, text);
  return text;
}
