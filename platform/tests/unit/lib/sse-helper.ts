import type { AgentEvent } from '@/server/agent/types';

/** Формат кадра по контракту agent (events.ts пока заглушка, поэтому повторяем его здесь). */
export function encodeSseForTest(e: AgentEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}
