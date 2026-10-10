import { getEnv } from '@/server/env';

import type { MailMessage } from './index';

/** Тексты писем. Только plain text: пользовательский текст не попадает в HTML. */
const sign = () => `\n\n—\nФСП Карьера · ${getEnv().APP_URL}\nЕсли вы не запрашивали это письмо, просто проигнорируйте его.`;

export function verifyCodeMail(to: string, code: string): MailMessage {
  return {
    kind: 'verify',
    to,
    subject: `Код подтверждения: ${code}`,
    text: `Код для подтверждения почты на ФСП Карьере: ${code}\n\nКод действует 15 минут. Никому его не сообщайте.${sign()}`,
  };
}

export function resetCodeMail(to: string, code: string): MailMessage {
  return {
    kind: 'reset',
    to,
    subject: `Восстановление пароля: код ${code}`,
    text: `Код для смены пароля на ФСП Карьере: ${code}\n\nКод действует 15 минут. Если вы не просили сменить пароль, ничего не делайте — пароль останется прежним.${sign()}`,
  };
}

/** Повторная регистрация на уже подтверждённую почту: не раскрываем это в ответе API, сообщаем владельцу ящика. */
export function alreadyRegisteredMail(to: string): MailMessage {
  return {
    kind: 'already_registered',
    to,
    subject: 'Аккаунт с этой почтой уже есть',
    text: `Кто-то пытался зарегистрироваться на ФСП Карьере с этой почтой, но аккаунт уже есть.\n\nВойдите: ${getEnv().APP_URL}/auth\nЗабыли пароль — на странице входа выберите «Забыли пароль».${sign()}`,
  };
}

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

export function invitationMail(to: string, p: { companyName: string; vacancyTitle: string | null; salaryFrom: number; salaryTo: number }): MailMessage {
  const what = p.vacancyTitle ? `на позицию «${p.vacancyTitle}»` : 'к разговору о работе';
  const range = p.salaryFrom === p.salaryTo ? rub(p.salaryFrom) : `от ${rub(p.salaryFrom)} до ${rub(p.salaryTo)}`;
  const salary = `\nЗарплата: ${range} в месяц.`;
  return {
    kind: 'invitation',
    to,
    subject: `Новое приглашение от «${p.companyName}»`,
    text: `Компания «${p.companyName}» приглашает вас ${what}.${salary}\n\nОтветить: ${getEnv().APP_URL}/invitations\nКонтакты компания увидит, только если вы примете приглашение.${sign()}`,
  };
}

export function invitationAnswerMail(to: string, p: { accepted: boolean; vacancyTitle: string | null }): MailMessage {
  const what = p.vacancyTitle ? ` на «${p.vacancyTitle}»` : '';
  return {
    kind: p.accepted ? 'invitation_accepted' : 'invitation_declined',
    to,
    subject: p.accepted ? 'Кандидат принял приглашение' : 'Кандидат отклонил приглашение',
    text: p.accepted
      ? `Кандидат принял ваше приглашение${what}. Имя и почта кандидата открыты в кабинете: ${getEnv().APP_URL}/employer/invitations${sign()}`
      : `Кандидат отклонил ваше приглашение${what}. Подборка других кандидатов — в кабинете: ${getEnv().APP_URL}/employer${sign()}`,
  };
}
