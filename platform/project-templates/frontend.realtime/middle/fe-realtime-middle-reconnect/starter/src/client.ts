// Realtime-клиент по контракту (contract.md).
export interface RealtimeTransport {
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
  close(): void;
}
export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';
export interface ServerEvent {
  id: number;
  type: string;
  data: unknown;
}

export interface RealtimeClientOptions {
  connect: (lastEventId: number | null) => RealtimeTransport;
  baseDelayMs?: number;
  maxDelayMs?: number;
}
export interface RealtimeClient {
  start(): void;
  stop(): void;
  status(): ConnectionStatus;
  lastEventId(): number | null;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  onEvent(listener: (event: ServerEvent) => void): () => void;
}

export function createRealtimeClient(_options: RealtimeClientOptions): RealtimeClient {
  // TODO: соединение, backoff, догрузка по lastEventId
  const todo = (): never => {
    throw new Error('не реализовано');
  };
  return { start: todo, stop: todo, status: todo, lastEventId: todo, onStatus: todo, onEvent: todo };
}
