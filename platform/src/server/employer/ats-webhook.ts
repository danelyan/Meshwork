// ATS (R-X-02, концепт): подписанный вебхук о смене статуса приглашения. Отправка только при заданных
// ATS_WEBHOOK_URL и ATS_WEBHOOK_SECRET, иначе no-op. Контактов и имён кандидата в теле нет: только псевдоним
// и флаг «контакты открыты»; сами контакты ATS получает через интерфейс платформы после принятия.
// «Контакты открыты» = accepted и действующее раскрытие Г5 (ADR 0005); отзыв раскрытия шлёт событие с false.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { disclosedInvitationIds } from '../consent/service';
import { prisma } from '../db';
import { getEnv } from '../env';

import { isDisclosableStatus } from './invitation-status';
import { pseudonym } from './privacy';

export const ATS_EVENT = 'invitation.status_changed';
export const ATS_TIMEOUT_MS = 5_000;

export interface AtsStatusChange {
  invitationId: string;
  status: 'sent' | 'viewed' | 'accepted' | 'declined' | 'hired' | 'withdrawn';
  companyId: string;
  vacancyId: string | null;
  candidateId: string;
  /** Контакты открыты: accepted/hired и действующее раскрытие (Г5). Не задано — по статусу (accepted/hired). */
  contactsOpen?: boolean;
}

export interface AtsWebhook {
  /** Идемпотентный id: одно и то же изменение статуса даёт тот же id при любом повторе. */
  id: string;
  body: string;
  headers: Record<string, string>;
}

/** `sha256=<hex>` — HMAC-SHA256 по телу запроса. */
export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** Тело и заголовки вебхука (X-FSP-Event, X-FSP-Signature, X-FSP-Event-Id). Чистая функция. */
export function buildAtsWebhook(change: AtsStatusChange, secret: string, now = new Date()): AtsWebhook {
  const contactsOpen = change.contactsOpen ?? isDisclosableStatus(change.status);
  // Отзыв раскрытия при прежнем статусе accepted — отдельное событие со своим id (иначе ATS отбросит его как повтор).
  const revoked = isDisclosableStatus(change.status) && !contactsOpen ? ':disclosure_revoked' : '';
  const id = `evt_${createHash('sha256').update(`${ATS_EVENT}:${change.invitationId}:${change.status}${revoked}`).digest('hex').slice(0, 32)}`;
  const body = JSON.stringify({
    id,
    event: ATS_EVENT,
    createdAt: now.toISOString(),
    data: {
      invitationId: change.invitationId,
      status: change.status,
      companyId: change.companyId,
      vacancyId: change.vacancyId,
      candidate: pseudonym(change.candidateId),
      contactsOpen,
    },
  });
  return {
    id,
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-FSP-Event': ATS_EVENT,
      'X-FSP-Event-Id': id,
      'X-FSP-Signature': signBody(body, secret),
    },
  };
}

/** Проверка подписи на стороне получателя (для ATS и тестов). */
export function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signBody(body, secret));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Отправка. Без url или секрета — no-op (false). Сбой сети не бросает: вебхук не должен ломать ответ кандидату. */
export async function sendAtsWebhook(
  change: AtsStatusChange,
  cfg: { url?: string; secret?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!cfg.url || !cfg.secret) return false;
  const hook = buildAtsWebhook(change, cfg.secret);
  try {
    const res = await fetchImpl(cfg.url, { method: 'POST', headers: hook.headers, body: hook.body, signal: AbortSignal.timeout(ATS_TIMEOUT_MS) });
    return res.ok;
  } catch (err) {
    console.warn(`[ats] вебхук ${hook.id} не доставлен: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Вебхук по приглашению из БД. Окружение не настроено — выходит до запроса к БД. */
export async function notifyAtsStatusChanged(invitationId: string): Promise<void> {
  const { ATS_WEBHOOK_URL: url, ATS_WEBHOOK_SECRET: secret } = getEnv();
  if (!url || !secret) return;
  const inv = await prisma.invitation.findUnique({ where: { id: invitationId }, select: { id: true, status: true, companyId: true, vacancyId: true, candidateId: true } });
  if (!inv?.companyId) return;
  const contactsOpen = isDisclosableStatus(inv.status) && (await disclosedInvitationIds([inv.id])).has(inv.id);
  await sendAtsWebhook({ invitationId: inv.id, status: inv.status, companyId: inv.companyId, vacancyId: inv.vacancyId, candidateId: inv.candidateId, contactsOpen }, { url, secret });
}
