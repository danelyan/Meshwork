import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/server/db';
import { getEnv } from '@/server/env';
import { AppError, errors } from '@/server/errors';
import { type MailMessage, sendMail } from '@/server/mail';
import { alreadyRegisteredMail, resetCodeMail, verifyCodeMail } from '@/server/mail/templates';

import { CODE_MAX_ATTEMPTS, type CodeCheck, consumeCode, issueCode } from './codes';
import { assertConsentVersion, ensureConsent } from './consent';
import { PASSWORD_MAX, PASSWORD_MIN, dummyPasswordHash, hashPassword, verifyPassword } from './password';
import { RATE, hit } from './rate-limit';
import { loadUser } from './users';

/**
 * Вход по почте и паролю (R-D-04, ADR 0001 «Дополнение 10.10»). Почта — внешний ключ
 * `AuthAccount(provider = "email", providerAccountId = почта в нижнем регистре)`: уникальна
 * среди email-аккаунтов, а Яндекс-аккаунты с той же почтой остаются отдельными (по почте
 * аккаунты не склеиваем, п. 6 ADR).
 */
export const EMAIL_PROVIDER = 'email';

export const EmailSchema = z.string().trim().max(254).pipe(z.email('Некорректная почта')).transform((v) => v.toLowerCase());
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `Пароль — не короче ${PASSWORD_MIN} символов`)
  .max(PASSWORD_MAX, `Пароль — не длиннее ${PASSWORD_MAX} символов`);
export const CodeSchema = z.string().trim().regex(/^\d{6}$/, 'Код — 6 цифр');

/** Ответ на отправку кода. `demoCode` — только при DEMO_LOGIN: жюри проходит регистрацию без доступа к ящику. */
export interface CodeSent {
  sent: true;
  demoCode?: string;
}

const accountKey = (email: string) => ({ provider_providerAccountId: { provider: EMAIL_PROVIDER, providerAccountId: email } });

async function findEmailUser(email: string) {
  const acc = await prisma.authAccount.findUnique({ where: accountKey(email), select: { userId: true } });
  if (!acc) return null;
  return prisma.user.findUnique({
    where: { id: acc.userId },
    select: { id: true, email: true, passwordHash: true, emailVerifiedAt: true },
  });
}

function limitOrThrow(key: string, rule: (typeof RATE)[keyof typeof RATE]) {
  if (!hit(key, rule)) throw errors.rateLimited('Слишком много попыток. Подождите несколько минут.');
}

/** Отправка кода: ошибка SMTP на демо-стенде не мешает (код на экране), иначе — 503. */
async function deliverCode(mail: MailMessage, code: string): Promise<CodeSent> {
  const demo = getEnv().DEMO_LOGIN;
  try {
    await sendMail(mail);
  } catch (err) {
    console.warn(`[auth] письмо ${mail.kind} не отправлено: ${err instanceof Error ? err.message : 'unknown'}`);
    if (!demo) throw new AppError('mail_unavailable', 'Не удалось отправить письмо. Попробуйте позже.', 503);
  }
  return demo ? { sent: true, demoCode: code } : { sent: true };
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  consent: string;
}

/**
 * Регистрация: аккаунт (роль pending), согласие на ПДн, хэш пароля, код подтверждения в письме.
 * Почта уже подтверждена у другого — ответ тот же (не раскрываем, что аккаунт есть), владельцу
 * ящика уходит письмо «аккаунт уже есть». Неподтверждённую регистрацию можно повторить:
 * пароль перезаписывается, старый код гаснет — иначе кто угодно занял бы чужую почту навсегда.
 */
export async function registerWithEmail(input: RegisterInput): Promise<CodeSent> {
  const version = assertConsentVersion(input.consent);
  limitOrThrow(`send:${input.email}`, RATE.sendPerEmail);
  const existing = await findEmailUser(input.email);
  if (existing?.emailVerifiedAt) {
    await sendMail(alreadyRegisteredMail(input.email)).catch((err: unknown) => {
      console.warn(`[auth] письмо already_registered не отправлено: ${err instanceof Error ? err.message : 'unknown'}`);
    });
    return { sent: true };
  }
  const passwordHash = await hashPassword(input.password);
  const name = input.name?.trim() || input.email.split('@')[0]!.slice(0, 120);
  let userId: string;
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, name } });
    userId = existing.id;
    await ensureConsent(userId, version);
  } else {
    try {
      const user = await prisma.user.create({
        data: {
          name,
          email: input.email,
          passwordHash,
          accounts: { create: { provider: EMAIL_PROVIDER, providerAccountId: input.email } },
          consents: { create: { version } },
        },
        select: { id: true },
      });
      userId = user.id;
    } catch (err) {
      // Две регистрации одной почты одновременно: вторая получает тот же ответ, код — у первой.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { sent: true };
      throw err;
    }
  }
  const code = await issueCode(userId, 'verify');
  return deliverCode(verifyCodeMail(input.email, code), code);
}

const CODE_ERRORS: Record<Exclude<CodeCheck, 'ok'>, string> = {
  invalid: 'Неверный код',
  expired: 'Код устарел. Запросите новый.',
  exhausted: `Код сгорел после ${CODE_MAX_ATTEMPTS} неверных попыток. Запросите новый.`,
};

function codeError(check: Exclude<CodeCheck, 'ok'>): AppError {
  return new AppError(check === 'invalid' ? 'invalid_code' : `code_${check}`, CODE_ERRORS[check], 400);
}

/** Подтвердить почту кодом: ставит emailVerifiedAt, возвращает аккаунт для сессии. */
export async function verifyEmail(email: string, code: string) {
  limitOrThrow(`code:${email}`, RATE.codePerEmail);
  const user = await findEmailUser(email);
  // Нет аккаунта — тот же ответ, что на неверный код.
  if (!user) throw codeError('invalid');
  const check = await consumeCode(user.id, 'verify', code);
  if (check !== 'ok') throw codeError(check);
  if (!user.emailVerifiedAt) await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  return (await loadUser(user.id))!;
}

/** Повторно выслать код подтверждения (только неподтверждённой почте; ответ одинаковый). */
export async function resendVerifyCode(email: string): Promise<CodeSent> {
  limitOrThrow(`send:${email}`, RATE.sendPerEmail);
  const user = await findEmailUser(email);
  if (!user || user.emailVerifiedAt) return { sent: true };
  const code = await issueCode(user.id, 'verify');
  return deliverCode(verifyCodeMail(email, code), code);
}

export class EmailNotVerifiedError extends AppError {
  constructor(readonly sent: CodeSent) {
    super('email_not_verified', 'Почта не подтверждена. Мы отправили новый код.', 403, sent.demoCode ? { demoCode: sent.demoCode } : undefined);
  }
}

/**
 * Вход по паролю. Неверная почта и неверный пароль — одинаковый ответ 401 и одинаковое
 * время (scrypt против хэша-пустышки). Пароль верный, почта не подтверждена — 403 и новый код.
 */
export async function loginWithEmail(email: string, password: string) {
  limitOrThrow(`login:${email}`, RATE.loginPerEmail);
  const user = await findEmailUser(email);
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyPasswordHash()));
  if (!user || !user.passwordHash || !ok) throw new AppError('invalid_credentials', 'Неверная почта или пароль', 401);
  if (!user.emailVerifiedAt) {
    const sent = await resendVerifyCode(email).catch((err: unknown) => {
      if (err instanceof AppError && err.code === 'rate_limited') return { sent: true } as CodeSent;
      throw err;
    });
    throw new EmailNotVerifiedError(sent);
  }
  return (await loadUser(user.id))!;
}

/**
 * «Забыли пароль»: код сброса на почту, если email-аккаунт есть. Ответ всегда одинаковый.
 * Код сброса на экран не выводится даже на демо-стенде: иначе любой сменил бы чужой пароль.
 */
export async function requestPasswordReset(email: string): Promise<{ sent: true }> {
  if (!hit(`send:${email}`, RATE.sendPerEmail)) return { sent: true };
  const user = await findEmailUser(email);
  if (!user) return { sent: true };
  const code = await issueCode(user.id, 'reset');
  await sendMail(resetCodeMail(email, code)).catch((err: unknown) => {
    console.warn(`[auth] письмо reset не отправлено: ${err instanceof Error ? err.message : 'unknown'}`);
  });
  return { sent: true };
}

/**
 * Новый пароль по коду сброса. Код из письма доказывает владение ящиком — почта считается
 * подтверждённой. Неиспользованные коды подтверждения гасятся.
 */
export async function resetPassword(email: string, code: string, password: string) {
  limitOrThrow(`code:${email}`, RATE.codePerEmail);
  const user = await findEmailUser(email);
  if (!user) throw codeError('invalid');
  const check = await consumeCode(user.id, 'reset', code);
  if (check !== 'ok') throw codeError(check);
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() } }),
    prisma.authCode.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } }),
  ]);
  return (await loadUser(user.id))!;
}
