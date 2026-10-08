/**
 * Семафор с FIFO-очередью и позицией ожидающих. Позиция 1 — следующий.
 * Ожидание можно отменить AbortSignal'ом (клиент ушёл, пока стоял в очереди).
 */
interface Waiter {
  resolve: (release: () => void) => void;
  reject: (err: unknown) => void;
  onQueue?: (position: number) => void;
  cleanup?: () => void;
}

export class Semaphore {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new Error('Semaphore: max >= 1');
  }

  get running(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiters.length;
  }

  acquire(opts: { onQueue?: (position: number) => void; signal?: AbortSignal } = {}): Promise<() => void> {
    const { onQueue, signal } = opts;
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, onQueue };
      if (signal) {
        const onAbort = () => {
          const idx = this.waiters.indexOf(waiter);
          if (idx !== -1) {
            this.waiters.splice(idx, 1);
            this.notifyPositions(idx);
          }
          reject(signal.reason ?? new Error('aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        waiter.cleanup = () => signal.removeEventListener('abort', onAbort);
      }
      this.waiters.push(waiter);
      onQueue?.(this.waiters.length);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        next.cleanup?.();
        next.resolve(this.releaser());
        this.notifyPositions(0);
      } else {
        this.active--;
      }
    };
  }

  private notifyPositions(from: number): void {
    for (let i = from; i < this.waiters.length; i++) this.waiters[i]?.onQueue?.(i + 1);
  }
}
