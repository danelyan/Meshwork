// PLATFORM-OWNED: интерфейс модели (contract.md). Не меняйте: проверка подставляет свою модель.
export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; toolCall: { id: string; name: string; args: unknown } }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export type ModelStep = { type: 'tool_call'; id: string; name: string; args: unknown } | { type: 'final'; text: string };

export interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, { type: 'string' | 'number' | 'boolean'; required: boolean }>;
}

export interface Model {
  next(messages: Message[], tools: ToolInfo[]): Promise<ModelStep>;
}
