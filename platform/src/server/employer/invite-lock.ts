// Advisory-lock отправки приглашений компании. Тот же ключ, что берёт createInvitation (`invite:<companyId>`):
// решения модератора, меняющие санкцию (жалоба, апелляция), берут его в своей транзакции, поэтому отправка видит
// санкцию либо целиком до решения, либо целиком после. Равенство ключей проверяет
// tests/integration/admin/moderation/complaints-race.test.ts (отправка ждёт, пока держат этот lock).
import type { Prisma } from '@prisma/client';

export const inviteLockKey = (companyId: string): string => `invite:${companyId}`;

/** Взять lock до конца транзакции (pg_advisory_xact_lock снимается на COMMIT/ROLLBACK). */
export async function lockCompanyInvites(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${inviteLockKey(companyId)}))`;
}
