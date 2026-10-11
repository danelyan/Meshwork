// Чат по контракту (contract.md).
import type { RealtimeClient } from './client';

export interface ChatViewProps {
  client: RealtimeClient;
  send: (clientId: string, text: string) => Promise<void>;
  makeId?: () => string;
}

export function ChatView(_props: ChatViewProps) {
  // TODO: статус, список сообщений, оптимистичная отправка с откатом
  return <div />;
}
