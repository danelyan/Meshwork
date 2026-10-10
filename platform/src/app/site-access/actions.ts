'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { safeNext } from '@/server/auth/redirect';
import { getEnv } from '@/server/env';
import {
  SITE_ACCESS_COOKIE,
  SITE_ACCESS_MAX_AGE,
  SITE_ACCESS_PATH,
  passwordMatches,
  siteAccessToken,
} from '@/server/site-access';

/** Проверка пароля стенда: верный — кука доступа и переход на next, неверный — та же страница с ошибкой. */
export async function enterSite(formData: FormData): Promise<void> {
  const env = getEnv();
  const next = safeNext(String(formData.get('next') ?? '')) ?? '/';
  const input = String(formData.get('password') ?? '').slice(0, 256);
  if (!env.SITE_PASSWORD) redirect(next);
  if (!passwordMatches(input, env.SITE_PASSWORD)) {
    redirect(`${SITE_ACCESS_PATH}?error=1&next=${encodeURIComponent(next)}`);
  }
  (await cookies()).set(SITE_ACCESS_COOKIE, siteAccessToken(env.SITE_PASSWORD), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.APP_URL.startsWith('https://'),
    path: '/',
    maxAge: SITE_ACCESS_MAX_AGE,
  });
  redirect(next);
}
