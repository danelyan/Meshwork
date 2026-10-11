import { acquireConversationLock } from '@/server/agent/lock';

import { prisma, resetDb } from '../../helpers/db';

describe('acquireConversationLock (advisory xact lock)', () => {
  beforeEach(() => resetDb());
  afterAll(() => prisma.$disconnect());

  it('второй захват того же разговора → null; после release – снова можно', async () => {
    const a = await acquireConversationLock('conv-1');
    expect(a).not.toBeNull();
    expect(await acquireConversationLock('conv-1')).toBeNull();
    const other = await acquireConversationLock('conv-2');
    expect(other).not.toBeNull();
    await a!.release();
    await other!.release();
    const again = await acquireConversationLock('conv-1');
    expect(again).not.toBeNull();
    await again!.release();
  });

  it('истёкший таймаут удержания снимает lock сам (защита от зависшего хода)', async () => {
    const a = await acquireConversationLock('conv-3', { maxHoldMs: 300 });
    expect(a).not.toBeNull();
    await new Promise((r) => setTimeout(r, 700));
    const b = await acquireConversationLock('conv-3');
    expect(b).not.toBeNull();
    await b!.release();
    await a!.release();
  });

  it('другие запросы к БД во время удержания не блокируются', async () => {
    const a = await acquireConversationLock('conv-4');
    const c = await prisma.candidate.create({ data: { email: 'x@example.test', name: 'x' } });
    expect(c.id).toBeTruthy();
    await a!.release();
  });
});
