// Эталон: очередь по ключам (FIFO), ретраи с экспоненциальной задержкой, предохранитель, пул отправок.
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

interface Item {
  event: OutboxEvent;
  seq: number;
  attempts: number;
  nextAt: number;
}

const isInt = (v: number, min: number) => Number.isInteger(v) && v >= min;

export function createOutbox(o: OutboxOptions): Outbox {
  const concurrency = o.concurrency ?? 4;
  if (!isInt(o.maxAttempts, 1) || !(o.baseDelayMs >= 0) || !(o.maxDelayMs >= o.baseDelayMs) || !isInt(o.breaker.failureThreshold, 1) || !(o.breaker.cooldownMs >= 0) || !isInt(concurrency, 1)) {
    throw new RangeError('неверные параметры outbox');
  }
  const seen = new Set<string>();
  const queues = new Map<string, Item[]>();
  const dead: { event: OutboxEvent; reason: string; attempts: number }[] = [];
  let delivered = 0;
  let seq = 0;
  let state: BreakerState = 'closed';
  let fails = 0;
  let openedAt = 0;
  let running: Promise<void> | null = null;

  const breaker = (): BreakerState => {
    if (state === 'open' && o.now() >= openedAt + o.breaker.cooldownMs) state = 'half_open';
    return state;
  };
  const pop = (it: Item) => {
    const q = queues.get(it.event.key)!;
    q.shift();
    if (!q.length) queues.delete(it.event.key);
  };
  const ok = () => {
    fails = 0;
    state = 'closed';
  };
  const fail = () => {
    fails++;
    if (state === 'half_open' || fails >= o.breaker.failureThreshold) {
      state = 'open';
      openedAt = o.now();
    }
  };

  async function attempt(it: Item): Promise<void> {
    it.attempts++;
    let res: SendResult | null;
    try {
      res = await o.send(it.event, it.attempts);
    } catch {
      res = null;
    }
    const s = res?.status ?? 0;
    if (res && s >= 200 && s < 300) {
      pop(it);
      delivered++;
      ok();
      return;
    }
    if (res && !(s >= 500 || s === 408 || s === 429)) {
      pop(it);
      dead.push({ event: it.event, reason: `http_${s}`, attempts: it.attempts });
      ok();
      return;
    }
    fail();
    if (it.attempts >= o.maxAttempts) {
      pop(it);
      dead.push({ event: it.event, reason: 'retries_exhausted', attempts: it.attempts });
      return;
    }
    let delay = Math.min(o.maxDelayMs, o.baseDelayMs * 2 ** (it.attempts - 1));
    if (s === 429 && res?.retryAfterMs !== undefined) delay = Math.max(delay, res.retryAfterMs);
    it.nextAt = o.now() + delay;
  }

  async function run(): Promise<void> {
    const mode = breaker();
    if (mode === 'open') return;
    const t = o.now();
    const heads = [...queues.values()].map((q) => q[0]!).filter((it) => it.nextAt <= t).sort((a, b) => a.seq - b.seq);
    const batch = mode === 'half_open' ? heads.slice(0, 1) : heads;
    let i = 0;
    const worker = async () => {
      while (i < batch.length && state !== 'open') await attempt(batch[i++]!);
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, worker));
  }

  return {
    enqueue(event) {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      const q = queues.get(event.key) ?? [];
      q.push({ event, seq: seq++, attempts: 0, nextAt: o.now() });
      queues.set(event.key, q);
      return true;
    },
    tick() {
      running ??= run().finally(() => {
        running = null;
      });
      return running;
    },
    stats() {
      let pending = 0;
      for (const q of queues.values()) pending += q.length;
      return { pending, delivered, dead: dead.length, breaker: breaker() };
    },
    deadLetters: () => dead.map((d) => ({ ...d })),
  };
}
