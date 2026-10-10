// Отдельный пункт согласия — запись созвона (ADR 0003, п. 4). Версия — CALL_RECORDING_CONSENT_VERSION
// (onboarding/consent-text.ts, единое место текстов согласия). Пишется в ту же таблицу Consent.
import { prisma } from '../db';
import { errors } from '../errors';
import { CALL_RECORDING_CONSENT_PARAGRAPHS, CALL_RECORDING_CONSENT_VERSION } from '../onboarding/consent-text';

export { CALL_RECORDING_CONSENT_PARAGRAPHS, CALL_RECORDING_CONSENT_VERSION };

/** Аккаунт кандидата по candidateId (у старых демо-кук userId нет — ищем по связи). */
export async function userIdForCandidate(candidateId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { candidateId }, select: { id: true } });
  return u?.id ?? null;
}

export async function hasCallConsent(candidateId: string): Promise<boolean> {
  const userId = await userIdForCandidate(candidateId);
  if (!userId) return false;
  return (await prisma.consent.count({ where: { userId, version: CALL_RECORDING_CONSENT_VERSION } })) > 0;
}

/** Записать согласие на запись созвона: только текущая версия текста. Повтор — без дубля. */
export async function recordCallConsent(candidateId: string, version: string): Promise<{ version: string; acceptedAt: string }> {
  if (version !== CALL_RECORDING_CONSENT_VERSION) throw errors.conflict('Текст согласия на запись обновился - обнови страницу');
  const userId = await userIdForCandidate(candidateId);
  if (!userId) throw errors.forbidden('Согласие на запись даёт аккаунт кандидата - войди заново');
  const prev = await prisma.consent.findFirst({ where: { userId, version }, orderBy: { acceptedAt: 'desc' } });
  const row = prev ?? (await prisma.consent.create({ data: { userId, version } }));
  return { version, acceptedAt: row.acceptedAt.toISOString() };
}
