import type { AgentEvent, TurnInput } from './types';

/** Один ход консультанта: до MAX_TOOL_CALLS_PER_TURN вызовов инструментов, события — в emit. */
export async function runTurn(input: TurnInput, emit: (e: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
  void input;
  void emit;
  void signal;
  throw new Error('not implemented: agent');
}
