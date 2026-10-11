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

function parse(raw: string): ServerEvent | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const e = v as Record<string, unknown>;
  if (typeof e.id !== 'number' || !Number.isInteger(e.id) || typeof e.type !== 'string') return null;
  return { id: e.id, type: e.type, data: e.data };
}

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  const base = options.baseDelayMs ?? 1000;
  const max = options.maxDelayMs ?? 30000;
  let status: ConnectionStatus = 'closed';
  let last: number | null = null;
  let current: RealtimeTransport | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  const statusListeners = new Set<(s: ConnectionStatus) => void>();
  const eventListeners = new Set<(e: ServerEvent) => void>();

  const setStatus = (s: ConnectionStatus) => {
    if (s === status) return;
    status = s;
    for (const l of [...statusListeners]) l(s);
  };

  function open() {
    const t = options.connect(last);
    current = t;
    t.onopen = () => {
      if (current !== t) return;
      failures = 0;
      setStatus('open');
    };
    t.onmessage = (raw) => {
      if (current !== t) return;
      const ev = parse(raw);
      if (!ev || (last !== null && ev.id <= last)) return;
      last = ev.id;
      for (const l of [...eventListeners]) l(ev);
    };
    t.onclose = () => {
      if (current !== t) return;
      current = null;
      setStatus('reconnecting');
      const delay = Math.min(base * 2 ** failures, max);
      failures += 1;
      timer = setTimeout(() => {
        timer = undefined;
        open();
      }, delay);
    };
  }

  return {
    start() {
      if (status !== 'closed') return;
      failures = 0;
      setStatus('connecting');
      open();
    },
    stop() {
      if (status === 'closed') return;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const t = current;
      current = null;
      setStatus('closed');
      t?.close();
    },
    status: () => status,
    lastEventId: () => last,
    onStatus(l) {
      statusListeners.add(l);
      return () => void statusListeners.delete(l);
    },
    onEvent(l) {
      eventListeners.add(l);
      return () => void eventListeners.delete(l);
    },
  };
}
