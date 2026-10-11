import { CALL_RECORDING_CONSENT_VERSION } from '../call/consent';
import { prisma } from '../db';
import { errors } from '../errors';

/**
 * Ожидающая защита (lane project → defense-room, ADR 0003): работодатель пригласил на защиту сданного
 * проекта – создаётся CallSession kind=defense со статусом pending, без плана и транскрипта. План
 * (вопросы по коду) строит startDefenseRoom, когда кандидат сам начнёт защиту: только он даёт
 * согласие на запись, и QLC по репозиторию нужен на момент старта, а не приглашения.
 */
export async function requestProjectDefense(candidateId: string, projectSubmissionId: string): Promise<{ callSessionId: string; created: boolean }> {
  return prisma.$transaction(async (tx) => {
    // Два приглашения разных компаний одновременно – одна ожидающая сессия на сабмит.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`defense-pending:${projectSubmissionId}`}))`;
    const sub = await tx.projectSubmission.findUnique({ where: { id: projectSubmissionId }, select: { candidateId: true } });
    if (!sub || sub.candidateId !== candidateId) throw errors.notFound('Сабмит проекта не найден');
    const open = await tx.callSession.findFirst({
      where: { candidateId, kind: 'defense', projectSubmissionId, aiDefense: false, status: { in: ['pending', 'active'] } },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    if (open) return { callSessionId: open.id, created: false };
    const s = await tx.callSession.create({
      data: { candidateId, kind: 'defense', projectSubmissionId, status: 'pending', policyVersion: CALL_RECORDING_CONSENT_VERSION, transcriptJson: [] },
      select: { id: true },
    });
    return { callSessionId: s.id, created: true };
  });
}
