import { Semaphore } from '@/server/llm/semaphore';

describe('Semaphore', () => {
  it('не пускает больше max и отдаёт слот следующему по FIFO', async () => {
    const s = new Semaphore(2);
    const r1 = await s.acquire();
    const r2 = await s.acquire();
    const order: number[] = [];
    const p3 = s.acquire().then((r) => (order.push(3), r));
    const p4 = s.acquire().then((r) => (order.push(4), r));
    await Promise.resolve();
    expect(s.running).toBe(2);
    expect(s.queued).toBe(2);
    r1();
    const r3 = await p3;
    expect(order).toEqual([3]);
    expect(s.running).toBe(2);
    r2();
    const r4 = await p4;
    expect(order).toEqual([3, 4]);
    r3();
    r4();
    expect(s.running).toBe(0);
  });

  it('сообщает позицию в очереди и обновляет её при сдвиге', async () => {
    const s = new Semaphore(1);
    const r1 = await s.acquire();
    const posA: number[] = [];
    const posB: number[] = [];
    const pA = s.acquire({ onQueue: (p) => posA.push(p) });
    const pB = s.acquire({ onQueue: (p) => posB.push(p) });
    expect(posA).toEqual([1]);
    expect(posB).toEqual([2]);
    r1();
    const rA = await pA;
    expect(posB).toEqual([2, 1]);
    rA();
    (await pB)();
  });

  it('отмена ожидания убирает из очереди и сдвигает остальных', async () => {
    const s = new Semaphore(1);
    const r1 = await s.acquire();
    const ctrl = new AbortController();
    const posB: number[] = [];
    const pA = s.acquire({ signal: ctrl.signal });
    const pB = s.acquire({ onQueue: (p) => posB.push(p) });
    ctrl.abort(new Error('client gone'));
    await expect(pA).rejects.toThrow('client gone');
    expect(posB).toEqual([2, 1]);
    expect(s.queued).toBe(1);
    r1();
    (await pB)();
    expect(s.running).toBe(0);
  });

  it('повторный release не освобождает лишний слот', async () => {
    const s = new Semaphore(1);
    const r = await s.acquire();
    r();
    r();
    expect(s.running).toBe(0);
    const r2 = await s.acquire();
    expect(s.running).toBe(1);
    r2();
  });
});
