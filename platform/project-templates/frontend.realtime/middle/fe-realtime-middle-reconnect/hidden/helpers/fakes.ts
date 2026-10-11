// PLATFORM-OWNED: вспомогательный файл скрытых тестов платформы
import type { ConnectionStatus, RealtimeClient, RealtimeTransport, ServerEvent } from '../../src/client';

export class FakeTransport implements RealtimeTransport {
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = 0;
  constructor(readonly lastEventId: number | null) {}
  close(): void {
    this.closed += 1;
  }
  open(): void {
    this.onopen?.();
  }
  drop(): void {
    this.onclose?.();
  }
  push(id: number, type = 'message', data: unknown = {}): void {
    this.onmessage?.(JSON.stringify({ id, type, data }));
  }
  raw(text: string): void {
    this.onmessage?.(text);
  }
}

export function transports() {
  const list: FakeTransport[] = [];
  return {
    list,
    connect: (last: number | null): RealtimeTransport => {
      const t = new FakeTransport(last);
      list.push(t);
      return t;
    },
    last: () => list[list.length - 1]!,
  };
}

// Управляемый клиент для тестов интерфейса: статусом и событиями управляет тест.
export function fakeClient(initial: ConnectionStatus = 'open') {
  let status = initial;
  let lastId: number | null = null;
  const statusL = new Set<(s: ConnectionStatus) => void>();
  const eventL = new Set<(e: ServerEvent) => void>();
  const client: RealtimeClient = {
    start: () => undefined,
    stop: () => undefined,
    status: () => status,
    lastEventId: () => lastId,
    onStatus: (l) => {
      statusL.add(l);
      return () => void statusL.delete(l);
    },
    onEvent: (l) => {
      eventL.add(l);
      return () => void eventL.delete(l);
    },
  };
  return {
    client,
    setStatus(s: ConnectionStatus) {
      status = s;
      [...statusL].forEach((l) => l(s));
    },
    emit(id: number, data: unknown, type = 'message') {
      lastId = id;
      [...eventL].forEach((l) => l({ id, type, data }));
    },
    listeners: () => ({ status: statusL.size, event: eventL.size }),
  };
}

export function sender() {
  const calls: { clientId: string; text: string; resolve: () => void; reject: (e?: unknown) => void }[] = [];
  const send = (clientId: string, text: string) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ clientId, text, resolve, reject });
    });
  return { send, calls };
}
