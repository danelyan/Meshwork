import { getEnv } from '@/server/env';

import { buildMessage, smtpSend } from './smtp';

/**
 * Почта платформы (R-D-04: подтверждение адреса; уведомления о приглашениях).
 * MAIL_PROVIDER=smtp — SMTP из env (на стенде Mailpit, веб-ящик :8025);
 * MAIL_PROVIDER=log — письмо целиком в лог сервера и в журнал в памяти (`mailOutbox`),
 * без сети: тесты и локальный запуск без Mailpit.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Для журнала: verify | reset | invitation | … */
  kind: string;
}

export interface SentMail extends MailMessage {
  at: Date;
}

const OUTBOX_MAX = 100;
const outbox: SentMail[] = [];

/** Последние письма (только MAIL_PROVIDER=log), новые в конце. */
export function mailOutbox(): readonly SentMail[] {
  return outbox;
}

/** Только для тестов. */
export function clearMailOutbox(): void {
  outbox.length = 0;
}

/** Служебные адреса (`user-<id>@users.invalid`) и пустые — писать некуда. */
export function deliverable(email: string | null | undefined): email is string {
  return !!email && !/\.invalid$/i.test(email.trim());
}

/** Отправить письмо. Ошибка SMTP — исключение: вызывающий решает, ронять ли запрос. */
export async function sendMail(msg: MailMessage): Promise<void> {
  const env = getEnv();
  if (env.MAIL_PROVIDER === 'log') {
    outbox.push({ ...msg, at: new Date() });
    if (outbox.length > OUTBOX_MAX) outbox.splice(0, outbox.length - OUTBOX_MAX);
    if (env.NODE_ENV !== 'test') console.info(`[mail] ${msg.kind} → ${msg.to}: ${msg.subject}\n${msg.text}`);
    return;
  }
  const data = buildMessage({ from: env.MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text });
  await smtpSend(
    { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, user: env.SMTP_USER, password: env.SMTP_PASSWORD },
    env.MAIL_FROM,
    msg.to,
    data,
  );
}

/**
 * Уведомление без блокировки запроса: ошибка только в лог (без адреса и текста письма).
 * Возвращает промис для тестов; в обработчиках его не ждут.
 */
export function notifyInBackground(kind: string, task: () => Promise<void>): Promise<void> {
  return task().catch((err: unknown) => {
    console.warn(`[mail] ${kind} не отправлено: ${err instanceof Error ? err.message : 'unknown'}`);
  });
}
