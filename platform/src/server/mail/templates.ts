import { formatMsk } from '@/lib/msk';
import { getEnv } from '@/server/env';

import type { MailMessage } from './index';
import { type MailView, renderMailHtml } from './layout';

/**
 * Письма платформы: текст и HTML-вариант одного содержания. Текст — для клиентов без HTML и для журнала;
 * HTML собирает `renderMailHtml`: поля передаются туда обычным текстом и экранируются в оболочке,
 * поэтому пользовательский текст (компания, вакансия) разметкой не становится.
 */
const sign = () => `\n\n—\nФСП Карьера · ${getEnv().APP_URL}\nЕсли вы не запрашивали это письмо, просто проигнорируйте его.`;

const html = (view: Omit<MailView, 'siteUrl'>) => renderMailHtml({ ...view, siteUrl: getEnv().APP_URL });

export function verifyCodeMail(to: string, code: string): MailMessage {
  const subject = `Код подтверждения: ${code}`;
  return {
    kind: 'verify',
    to,
    subject,
    text: `Код для подтверждения почты на ФСП Карьере: ${code}\n\nКод действует 15 минут. Никому его не сообщайте.${sign()}`,
    html: html({
      subject,
      preheader: `Код ${code} действует 15 минут.`,
      kicker: 'Подтверждение почты',
      title: 'Код подтверждения',
      lead: ['Введите этот код на странице регистрации, чтобы подтвердить почту на ФСП Карьере.'],
      code,
      notes: ['Код действует 15 минут. Никому его не сообщайте.'],
    }),
  };
}

export function resetCodeMail(to: string, code: string): MailMessage {
  const subject = `Восстановление пароля: код ${code}`;
  return {
    kind: 'reset',
    to,
    subject,
    text: `Код для смены пароля на ФСП Карьере: ${code}\n\nКод действует 15 минут. Если вы не просили сменить пароль, ничего не делайте — пароль останется прежним.${sign()}`,
    html: html({
      subject,
      preheader: `Код ${code} действует 15 минут.`,
      kicker: 'Восстановление пароля',
      title: 'Код для смены пароля',
      lead: ['Введите этот код на странице входа и задайте новый пароль на ФСП Карьере.'],
      code,
      notes: ['Код действует 15 минут.', 'Если вы не просили сменить пароль, ничего не делайте - пароль останется прежним.'],
    }),
  };
}

/** Повторная регистрация на уже подтверждённую почту: не раскрываем это в ответе API, сообщаем владельцу ящика. */
export function alreadyRegisteredMail(to: string): MailMessage {
  const subject = 'Аккаунт с этой почтой уже есть';
  const loginUrl = `${getEnv().APP_URL}/auth`;
  return {
    kind: 'already_registered',
    to,
    subject,
    text: `Кто-то пытался зарегистрироваться на ФСП Карьере с этой почтой, но аккаунт уже есть.\n\nВойдите: ${loginUrl}\nЗабыли пароль — на странице входа выберите «Забыли пароль».${sign()}`,
    html: html({
      subject,
      preheader: 'Кто-то пытался зарегистрироваться с вашей почтой. Войдите или восстановите пароль.',
      kicker: 'Регистрация',
      title: subject,
      lead: ['Кто-то пытался зарегистрироваться на ФСП Карьере с этой почтой, но аккаунт уже есть.'],
      action: { label: 'Войти', href: loginUrl },
      notes: ['Забыли пароль - на странице входа выберите «Забыли пароль».'],
    }),
  };
}

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

export function invitationMail(to: string, p: { companyName: string; vacancyTitle: string | null; salaryFrom: number; salaryTo: number }): MailMessage {
  const what = p.vacancyTitle ? `на позицию «${p.vacancyTitle}»` : 'к разговору о работе';
  const range = p.salaryFrom === p.salaryTo ? rub(p.salaryFrom) : `от ${rub(p.salaryFrom)} до ${rub(p.salaryTo)}`;
  const salary = `\nЗарплата: ${range} в месяц.`;
  const subject = `Новое приглашение от «${p.companyName}»`;
  const answerUrl = `${getEnv().APP_URL}/invitations`;
  return {
    kind: 'invitation',
    to,
    subject,
    text: `Компания «${p.companyName}» приглашает вас ${what}.${salary}\n\nОтветить: ${answerUrl}\nКонтакты компания увидит, только если вы примете приглашение.${sign()}`,
    html: html({
      subject,
      preheader: `Зарплата: ${range} в месяц. Ответьте в кабинете.`,
      kicker: 'Приглашение',
      title: `Вас приглашает «${p.companyName}»`,
      // Компания и позиция — в заголовке и в таблице; абзац говорит, что делать, а не повторяет их.
      lead: [`На ФСП Карьере вам пришло приглашение${p.vacancyTitle ? '' : ' к разговору о работе'}. Посмотрите условия и ответьте в кабинете.`],
      facts: [
        { label: 'Компания', value: p.companyName },
        ...(p.vacancyTitle ? [{ label: 'Позиция', value: p.vacancyTitle }] : []),
        { label: 'Зарплата', value: `${range} в месяц` },
      ],
      action: { label: 'Ответить на приглашение', href: answerUrl },
      notes: ['Контакты компания увидит, только если вы примете приглашение.'],
      accent: 'candidate',
    }),
  };
}

/** lane invite-cancel: компания отозвала приглашение — кандидату, с причиной. */
export function invitationWithdrawnMail(to: string, p: { companyName: string; vacancyTitle: string | null; reason: string }): MailMessage {
  const what = p.vacancyTitle ? ` на позицию «${p.vacancyTitle}»` : '';
  const subject = `«${p.companyName}» отозвала приглашение`;
  const url = `${getEnv().APP_URL}/invitations`;
  return {
    kind: 'invitation_withdrawn',
    to,
    subject,
    text: `Компания «${p.companyName}» отозвала приглашение${what}.\nПричина: ${p.reason}\n\nКомпания больше не получает ваши контакты и данные по этому приглашению. Подробности: ${url}${sign()}`,
    html: html({
      subject,
      preheader: `Причина: ${p.reason.slice(0, 80)}`,
      kicker: 'Приглашение',
      title: subject,
      lead: [`Компания «${p.companyName}» отозвала приглашение${what}.`],
      facts: [{ label: 'Причина', value: p.reason }],
      action: { label: 'Открыть приглашения', href: url },
      notes: ['Компания больше не получает ваши контакты и данные по этому приглашению. То, что она уже получила, отозвать невозможно.'],
      accent: 'candidate',
    }),
  };
}

export function invitationAnswerMail(to: string, p: { accepted: boolean; vacancyTitle: string | null }): MailMessage {
  const what = p.vacancyTitle ? ` на «${p.vacancyTitle}»` : '';
  const subject = p.accepted ? 'Кандидат принял приглашение' : 'Кандидат отклонил приглашение';
  const cabinetUrl = `${getEnv().APP_URL}${p.accepted ? '/employer/invitations' : '/employer'}`;
  return {
    kind: p.accepted ? 'invitation_accepted' : 'invitation_declined',
    to,
    subject,
    text: p.accepted
      ? `Кандидат принял ваше приглашение${what}. Имя и почта кандидата открыты в кабинете: ${cabinetUrl}${sign()}`
      : `Кандидат отклонил ваше приглашение${what}. Подборка других кандидатов — в кабинете: ${cabinetUrl}${sign()}`,
    html: html({
      subject,
      preheader: p.accepted ? 'Имя и почта кандидата открыты в кабинете.' : 'Подборка других кандидатов - в кабинете.',
      kicker: 'Ответ на приглашение',
      title: subject,
      lead: [
        p.accepted
          ? `Кандидат принял ваше приглашение${what}. Имя и почта кандидата открыты в кабинете.`
          : `Кандидат отклонил ваше приглашение${what}. Подборка других кандидатов - в кабинете.`,
      ],
      action: { label: p.accepted ? 'Открыть контакты кандидата' : 'Посмотреть других кандидатов', href: cabinetUrl },
      accent: 'employer',
    }),
  };
}

/** lane live-slots (ADR 0008 п. 4): живая защита назначена — время по МСК и ссылка на комнату. */
export function liveDefenseMail(
  to: string,
  p: { audience: 'candidate' | 'employer'; startsAt: Date; durationMin: number; companyName: string; vacancyTitle: string | null; roomUrl: string },
): MailMessage {
  const when = formatMsk(p.startsAt);
  const subject = p.audience === 'candidate' ? `Живая защита с «${p.companyName}»: ${when}` : `Живая защита назначена: ${when}`;
  const lead =
    p.audience === 'candidate'
      ? `Вы выбрали время живой защиты проекта с компанией «${p.companyName}». Защита записывается; комната откроется за 10 минут до начала.`
      : `Кандидат выбрал время живой защиты${p.vacancyTitle ? ` по «${p.vacancyTitle}»` : ''}. Комната откроется за 10 минут до начала.`;
  return {
    kind: 'live_defense_scheduled',
    to,
    subject,
    text: `${lead}\nВремя: ${when}, ${p.durationMin} мин.\nКомната: ${p.roomUrl}\nОтменить можно не позднее чем за 1 час, с причиной.${sign()}`,
    html: html({
      subject,
      preheader: `${when}, ${p.durationMin} мин`,
      kicker: 'Живая защита',
      title: subject,
      lead: [lead],
      facts: [
        { label: 'Время', value: when },
        { label: 'Длительность', value: `${p.durationMin} мин` },
        ...(p.vacancyTitle ? [{ label: 'Позиция', value: p.vacancyTitle }] : []),
      ],
      action: { label: 'Открыть комнату', href: p.roomUrl },
      notes: ['Отменить можно не позднее чем за 1 час до начала, с причиной.'],
      accent: p.audience,
    }),
  };
}
