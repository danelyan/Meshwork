// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRealtimeClient, type ConnectionStatus, type ServerEvent } from '../src/client';

import { transports } from './helpers/fakes';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(base?: number, max?: number) {
  const net = transports();
  const client = createRealtimeClient({ connect: net.connect, baseDelayMs: base, maxDelayMs: max });
  const statuses: ConnectionStatus[] = [];
  const events: ServerEvent[] = [];
  client.onStatus((s) => statuses.push(s));
  client.onEvent((e) => events.push(e));
  return { net, client, statuses, events };
}

describe('соединение', () => {
  it('до start – closed и connect не вызывается; start даёт connecting и connect(null), onopen – open', () => {
    const { net, client, statuses } = setup();
    expect(client.status()).toBe('closed');
    expect(net.list).toHaveLength(0);
    client.start();
    client.start();
    expect(net.list).toHaveLength(1);
    expect(net.last().lastEventId).toBeNull();
    expect(client.status()).toBe('connecting');
    net.last().open();
    expect(client.status()).toBe('open');
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('обрыв: reconnecting, переподключение через baseDelayMs, статус остаётся reconnecting до onopen', () => {
    const { net, client, statuses } = setup(1000, 30000);
    client.start();
    net.last().open();
    net.last().drop();
    expect(client.status()).toBe('reconnecting');
    vi.advanceTimersByTime(999);
    expect(net.list).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(net.list).toHaveLength(2);
    expect(client.status()).toBe('reconnecting');
    net.last().open();
    expect(statuses).toEqual(['connecting', 'open', 'reconnecting', 'open']);
  });

  it('задержки удваиваются и упираются в потолок: 100, 200, 400, 500, 500', () => {
    const { net, client } = setup(100, 500);
    client.start();
    const waits: number[] = [];
    for (const expected of [100, 200, 400, 500, 500]) {
      net.last().drop();
      const before = net.list.length;
      vi.advanceTimersByTime(expected - 1);
      expect(net.list.length, `раньше ${expected}`).toBe(before);
      vi.advanceTimersByTime(1);
      expect(net.list.length, `в ${expected}`).toBe(before + 1);
      waits.push(expected);
    }
    expect(waits).toHaveLength(5);
  });

  it('значения по умолчанию: 1000 мс и потолок 30000 мс', () => {
    const { net, client } = setup();
    client.start();
    for (let i = 0; i < 5; i++) {
      net.last().drop();
      vi.advanceTimersByTime(1000 * 2 ** i);
    }
    expect(net.list).toHaveLength(6);
    for (let i = 0; i < 3; i++) {
      net.last().drop();
      vi.advanceTimersByTime(30000);
    }
    expect(net.list).toHaveLength(9);
    net.last().drop();
    vi.advanceTimersByTime(29999);
    expect(net.list).toHaveLength(9);
    vi.advanceTimersByTime(1);
    expect(net.list).toHaveLength(10);
  });

  it('onopen обнуляет счётчик попыток: после удачного соединения задержка снова базовая', () => {
    const { net, client } = setup(100, 5000);
    client.start();
    net.last().drop();
    vi.advanceTimersByTime(100);
    net.last().drop();
    vi.advanceTimersByTime(200);
    net.last().open();
    net.last().drop();
    const n = net.list.length;
    vi.advanceTimersByTime(99);
    expect(net.list).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(net.list).toHaveLength(n + 1);
  });

  it('обрыв до onopen тоже ведёт к переподключению с растущей задержкой', () => {
    const { net, client } = setup(100, 5000);
    client.start();
    net.last().drop();
    vi.advanceTimersByTime(100);
    net.last().drop();
    expect(client.status()).toBe('reconnecting');
    vi.advanceTimersByTime(199);
    expect(net.list).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(net.list).toHaveLength(3);
  });

  it('stop: closed, транспорт закрыт, отложенное переподключение отменено, поздние события игнорируются', () => {
    const { net, client, events } = setup(100);
    client.start();
    const t1 = net.last();
    t1.open();
    t1.drop();
    client.stop();
    expect(client.status()).toBe('closed');
    vi.advanceTimersByTime(10_000);
    expect(net.list).toHaveLength(1);
    client.start();
    const t2 = net.last();
    t2.open();
    client.stop();
    expect(t2.closed).toBe(1);
    t2.push(1);
    t2.drop();
    vi.advanceTimersByTime(10_000);
    expect(events).toEqual([]);
    expect(net.list).toHaveLength(2);
    expect(() => client.stop()).not.toThrow();
  });

  it('события и закрытие устаревшего транспорта не влияют на клиента', () => {
    const { net, client, events, statuses } = setup(100);
    client.start();
    const old = net.last();
    old.open();
    old.drop();
    vi.advanceTimersByTime(100);
    const fresh = net.last();
    fresh.open();
    old.push(5);
    old.drop();
    old.open();
    expect(events).toEqual([]);
    expect(client.status()).toBe('open');
    vi.advanceTimersByTime(10_000);
    expect(net.list).toHaveLength(2);
    expect(statuses).toEqual(['connecting', 'open', 'reconnecting', 'open']);
  });
});

describe('события и lastEventId', () => {
  it('события доставляются по порядку, lastEventId обновляется; повторы и старые id отбрасываются', () => {
    const { net, client, events } = setup();
    client.start();
    net.last().open();
    expect(client.lastEventId()).toBeNull();
    net.last().push(1, 'message', { a: 1 });
    net.last().push(2);
    net.last().push(2);
    net.last().push(1);
    net.last().push(5, 'ping');
    expect(events.map((e) => e.id)).toEqual([1, 2, 5]);
    expect(events[0]).toEqual({ id: 1, type: 'message', data: { a: 1 } });
    expect(client.lastEventId()).toBe(5);
  });

  it('переподключение запрашивает актуальный lastEventId, перепроигрывание не дублируется', () => {
    const { net, client, events } = setup(100);
    client.start();
    net.last().open();
    net.last().push(3);
    net.last().drop();
    vi.advanceTimersByTime(100);
    expect(net.last().lastEventId).toBe(3);
    net.last().open();
    net.last().push(2);
    net.last().push(3);
    net.last().push(4);
    expect(events.map((e) => e.id)).toEqual([3, 4]);
    net.last().drop();
    vi.advanceTimersByTime(100);
    expect(net.last().lastEventId).toBe(4);
  });

  it('lastEventId сохраняется после stop, новый start запрашивает его', () => {
    const { net, client } = setup(100);
    client.start();
    net.last().open();
    net.last().push(7);
    client.stop();
    expect(client.lastEventId()).toBe(7);
    client.start();
    expect(net.last().lastEventId).toBe(7);
  });

  it('после stop и start задержка снова начинается с базовой', () => {
    const { net, client } = setup(100, 5000);
    client.start();
    net.last().drop();
    vi.advanceTimersByTime(100);
    net.last().drop();
    client.stop();
    client.start();
    net.last().drop();
    const n = net.list.length;
    vi.advanceTimersByTime(99);
    expect(net.list).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(net.list).toHaveLength(n + 1);
  });

  it('некорректные сообщения молча игнорируются и не двигают lastEventId', () => {
    const { net, client, events } = setup();
    client.start();
    net.last().open();
    for (const raw of ['не json', '42', 'null', '"s"', '[]', '{"id":"1","type":"m"}', '{"id":1.5,"type":"m"}', '{"id":1,"type":5}', '{"type":"m"}', '{"id":null,"type":"m"}'])
      net.last().raw(raw);
    expect(events).toEqual([]);
    expect(client.lastEventId()).toBeNull();
    net.last().push(1);
    expect(events).toHaveLength(1);
  });

  it('пропуски в нумерации допустимы, меньший id после большего отбрасывается', () => {
    const { net, client, events } = setup();
    client.start();
    net.last().open();
    net.last().push(10);
    net.last().push(20);
    net.last().push(15);
    expect(events.map((e) => e.id)).toEqual([10, 20]);
    expect(client.lastEventId()).toBe(20);
  });

  it('отписка работает сразу, повтор того же статуса не уведомляется', () => {
    const { net, client } = setup();
    const seen: string[] = [];
    const offS = client.onStatus((s) => seen.push(s));
    const ev: number[] = [];
    const offE = client.onEvent((e) => ev.push(e.id));
    client.start();
    net.last().open();
    net.last().open();
    offS();
    offE();
    net.last().push(1);
    net.last().drop();
    expect(seen).toEqual(['connecting', 'open']);
    expect(ev).toEqual([]);
  });
});
