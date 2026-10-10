// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { describe, expect, it } from 'vitest';

import { createOutbox, type OutboxEvent, type SendResult } from '../../src/outbox';

function setup(replies: SendResult[] = []) {
  let t = 0;
  const sent: string[] = [];
  const box = createOutbox({
    send: async (e: OutboxEvent) => {
      sent.push(e.id);
      return replies.shift() ?? { status: 200 };
    },
    now: () => t,
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    breaker: { failureThreshold: 5, cooldownMs: 1000 },
  });
  return { box, sent, advance: (ms: number) => void (t += ms) };
}

describe('outbox (visible)', () => {
  it('доставляет событие', async () => {
    const { box, sent } = setup();
    box.enqueue({ id: 'e1', key: 'k', payload: {} });
    await box.tick();
    expect(sent).toEqual(['e1']);
    expect(box.stats()).toMatchObject({ pending: 0, delivered: 1 });
  });

  it('дубликат id не ставится', () => {
    const { box } = setup();
    expect(box.enqueue({ id: 'e1', key: 'k', payload: {} })).toBe(true);
    expect(box.enqueue({ id: 'e1', key: 'k', payload: {} })).toBe(false);
  });

  it('500 — повтор через baseDelayMs', async () => {
    const { box, sent, advance } = setup([{ status: 500 }]);
    box.enqueue({ id: 'e1', key: 'k', payload: {} });
    await box.tick();
    advance(100);
    await box.tick();
    expect(sent).toEqual(['e1', 'e1']);
    expect(box.stats().delivered).toBe(1);
  });
});
