// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRealtimeClient, type RealtimeTransport } from '../../src/client';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function net() {
  const list: (RealtimeTransport & { last: number | null })[] = [];
  const connect = (last: number | null) => {
    const t = { onopen: null, onmessage: null, onclose: null, close() {}, last } as RealtimeTransport & { last: number | null };
    list.push(t);
    return t;
  };
  return { list, connect };
}

describe('realtime-клиент (visible)', () => {
  it('задержки переподключения удваиваются до потолка', () => {
    const n = net();
    const client = createRealtimeClient({ connect: n.connect, baseDelayMs: 100, maxDelayMs: 300 });
    client.start();
    for (const wait of [100, 200, 300, 300]) {
      n.list[n.list.length - 1]!.onclose!();
      const before = n.list.length;
      vi.advanceTimersByTime(wait - 1);
      expect(n.list).toHaveLength(before);
      vi.advanceTimersByTime(1);
      expect(n.list).toHaveLength(before + 1);
    }
  });

  it('после обрыва запрашивается lastEventId, повторы отбрасываются', () => {
    const n = net();
    const client = createRealtimeClient({ connect: n.connect, baseDelayMs: 10 });
    const ids: number[] = [];
    client.onEvent((e) => ids.push(e.id));
    client.start();
    n.list[0]!.onopen!();
    n.list[0]!.onmessage!(JSON.stringify({ id: 4, type: 'message', data: {} }));
    n.list[0]!.onclose!();
    vi.advanceTimersByTime(10);
    expect(n.list[1]!.last).toBe(4);
    n.list[1]!.onmessage!(JSON.stringify({ id: 4, type: 'message', data: {} }));
    n.list[1]!.onmessage!(JSON.stringify({ id: 5, type: 'message', data: {} }));
    expect(ids).toEqual([4, 5]);
  });
});
