import 'server-only';

import { getEnv } from '@/server/env';
import { deliverable, notifyInBackground, sendMail, type MailMessage } from '@/server/mail';
import { type MailView, renderMailHtml } from '@/server/mail/layout';

/**
 * Письма по итогам модерации (E-08, фаза 2) – в оболочке существующих шаблонов `server/mail` (renderMailHtml).
 * Отправляются после COMMIT решения и в фоне: сбой почты решение не откатывает (как письма о приглашениях).
 */
const sign = () => `\n\n–\nMESHWORK · ${getEnv().APP_URL}`;
const html = (view: Omit<MailView, 'siteUrl'>) => renderMailHtml({ ...view, siteUrl: getEnv().APP_URL });

export function complaintOutcomeMail(to: string, p: { companyName: string; upheld: boolean; resolution: string }): MailMessage {
  const subject = p.upheld ? `Жалоба на «${p.companyName}» подтверждена` : `Жалоба на «${p.companyName}» рассмотрена`;
  const outcome = p.upheld ? 'Модератор подтвердил жалобу: она учитывается в ограничениях компании.' : 'Модератор отклонил жалобу: она не влияет на ограничения компании.';
  const url = `${getEnv().APP_URL}/invitations`;
  return {
    kind: 'complaint_outcome',
    to,
    subject,
    text: `${outcome}\nКомментарий модератора: ${p.resolution}\n\nПриглашения: ${url}${sign()}`,
    html: html({ subject, preheader: outcome, kicker: 'Жалоба', title: subject, lead: [outcome], facts: [{ label: 'Комментарий модератора', value: p.resolution }], action: { label: 'Открыть приглашения', href: url }, accent: 'candidate' }),
  };
}

export function objectionAnswerMail(to: string, p: { answer: string; annulled: boolean }): MailMessage {
  const subject = p.annulled ? 'Возражение рассмотрено: попытка теста аннулирована' : 'Ответ на ваше возражение против оценки';
  const lead = p.annulled
    ? 'Мы рассмотрели возражение и аннулировали попытку теста. Категория по этой попытке снята, тест можно пройти заново.'
    : 'Мы рассмотрели ваше возражение против автоматической оценки (ст. 16 152-ФЗ).';
  const url = `${getEnv().APP_URL}/settings`;
  return {
    kind: 'objection_answer',
    to,
    subject,
    text: `${lead}\n\nОтвет: ${p.answer}\n\nПодробности: ${url}${sign()}`,
    html: html({ subject, preheader: p.answer.slice(0, 80), kicker: 'Возражение', title: subject, lead: [lead], facts: [{ label: 'Ответ', value: p.answer }], action: { label: 'Открыть настройки', href: url }, accent: 'candidate' }),
  };
}

export function appealOutcomeMail(to: string, p: { upheld: boolean; resolution: string; dismissed: number }): MailMessage {
  const subject = p.upheld ? 'Апелляция на ограничение удовлетворена' : 'Апелляция на ограничение отклонена';
  const lead = p.upheld
    ? `Модератор удовлетворил апелляцию: отклонено жалоб – ${p.dismissed}. Ограничение пересчитано.`
    : 'Модератор отклонил апелляцию: ограничение действует по прежним правилам.';
  const url = `${getEnv().APP_URL}/employer/invitations`;
  return {
    kind: 'appeal_outcome',
    to,
    subject,
    text: `${lead}\nКомментарий модератора: ${p.resolution}\n\nКабинет: ${url}${sign()}`,
    html: html({ subject, preheader: lead, kicker: 'Апелляция', title: subject, lead: [lead], facts: [{ label: 'Комментарий модератора', value: p.resolution }], action: { label: 'Открыть приглашения', href: url }, accent: 'employer' }),
  };
}

export function redFlagWarningMail(to: string, p: { what: string; resolution: string }): MailMessage {
  const subject = 'Предупреждение модератора';
  const lead = `Модератор проверил ${p.what} и выносит предупреждение. Повторные нарушения ведут к ограничениям.`;
  const url = `${getEnv().APP_URL}/employer`;
  return {
    kind: 'red_flag_warning',
    to,
    subject,
    text: `${lead}\nПричина: ${p.resolution}\n\nКабинет: ${url}${sign()}`,
    html: html({ subject, preheader: p.resolution.slice(0, 80), kicker: 'Модерация', title: subject, lead: [lead], facts: [{ label: 'Причина', value: p.resolution }], action: { label: 'Открыть кабинет', href: url }, accent: 'employer' }),
  };
}

/** Отправить после решения: недоставляемые адреса пропускаются, ошибка SMTP – только в лог. */
export function sendAfterDecision(kind: string, to: string | null | undefined, build: (to: string) => MailMessage): Promise<void> {
  if (!deliverable(to)) return Promise.resolve();
  return notifyInBackground(kind, () => sendMail(build(to)));
}
