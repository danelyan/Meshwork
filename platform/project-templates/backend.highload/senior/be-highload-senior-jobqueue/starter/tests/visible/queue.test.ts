// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { describe, expect, it } from 'vitest';

import { JobFailedError, QueueFullError, createJobQueue } from '../../src/queue';

const flush = async () => {
  await new Promise<void>((r) => setImmediate(r));
  await new Promise<void>((r) => setImmediate(r));
};

// Ручные часы: таймеры срабатывают только при advance().
function manualClock() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    scheduler: {
      setTimeout(fn: () => void, ms: number) {
        const h = ++id;
        timers.set(h, { at: now + ms, fn });
        return h;
      },
      clearTimeout(h: unknown) {
        timers.delete(h as number);
      },
    },
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        let best: [number, { at: number; fn: () => void }] | undefined;
        for (const t of timers) if (t[1].at <= target && (!best || t[1].at < best[1].at)) best = t;
        if (!best) break;
        now = best[1].at;
        timers.delete(best[0]);
        best[1].fn();
      }
      now = target;
    },
    pending: () => timers.size,
  };
}

// Задача под ручным управлением: каждый запуск записывается, завершает его тест.
function manualJob<T = string>(name: string, log: string[] = []) {
  const runs: { attempt: number; ok: (v: T) => void; fail: (e: unknown) => void }[] = [];
  const job = (ctx: { attempt: number }) =>
    new Promise<T>((ok, fail) => {
      log.push(`${name}#${ctx.attempt}`);
      runs.push({ attempt: ctx.attempt, ok, fail });
    });
  return { job, runs };
}

const base = (clock: ReturnType<typeof manualClock>, extra = {}) => ({
  capacity: 2,
  concurrency: 1,
  maxAttempts: 3,
  backoffMs: (n: number) => 100 * n,
  scheduler: clock.scheduler,
  ...extra,
});

describe('очередь задач (visible)', () => {
  it('первая задача стартует синхронно, результат возвращается', async () => {
    const q = createJobQueue(base(manualClock()));
    const log: string[] = [];
    const a = manualJob('a', log);
    const p = q.submit(a.job);
    expect(log).toEqual(['a#1']);
    a.runs[0]!.ok('готово');
    await expect(p).resolves.toBe('готово');
    expect(q.stats()).toMatchObject({ running: 0, succeeded: 1 });
  });

  it('при переполнении очередь отказывает QueueFullError', async () => {
    const q = createJobQueue(base(manualClock()));
    const jobs = ['a', 'b', 'c', 'd'].map((n) => manualJob(n));
    void q.submit(jobs[0]!.job); // выполняется
    void q.submit(jobs[1]!.job); // ждёт
    void q.submit(jobs[2]!.job); // ждёт
    await expect(q.submit(jobs[3]!.job)).rejects.toBeInstanceOf(QueueFullError);
    expect(jobs[3]!.runs).toHaveLength(0);
    expect(q.stats()).toMatchObject({ queued: 2, running: 1, rejected: 1 });
  });

  it('высокий приоритет обгоняет обычный', async () => {
    const q = createJobQueue(base(manualClock(), { capacity: 5 }));
    const log: string[] = [];
    const a = manualJob('a', log);
    void q.submit(a.job);
    void q.submit(manualJob('n', log).job);
    void q.submit(manualJob('h', log).job, { priority: 'high' });
    a.runs[0]!.ok('x');
    await flush();
    expect(log).toEqual(['a#1', 'h#1']);
  });

  it('неудачная попытка повторяется после паузы, затем JobFailedError', async () => {
    const clock = manualClock();
    const q = createJobQueue(base(clock, { maxAttempts: 2 }));
    const a = manualJob('a');
    const p = q.submit(a.job);
    const settled = p.catch((e) => e);
    a.runs[0]!.fail(new Error('boom'));
    await flush();
    expect(q.stats().retrying).toBe(1);
    clock.advance(100);
    await flush();
    expect(a.runs).toHaveLength(2);
    a.runs[1]!.fail(new Error('boom2'));
    const err = await settled;
    expect(err).toBeInstanceOf(JobFailedError);
    expect(err.attempts).toBe(2);
  });
});
