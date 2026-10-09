import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { CONSENT_VERSION } from '@/server/onboarding/consent-text';

/**
 * Версия текста согласия на обработку ПДн (R-C-14, 152-ФЗ). Текст —
 * `docs/consent.md` (черновик, не юридический текст). Согласие берётся при регистрации
 * одной галкой (/auth, /demo), решение владельца 09.10; в чате онбординга шага согласия нет.
 */
export { CONSENT_VERSION };

/** Версия из галки регистрации совпадает с текущей; иначе 409 — пользователь не создаётся. */
export function assertConsentVersion(version: string | null | undefined): string {
  if (!version) throw errors.conflict('Нужно согласие на обработку персональных данных');
  if (version !== CONSENT_VERSION) throw errors.conflict('Текст согласия обновился — обновите страницу');
  return version;
}

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

/**
 * Согласие, если его ещё нет: готовые демо-аккаунты (сид) считаются согласившимися,
 * вход по Яндексу с галкой — тоже. Пишет так же, как recordConsent.
 */
export async function ensureConsent(userId: string, version: string = CONSENT_VERSION) {
  if (await hasCurrentConsent(userId)) return;
  await recordConsent(userId, version);
}

/** Есть ли согласие на текущую версию текста. */
export async function hasCurrentConsent(userId: string): Promise<boolean> {
  const n = await prisma.consent.count({ where: { userId, version: CONSENT_VERSION } });
  return n > 0;
}
