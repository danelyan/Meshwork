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

export function createJobQueue(options: QueueOptions): JobQueue {
  void options;
  throw new Error('not implemented');
}
