import { prisma } from '@/server/db';
import { errors } from '@/server/errors';

/**
 * Версия текста согласия на обработку ПДн (R-C-14, 152-ФЗ). Текст —
 * `docs/consent.md` (черновик, не юридический текст). Меняется текст → меняется
 * версия → у всех снова «согласия нет» (hasCurrentConsent = false).
 */
export const CONSENT_VERSION = '2026-10-09-draft';

/**
 * Записать согласие: факт + версия + время (запись не удаляется, история хранится).
 * Принимает только текущую версию: согласие на устаревший текст не засчитываем.
 * Если у аккаунта уже есть Candidate — проставляет и `Candidate.consentAt`.
 */
export async function recordConsent(userId: string, version: string = CONSENT_VERSION) {
  if (version !== CONSENT_VERSION) throw errors.conflict('Текст согласия обновился — обновите страницу');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { candidateId: true } });
  if (!user) throw errors.notFound('Аккаунт не найден');
  const consent = await prisma.consent.create({ data: { userId, version } });
  if (user.candidateId) {
    await prisma.candidate.update({ where: { id: user.candidateId }, data: { consentAt: consent.acceptedAt } });
  }
  return consent;
}

/** Есть ли согласие на текущую версию текста. */
export async function hasCurrentConsent(userId: string): Promise<boolean> {
  const n = await prisma.consent.count({ where: { userId, version: CONSENT_VERSION } });
  return n > 0;
}
