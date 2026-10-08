import type { AgentEvent } from './types';

/** SSE-кадр: `data: <json AgentEvent>\n\n`. */
export function encodeSse(event: AgentEvent): string {
  void event;
  throw new Error('not implemented: agent');
}
