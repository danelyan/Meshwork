// Outbox по контракту (contract.md).
export interface OutboxEvent {
  id: string;
  key: string;
  payload: unknown;
}

export interface SendResult {
  status: number;
  retryAfterMs?: number;
}

export interface OutboxOptions {
  send: (event: OutboxEvent, attempt: number) => Promise<SendResult>;
  now: () => number;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  breaker: { failureThreshold: number; cooldownMs: number };
  concurrency?: number;
}

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface Outbox {
  enqueue(event: OutboxEvent): boolean;
  tick(): Promise<void>;
  stats(): { pending: number; delivered: number; dead: number; breaker: BreakerState };
  deadLetters(): { event: OutboxEvent; reason: string; attempts: number }[];
}

export function createOutbox(options: OutboxOptions): Outbox {
  void options;
  throw new Error('not implemented');
}
