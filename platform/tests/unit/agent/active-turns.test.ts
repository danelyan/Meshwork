import { activeTurn, registerTurn, stopTurn } from '@/server/agent/active-turns';

const findFirst = vi.fn();
vi.mock('@/server/db', () => ({ prisma: { conversation: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));
vi.mock('@/server/session', () => ({ requireCandidate: () => 'cand-1' }));
vi.mock('@/server/auth/stale', () => ({ isSessionStale: async () => false }));

const { POST } = await import('@/app/api/consultant/messages/stop/route');
const post = (body: unknown) => new Request('http://localhost/api/consultant/messages/stop', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

afterEach(() => findFirst.mockReset());

describe('реестр активных ходов', () => {
  it('stopTurn отменяет ход и ждёт его завершения; после снятия хода – false', async () => {
    const ctrl = new AbortController();
    const unregister = registerTurn('c1', ctrl);
    ctrl.signal.addEventListener('abort', () => setTimeout(unregister, 5));
    expect(await stopTurn('c1')).toBe(true);
    expect(ctrl.signal.aborted).toBe(true);
    expect(activeTurn('c1')).toBeUndefined();
    expect(await stopTurn('c1')).toBe(false);
  });

  it('stopTurn не ждёт дольше waitMs, если ход не отпускает', async () => {
    const ctrl = new AbortController();
    const unregister = registerTurn('c2', ctrl);
    const t0 = Date.now();
    expect(await stopTurn('c2', 20)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(500);
    unregister();
  });
});

describe('POST /api/consultant/messages/stop', () => {
  it('чужой или несуществующий разговор – 404, ход не трогается', async () => {
    const ctrl = new AbortController();
    const unregister = registerTurn('foreign', ctrl);
    findFirst.mockResolvedValue(null);
    const res = await POST(post({ conversationId: 'foreign' }));
    expect(res.status).toBe(404);
    expect(ctrl.signal.aborted).toBe(false);
    expect(findFirst.mock.calls[0]![0]).toMatchObject({ where: { id: 'foreign', candidateId: 'cand-1' } });
    unregister();
  });

  it('нет активного хода – 204; есть – 200 и ход отменён', async () => {
    findFirst.mockResolvedValue({ id: 'c3' });
    expect((await POST(post({ conversationId: 'c3' }))).status).toBe(204);
    const ctrl = new AbortController();
    const unregister = registerTurn('c3', ctrl);
    ctrl.signal.addEventListener('abort', () => unregister());
    const res = await POST(post({ conversationId: 'c3' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stopped: true });
    expect(ctrl.signal.aborted).toBe(true);
  });

  it('без conversationId – 400', async () => {
    expect((await POST(post({}))).status).toBeGreaterThanOrEqual(400);
  });
});
