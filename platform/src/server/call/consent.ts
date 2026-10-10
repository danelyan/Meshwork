// Г2 — запись созвона (ADR 0003, п. 4; ADR 0005): `Consent.kind = call_recording`, версия — CALL_RECORDING_CONSENT_VERSION.
// Решение по отзыву (ADR 0005): после отзыва новые созвоны идут в текстовом режиме без записи голоса
// (сервер не принимает аудио), а сохранённые записи удаляются сразу (consent/service.revokeConsent).
import { errors } from '../errors';
import { grantConsent, stateOf, userIdForCandidate } from '../consent/service';
import { CALL_RECORDING_CONSENT_PARAGRAPHS, CALL_RECORDING_CONSENT_VERSION } from '../consent/texts';

export { CALL_RECORDING_CONSENT_PARAGRAPHS, CALL_RECORDING_CONSENT_VERSION, userIdForCandidate };

/**
 * Режим записи: `audio` — согласие действует; `text` — кандидат отозвал согласие, созвон без записи голоса;
 * `ask` — согласия не было (или текст обновился): перед созвоном спросить.
 */
export type CallRecordingMode = 'audio' | 'text' | 'ask';

export async function callRecordingMode(candidateId: string): Promise<CallRecordingMode> {
  const userId = await userIdForCandidate(candidateId);
  if (!userId) return 'ask';
  const st = await stateOf(userId, 'call_recording');
  return st === 'active' ? 'audio' : st === 'revoked' ? 'text' : 'ask';
}

export async function hasCallConsent(candidateId: string): Promise<boolean> {
  return (await callRecordingMode(candidateId)) === 'audio';
}

/** Записать согласие на запись созвона: только текущая версия текста. Повтор — без дубля. */
export async function recordCallConsent(candidateId: string, version: string): Promise<{ version: string; acceptedAt: string }> {
  if (version !== CALL_RECORDING_CONSENT_VERSION) throw errors.conflict('Текст согласия на запись обновился - обнови страницу');
  const userId = await userIdForCandidate(candidateId);
  if (!userId) throw errors.forbidden('Согласие на запись даёт аккаунт кандидата - войди заново');
  const row = await grantConsent(userId, { kind: 'call_recording', version });
  return { version, acceptedAt: row.acceptedAt.toISOString() };
}
