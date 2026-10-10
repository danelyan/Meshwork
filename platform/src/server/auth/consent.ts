import { errors } from '@/server/errors';
import { grantConsent, hasActiveConsent } from '@/server/consent/service';
import { CONSENT_VERSION } from '@/server/consent/texts';

/**
 * Г1 — согласие на обработку ПДн (R-C-14, 152-ФЗ, ADR 0005): `Consent.kind = pd_processing`.
 * Тексты и версии — server/consent/texts.ts (черновик, не юридический текст). Берётся при регистрации
 * отдельной галкой (/auth, /demo). Отзыв — только удалением аккаунта (eraseOwnAccount).
 */
export { CONSENT_VERSION };

/** Версия из галки регистрации совпадает с текущей; иначе 409 — пользователь не создаётся. */
export function assertConsentVersion(version: string | null | undefined): string {
  if (!version) throw errors.conflict('Нужно согласие на обработку персональных данных');
  if (version !== CONSENT_VERSION) throw errors.conflict('Текст согласия обновился - обновите страницу');
  return version;
}

/**
 * Записать согласие: факт + версия + время (история хранится). Только текущая версия.
 * Если у аккаунта уже есть Candidate — проставляет и `Candidate.consentAt`.
 */
export async function recordConsent(userId: string, version: string = CONSENT_VERSION) {
  if (version !== CONSENT_VERSION) throw errors.conflict('Текст согласия обновился - обновите страницу');
  return grantConsent(userId, { kind: 'pd_processing', version });
}

/** Согласие, если его ещё нет (демо-аккаунты из сида, вход по Яндексу с галкой). */
export async function ensureConsent(userId: string, version: string = CONSENT_VERSION) {
  if (await hasCurrentConsent(userId)) return;
  await recordConsent(userId, version);
}

/** Есть ли действующее согласие на текущую версию текста. */
export async function hasCurrentConsent(userId: string): Promise<boolean> {
  return hasActiveConsent(userId, 'pd_processing');
}
