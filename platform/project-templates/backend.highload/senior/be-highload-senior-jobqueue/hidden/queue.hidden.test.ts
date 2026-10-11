// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AttemptTimeoutError,
  JobFailedError,
  NonRetryableError,
  QueueFullError,
  createJobQueue,
} from '../src/queue';

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

const mk = (clock: ReturnType<typeof manualClock>, extra: Record<string, unknown> = {}) =>
  createJobQueue({
    capacity: 3,
    concurrency: 1,
    maxAttempts: 3,
    backoffMs: (n: number) => 100 * n,
    scheduler: clock.scheduler,
    ...extra,
  });

describe('параметры', () => {
  it('некорректные capacity / concurrency / maxAttempts / attemptTimeoutMs дают RangeError', () => {
    const clock = manualClock();
    const ok = { capacity: 1, concurrency: 1, maxAttempts: 1, backoffMs: () => 0, scheduler: clock.scheduler };
    for (const bad of [{ capacity: 0 }, { concurrency: 1.5 }, { maxAttempts: 0 }, { capacity: -1 }, { attemptTimeoutMs: 0 }]) {
      expect(() => createJobQueue({ ...ok, ...bad })).toThrow(RangeError);
    }
    expect(() => createJobQueue(ok)).not.toThrow();
  });
});

describe('приём и backpressure', () => {
  it('свободный слот: job вызывается синхронно, с attempt = 1', () => {
    const q = mk(manualClock());
    const a = manualJob('a');
    void q.submit(a.job);
    expect(a.runs.map((r) => r.attempt)).toEqual([1]);
    expect(q.stats()).toMatchObject({ queued: 0, running: 1 });
  });

  it('capacity считает только ожидающих, а не выполняющихся', async () => {
    const q = mk(manualClock(), { capacity: 2, concurrency: 2 });
    const js = Array.from({ length: 5 }, (_, i) => manualJob(`j${i}`));
    const ps = js.map((j) => q.submit(j.job).catch((e) => e));
    expect(q.stats()).toMatchObject({ running: 2, queued: 2, rejected: 1 });
    expect(await ps[4]).toBeInstanceOf(QueueFullError);
    expect(js[4]!.runs).toHaveLength(0);
  });

  it('после освобождения места очередь снова принимает задачи', async () => {
    const q = mk(manualClock(), { capacity: 1 });
    const a = manualJob('a');
    const b = manualJob('b');
    const c = manualJob('c');
    void q.submit(a.job);
    void q.submit(b.job);
    await expect(q.submit(c.job)).rejects.toBeInstanceOf(QueueFullError);
    a.runs[0]!.ok('x'); // b уходит в работу, место в ожидании свободно
    await flush();
    expect(b.runs).toHaveLength(1);
    const p = q.submit(c.job);
    expect(q.stats().queued).toBe(1);
    b.runs[0]!.ok('y');
    await flush();
    c.runs[0]!.ok('z');
    await expect(p).resolves.toBe('z');
  });

  it('принятая задача не теряется: все принятые завершаются с правильными значениями', async () => {
    const q = mk(manualClock(), { capacity: 4, concurrency: 2 });
    const js = Array.from({ length: 6 }, (_, i) => manualJob<number>(`j${i}`));
    const ps = js.map((j, i) => q.submit(j.job).then((v) => v + i * 0));
    for (let round = 0; round < 6; round++) {
      await flush();
      for (const [i, j] of js.entries()) for (const r of j.runs.splice(0)) r.ok(i * 10);
    }
    expect(await Promise.all(ps)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(q.stats()).toMatchObject({ succeeded: 6, rejected: 0, failed: 0 });
  });
});

describe('порядок запуска', () => {
  it('приоритет high > normal > low, внутри приоритета FIFO', async () => {
    const q = mk(manualClock(), { capacity: 10 });
    const log: string[] = [];
    const first = manualJob('first', log);
    void q.submit(first.job);
    const plan: [string, 'high' | 'normal' | 'low' | undefined][] = [
      ['l1', 'low'], ['n1', undefined], ['h1', 'high'], ['n2', 'normal'], ['h2', 'high'], ['l2', 'low'],
    ];
    const ctl = plan.map(([n, p]) => {
      const j = manualJob(n, log);
      void q.submit(j.job, p ? { priority: p } : undefined);
      return j;
    });
    first.runs[0]!.ok('x');
    for (let i = 0; i < ctl.length; i++) {
      await flush();
      const running = ctl.find((c) => c.runs.length && !(c as { done?: boolean }).done)!;
      (running as { done?: boolean }).done = true;
      running.runs[0]!.ok('x');
    }
    await flush();
    expect(log).toEqual(['first#1', 'h1#1', 'h2#1', 'n1#1', 'n2#1', 'l1#1', 'l2#1']);
  });

  it('освободившийся слот занимается сразу, без участия таймеров', async () => {
    const q = mk(manualClock());
    const a = manualJob('a');
    const b = manualJob('b');
    void q.submit(a.job);
    void q.submit(b.job);
    expect(b.runs).toHaveLength(0);
    a.runs[0]!.ok('x');
    await flush();
    expect(b.runs).toHaveLength(1);
    expect(q.stats()).toMatchObject({ queued: 0, running: 1 });
  });

  it('конкурентность не превышает лимит', async () => {
    const q = mk(manualClock(), { capacity: 20, concurrency: 3 });
    let active = 0;
    let max = 0;
    const ps = Array.from({ length: 10 }, () =>
      q.submit(async () => {
        active++;
        max = Math.max(max, active);
        await new Promise<void>((r) => setImmediate(r));
        active--;
        return 1;
      }),
    );
    await Promise.all(ps);
    expect(max).toBe(3);
  });
});

describe('ретраи', () => {
  it('пауза растёт по backoffMs(n), ретрай не занимает слот и capacity', async () => {
    const clock = manualClock();
    const q = mk(clock, { capacity: 1 });
    const log: string[] = [];
    const a = manualJob('a', log);
    const b = manualJob('b', log);
    const pa = q.submit(a.job).catch((e) => e);
    a.runs[0]!.fail(new Error('e1'));
    await flush();
    expect(q.stats()).toMatchObject({ retrying: 1, running: 0, queued: 0 });
    void q.submit(b.job); // слот свободен: b стартует, пока a ждёт паузу
    expect(log).toEqual(['a#1', 'b#1']);
    clock.advance(99);
    await flush();
    expect(a.runs).toHaveLength(1);
    clock.advance(1);
    await flush();
    expect(q.stats()).toMatchObject({ queued: 1, retrying: 0 }); // a вернулась в очередь, b ещё работает
    b.runs[0]!.ok('b');
    await flush();
    expect(a.runs.map((r) => r.attempt)).toEqual([1, 2]);
    a.runs[1]!.fail(new Error('e2'));
    await flush();
    clock.advance(200);
    await flush();
    a.runs[2]!.fail(new Error('e3'));
    const err = await pa;
    expect(err).toBeInstanceOf(JobFailedError);
    expect(err.attempts).toBe(3);
    expect(err.cause).toMatchObject({ message: 'e3' });
    expect(q.stats()).toMatchObject({ failed: 1, succeeded: 1 });
  });

  it('вернувшийся ретрай не отклоняется, даже если очередь полна, и сохраняет исходный порядок', async () => {
    const clock = manualClock();
    const q = mk(clock, { capacity: 1 });
    const log: string[] = [];
    const a = manualJob('a', log);
    const b = manualJob('b', log);
    const c = manualJob('c', log);
    const pa = q.submit(a.job);
    a.runs[0]!.fail(new Error('e'));
    await flush();
    void q.submit(b.job); // стартует
    void q.submit(c.job); // ждёт: capacity = 1 занята
    clock.advance(100); // a возвращается в очередь поверх capacity, она старше c
    await flush();
    expect(q.stats().queued).toBe(2);
    b.runs[0]!.ok('b');
    await flush();
    expect(log).toEqual(['a#1', 'b#1', 'a#2']);
    a.runs[1]!.ok('a');
    await expect(pa).resolves.toBe('a');
    await flush();
    expect(log).toEqual(['a#1', 'b#1', 'a#2', 'c#1']);
  });

  it('синхронное исключение в job — обычная неудачная попытка', async () => {
    const clock = manualClock();
    const q = mk(clock, { maxAttempts: 2 });
    let calls = 0;
    const p = q.submit(() => {
      calls++;
      throw new Error('sync');
    });
    const settled = p.catch((e) => e);
    await flush();
    clock.advance(100);
    await flush();
    const err = await settled;
    expect(calls).toBe(2);
    expect(err).toBeInstanceOf(JobFailedError);
    expect((err.cause as Error).message).toBe('sync');
  });

  it('NonRetryableError завершает задачу без ретраев', async () => {
    const q = mk(manualClock());
    const a = manualJob('a');
    const p = q.submit(a.job).catch((e) => e);
    const cause = new NonRetryableError('нельзя повторять');
    a.runs[0]!.fail(cause);
    const err = await p;
    expect(err).toBeInstanceOf(JobFailedError);
    expect(err.attempts).toBe(1);
    expect(err.cause).toBe(cause);
    expect(q.stats()).toMatchObject({ retrying: 0, failed: 1 });
  });

  it('успех на повторной попытке: промис разрешается её значением', async () => {
    const clock = manualClock();
    const q = mk(clock);
    const a = manualJob('a');
    const p = q.submit(a.job);
    a.runs[0]!.fail(new Error('e'));
    await flush();
    clock.advance(100);
    await flush();
    a.runs[1]!.ok('вторая');
    await expect(p).resolves.toBe('вторая');
    expect(q.stats()).toMatchObject({ succeeded: 1, failed: 0, retrying: 0 });
  });
});

describe('таймаут попытки', () => {
  it('просроченная попытка освобождает слот, кандидат получает AttemptTimeoutError как cause', async () => {
    const clock = manualClock();
    const q = mk(clock, { maxAttempts: 1, attemptTimeoutMs: 500 });
    const a = manualJob('a');
    const b = manualJob('b');
    const pa = q.submit(a.job).catch((e) => e);
    void q.submit(b.job);
    expect(b.runs).toHaveLength(0);
    clock.advance(500);
    await flush();
    expect(b.runs).toHaveLength(1);
    const err = await pa;
    expect(err).toBeInstanceOf(JobFailedError);
    expect(err.cause).toBeInstanceOf(AttemptTimeoutError);
  });

  it('поздний результат просроченной попытки игнорируется; таймер снимается при своевременном завершении', async () => {
    const clock = manualClock();
    const q = mk(clock, { attemptTimeoutMs: 500 });
    const a = manualJob('a');
    const p = q.submit(a.job);
    clock.advance(500);
    await flush();
    clock.advance(100);
    await flush();
    expect(a.runs.map((r) => r.attempt)).toEqual([1, 2]);
    a.runs[0]!.ok('поздно'); // первая попытка давно просрочена
    await flush();
    expect(q.stats()).toMatchObject({ succeeded: 0, running: 1 });
    a.runs[1]!.ok('вовремя');
    await expect(p).resolves.toBe('вовремя');
    expect(clock.pending()).toBe(0);
  });
});

describe('идемпотентность по ключу', () => {
  it('повторный submit с тем же ключом возвращает тот же промис и не расходует capacity', async () => {
    const q = mk(manualClock(), { capacity: 1 });
    const a = manualJob('a');
    const dup = manualJob('dup');
    const blocker = manualJob('blocker');
    void q.submit(blocker.job);
    const p1 = q.submit(a.job, { key: 'k' });
    const p2 = q.submit(dup.job, { key: 'k' });
    expect(p2).toBe(p1);
    expect(q.stats()).toMatchObject({ queued: 1, rejected: 0 });
    blocker.runs[0]!.ok('b');
    await flush();
    a.runs[0]!.ok('результат');
    await expect(p2).resolves.toBe('результат');
    expect(dup.runs).toHaveLength(0);
    expect(q.stats().succeeded).toBe(2);
  });

  it('ключ действует и во время паузы ретрая; после завершения освобождается', async () => {
    const clock = manualClock();
    const q = mk(clock);
    const a = manualJob('a');
    const p1 = q.submit(a.job, { key: 'k' });
    a.runs[0]!.fail(new Error('e'));
    await flush();
    const dup = manualJob('dup');
    expect(q.submit(dup.job, { key: 'k' })).toBe(p1);
    clock.advance(100);
    await flush();
    a.runs[1]!.ok('ok');
    await p1;
    const again = manualJob('again');
    const p3 = q.submit(again.job, { key: 'k' });
    expect(p3).not.toBe(p1);
    expect(again.runs).toHaveLength(1);
    again.runs[0]!.ok('новый');
    await expect(p3).resolves.toBe('новый');
    expect(dup.runs).toHaveLength(0);
  });

  it('задача, отклонённая по переполнению, ключ не занимает', async () => {
    const q = mk(manualClock(), { capacity: 1 });
    void q.submit(manualJob('a').job);
    void q.submit(manualJob('b').job);
    await expect(q.submit(manualJob('c').job, { key: 'k' })).rejects.toBeInstanceOf(QueueFullError);
    const d = manualJob('d');
    const p = q.submit(d.job, { key: 'k' }).catch((e) => e);
    expect(await p).toBeInstanceOf(QueueFullError); // всё ещё полно, но это новая попытка, а не дубликат
    expect(q.stats().rejected).toBe(2);
  });
});

describe('idle() и счётчики', () => {
  it('idle разрешается сразу, если очередь пуста, и после завершения всего, включая паузы ретрая', async () => {
    const clock = manualClock();
    const q = mk(clock);
    await q.idle();
    const a = manualJob('a');
    void q.submit(a.job).catch(() => {});
    let done = false;
    void q.idle().then(() => (done = true));
    a.runs[0]!.fail(new Error('e'));
    await flush();
    expect(done).toBe(false); // задача в паузе ретрая
    clock.advance(100);
    await flush();
    expect(done).toBe(false);
    a.runs[1]!.ok('x');
    await flush();
    expect(done).toBe(true);
  });
});

describe('DESIGN.md', () => {
  it('разделы «Решения», «Компромиссы», «Границы применимости» не короче 200 символов', () => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../DESIGN.md');
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    for (const h of ['Решения', 'Компромиссы', 'Границы применимости']) {
      const m = new RegExp(`^## ${h}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(text);
      expect(m, h).not.toBeNull();
      expect(m![1]!.trim().length, h).toBeGreaterThanOrEqual(200);
    }
  });
});
