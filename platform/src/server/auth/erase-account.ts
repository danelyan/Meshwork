import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { getEnv } from '@/server/env';
import { uploadRoot } from '@/server/uploads/storage';

/** Server-generated IDs only; filesystem deletion never accepts a path from a request. */
export function ownedDirectory(root: string, id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw errors.badRequest('Некорректный идентификатор хранилища');
  const base = resolve(root);
  const target = resolve(base, id);
  if (!target.startsWith(base + sep)) throw errors.badRequest('Некорректный путь хранилища');
  return target;
}

/** Deletes both profiles belonging to the authenticated account, never a supplied candidate ID. */
export async function eraseOwnAccount(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: {
    isDemo: true, accounts: { select: { provider: true } }, candidateId: true,
    employerProfile: { select: { id: true, companyId: true } },
  } });
  if (!user) throw errors.notFound('Аккаунт не найден');
  if (user.isDemo && !user.accounts.some((a) => a.provider === 'demo')) {
    throw errors.forbidden('Общий демонстрационный аккаунт удалить нельзя. Создайте свой профиль.');
  }
  // Files are removed before database records: on I/O failure there is no success response,
  // and the owner can retry using the same account and retained storage identifiers.
  if (user.candidateId) {
    const calls = await prisma.callSession.findMany({ where: { candidateId: user.candidateId }, select: { id: true, status: true } });
    if (calls.some((c) => c.status === 'active')) throw errors.conflict('Завершите активный созвон перед удалением аккаунта.');
    const dirs = [ownedDirectory(uploadRoot(), user.candidateId), ...calls.map((c) => ownedDirectory(resolve(getEnv().CALL_DATA_DIR, 'calls'), c.id))];
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  }
  await prisma.$transaction(async (tx) => {
    if (user.candidateId) {
      // DefenseRoomPlan has a plain session ID, not a foreign key, so it does not cascade.
      const calls = await tx.callSession.findMany({ where: { candidateId: user.candidateId }, select: { id: true } });
      await tx.defenseRoomPlan.deleteMany({ where: { callSessionId: { in: calls.map((call) => call.id) } } });
      await tx.agentRun.deleteMany({ where: { candidateId: user.candidateId } });
      await tx.candidate.deleteMany({ where: { id: user.candidateId } });
    }
    const employer = user.employerProfile;
    if (employer) {
      // Employer LLM logs are linked only by the conversation's plain ID.
      const conversations = await tx.employerConversation.findMany({ where: { employerProfileId: employer.id }, select: { id: true } });
      await tx.agentRun.deleteMany({ where: { conversationId: { in: conversations.map((conversation) => conversation.id) } } });
      await tx.invitation.deleteMany({ where: { employerProfileId: employer.id } });
      await tx.employerProfile.deleteMany({ where: { id: employer.id } });
      if (await tx.employerProfile.count({ where: { companyId: employer.companyId } }) === 0) {
        await tx.company.deleteMany({ where: { id: employer.companyId } });
      }
    }
    await tx.user.delete({ where: { id: userId } });
  });
}
