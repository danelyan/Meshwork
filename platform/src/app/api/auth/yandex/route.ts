import { NextResponse } from 'next/server';

import { safeNext } from '@/server/auth/redirect';
import { OAUTH_COOKIE, OAUTH_TTL_SEC, authorizeUrl, randomToken, signOAuthState, yandexConfig } from '@/server/auth/yandex';
import { getEnv } from '@/server/env';

export const dynamic = 'force-dynamic';

/**
 * Старт входа через Яндекс ID: state + PKCE verifier в короткоживущей подписанной
 * куке (10 мин, только для /api/auth/yandex), редирект на oauth.yandex.ru.
 * Не настроен → обратно на /auth с пояснением.
 */
export function GET(req: Request) {
  const env = getEnv();
  const cfg = yandexConfig();
  if (!cfg) return NextResponse.redirect(new URL('/auth?error=yandex_not_configured', env.APP_URL), 303);
  const next = safeNext(new URL(req.url).searchParams.get('next'));
  const state = randomToken(24);
  const verifier = randomToken(48); // 64 символа base64url — в пределах 43..128 (RFC 7636)
  const res = NextResponse.redirect(authorizeUrl(cfg, state, verifier), 303);
  res.cookies.set({
    name: OAUTH_COOKIE,
    value: signOAuthState({ state, verifier, next, exp: Math.floor(Date.now() / 1000) + OAUTH_TTL_SEC }),
    httpOnly: true,
    // Lax: кука уходит на верхнеуровневый GET-возврат с oauth.yandex.ru.
    sameSite: 'lax',
    secure: env.APP_URL.startsWith('https://'),
    path: '/api/auth/yandex',
    maxAge: OAUTH_TTL_SEC,
  });
  return res;
}
