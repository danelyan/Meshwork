// PLATFORM-OWNED: тестовый партнёр и часы для скрытых тестов
import type { OutboxEvent, SendResult } from '../../src/outbox';

export type Reply = SendResult | 'throw';

export function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

/** Партнёр по сценарию: ответы по id события по очереди, по умолчанию 200. Считает одновременные запросы. */
export function partner(script: Record<string, Reply[]> = {}) {
  const calls: { id: string; attempt: number }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const send = async (e: OutboxEvent, attempt: number): Promise<SendResult> => {
    calls.push({ id: e.id, attempt });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight--;
    const r = script[e.id]?.shift() ?? { status: 200 };
    if (r === 'throw') throw new Error('ECONNRESET');
    return r;
  };
  return { send, calls, ids: () => calls.map((c) => c.id), maxInFlight: () => maxInFlight };
}

export const ev = (id: string, key = id): OutboxEvent => ({ id, key, payload: { id } });
