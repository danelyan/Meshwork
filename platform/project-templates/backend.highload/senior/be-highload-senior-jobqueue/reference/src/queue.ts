// Очередь фоновых задач по контракту (contract.md).
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export type Priority = 'high' | 'normal' | 'low';
export interface JobContext {
  attempt: number;
}
export interface QueueOptions {
  capacity: number;
  concurrency: number;
  maxAttempts: number;
  backoffMs: (failedAttempts: number) => number;
  attemptTimeoutMs?: number;
  scheduler: Scheduler;
}
export interface SubmitOptions {
  priority?: Priority;
  key?: string;
}
export interface QueueStats {
  queued: number;
  running: number;
  retrying: number;
  succeeded: number;
  failed: number;
  rejected: number;
}
export interface JobQueue {
  submit<T>(job: (ctx: JobContext) => Promise<T>, options?: SubmitOptions): Promise<T>;
  stats(): QueueStats;
  idle(): Promise<void>;
}

export class QueueFullError extends Error {
  constructor(message = 'queue is full') {
    super(message);
    this.name = 'QueueFullError';
  }
}
export class AttemptTimeoutError extends Error {
  constructor(message = 'attempt timed out') {
    super(message);
    this.name = 'AttemptTimeoutError';
  }
}
export class NonRetryableError extends Error {
  constructor(message = 'non-retryable') {
    super(message);
    this.name = 'NonRetryableError';
  }
}
export class JobFailedError extends Error {
  readonly attempts: number;
  readonly cause: unknown;
  constructor(attempts: number, cause: unknown) {
    super(`job failed after ${attempts} attempt(s)`);
    this.name = 'JobFailedError';
    this.attempts = attempts;
    this.cause = cause;
  }
}

interface Entry {
  seq: number;
  rank: number;
  key?: string;
  job: (ctx: JobContext) => Promise<unknown>;
  attempt: number;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  promise: Promise<unknown>;
}

const RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

export function createJobQueue(options: QueueOptions): JobQueue {
  const { capacity, concurrency, maxAttempts, backoffMs, attemptTimeoutMs, scheduler } = options;
  for (const [name, v] of [['capacity', capacity], ['concurrency', concurrency], ['maxAttempts', maxAttempts]] as const) {
    if (!Number.isInteger(v) || v < 1) throw new RangeError(`${name} must be an integer >= 1`);
  }
  if (attemptTimeoutMs !== undefined && !(attemptTimeoutMs > 0)) throw new RangeError('attemptTimeoutMs must be > 0');

  const waiting: Entry[] = [];
  const byKey = new Map<string, Entry>();
  const idleWaiters: (() => void)[] = [];
  let running = 0;
  let retrying = 0;
  let seq = 0;
  let succeeded = 0;
  let failed = 0;
  let rejected = 0;

  function insert(e: Entry): void {
    const at = waiting.findIndex((w) => w.rank > e.rank || (w.rank === e.rank && w.seq > e.seq));
    if (at === -1) waiting.push(e);
    else waiting.splice(at, 0, e);
  }

  function checkIdle(): void {
    if (waiting.length || running || retrying) return;
    for (const r of idleWaiters.splice(0)) r();
  }

  function finish(e: Entry): void {
    if (e.key !== undefined) byKey.delete(e.key);
  }

  function pump(): void {
    while (running < concurrency && waiting.length) run(waiting.shift()!);
    checkIdle();
  }

  function run(e: Entry): void {
    running++;
    e.attempt++;
    let settled = false;
    let timer: unknown;
    const settle = (after: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) scheduler.clearTimeout(timer);
      running--;
      after();
      pump();
    };
    if (attemptTimeoutMs !== undefined) {
      timer = scheduler.setTimeout(() => {
        timer = undefined;
        settle(() => onFailure(e, new AttemptTimeoutError()));
      }, attemptTimeoutMs);
    }
    new Promise<unknown>((res) => res(e.job({ attempt: e.attempt }))).then(
      (v) =>
        settle(() => {
          succeeded++;
          finish(e);
          e.resolve(v);
        }),
      (err) => settle(() => onFailure(e, err)),
    );
  }

  function onFailure(e: Entry, err: unknown): void {
    if (err instanceof NonRetryableError || e.attempt >= maxAttempts) {
      failed++;
      finish(e);
      e.reject(new JobFailedError(e.attempt, err));
      return;
    }
    retrying++;
    scheduler.setTimeout(() => {
      retrying--;
      insert(e);
      pump();
    }, backoffMs(e.attempt));
  }

  return {
    submit<T>(job: (ctx: JobContext) => Promise<T>, o: SubmitOptions = {}): Promise<T> {
      if (o.key !== undefined) {
        const dup = byKey.get(o.key);
        if (dup) return dup.promise as Promise<T>;
      }
      if (running >= concurrency && waiting.length >= capacity) {
        rejected++;
        return Promise.reject(new QueueFullError());
      }
      let resolve!: (v: unknown) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const e: Entry = { seq: seq++, rank: RANK[o.priority ?? 'normal'], key: o.key, job, attempt: 0, resolve, reject, promise };
      if (e.key !== undefined) byKey.set(e.key, e);
      insert(e);
      pump();
      return promise as Promise<T>;
    },
    stats: () => ({ queued: waiting.length, running, retrying, succeeded, failed, rejected }),
    idle: () => (waiting.length || running || retrying ? new Promise<void>((r) => idleWaiters.push(r)) : Promise.resolve()),
  };
}
