// E-08, фаза 2: решение модератора по жалобе и отправка приглашения сериализуются одним advisory-lock компании.
// Без общего lock отправка могла бы прочитать санкцию посреди решения; здесь доказываем, что ключ один и тот же
// в обе стороны: отправка ждёт решения, решение ждёт отправки.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { resolveComplaint } from '@/server/admin/moderation/complaints';
import type { StaffContext } from '@/server/admin/session';
import { createInvitation } from '@/server/employer/invitations';
import { lockCompanyInvites } from '@/server/employer/invite-lock';

import { ctxEmp, DEMO_POOL, prisma, seedComplaints, setupWorld, type Role, type StaffSession } from './fixtures';

let staff: Record<Role, StaffSession>;
const HOLD_MS = 700;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Дождаться, пока кто-то встанет в очередь за advisory-lock (pg_locks: granted = false). */
async function waitForLockWaiter(timeoutMs = 4000): Promise<number> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
    if ((row?.n ?? 0) > 0 || Date.now() > until) return row?.n ?? 0;
    await sleep(50);
  }
}

/** Промис + флаг «завершился» (успех или ошибка). */
function track<T>(p: Promise<T>) {
  const state = { done: false };
  const wrapped = p.finally(() => {
    state.done = true;
  });
  return { state, wrapped };
}

describe('admin: гонка «решение по жалобе ↔ отправка приглашения»', () => {
  beforeEach(async () => {
    staff = await setupWorld();
  });
  afterAll(() => prisma.$disconnect());

  it('отправка ждёт lock решения и видит санкцию уже после решения (блок снят)', async () => {
    const ids = await seedComplaints(5); // blocked
    let sendTracked: ReturnType<typeof track<{ id: string }>> | null = null;
    await prisma.$transaction(
      async (tx) => {
        await lockCompanyInvites(tx, ctxEmp.companyId);
        sendTracked = track(createInvitation(ctxEmp, { candidateId: DEMO_POOL[6]!.id, message: 'Платёжная команда, Go и Kafka, высокая нагрузка и дежурства', salaryFrom: 200000, salaryTo: 260000 }));
        expect(await waitForLockWaiter()).toBeGreaterThan(0); // отправка встала в очередь за тем же ключом
        await sleep(HOLD_MS);
        expect(sendTracked.state.done).toBe(false);
        // Решение модератора внутри «чужой» транзакции, держащей lock: как resolveComplaint, но с паузой.
        await tx.complaint.update({ where: { id: ids[0]! }, data: { status: 'dismissed', resolvedAt: new Date(), resolution: 'test' } });
      },
      { timeout: 10_000 },
    );
    await expect(sendTracked!.wrapped).resolves.toMatchObject({ status: 'sent' });
  });

  it('решение ждёт lock отправки: resolveComplaint не проходит, пока транзакция отправки открыта', async () => {
    const [id] = await seedComplaints(1);
    const ctx: StaffContext = { staffId: staff.moderator.id, role: 'moderator', ip: null } as unknown as StaffContext;
    let decision: ReturnType<typeof track<unknown>> | null = null;
    await prisma.$transaction(
      async (tx) => {
        await lockCompanyInvites(tx, ctxEmp.companyId); // как createInvitation в середине отправки
        decision = track(resolveComplaint(ctx, id!, 'dismissed', 'Проверено модератором, ложная'));
        expect(await waitForLockWaiter()).toBeGreaterThan(0);
        await sleep(HOLD_MS);
        expect(decision.state.done).toBe(false);
        expect((await tx.complaint.findUniqueOrThrow({ where: { id: id! } })).status).toBe('open');
      },
      { timeout: 10_000 },
    );
    await decision!.wrapped;
    expect((await prisma.complaint.findUniqueOrThrow({ where: { id: id! } })).status).toBe('dismissed');
  });

  it('параллельные решения по одной жалобе: одно 200, второе 409, одна строка журнала', async () => {
    const [id] = await seedComplaints(1);
    const ctx = { staffId: staff.moderator.id, role: 'moderator', ip: null } as unknown as StaffContext;
    const results = await Promise.allSettled([resolveComplaint(ctx, id!, 'dismissed', 'Первое решение модератора'), resolveComplaint(ctx, id!, 'upheld', 'Второе решение модератора')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect(await prisma.adminAuditLog.count({ where: { targetId: id! } })).toBe(1);
  });
});
