import { NextResponse } from 'next/server';

import { CONSENT_VERSION, ensureConsent } from '@/server/auth/consent';
import { safeNext } from '@/server/auth/redirect';
import { homePathFor, needsOnboarding, sessionInputFor, upsertExternalUser } from '@/server/auth/users';
import {
  OAUTH_COOKIE,
  YandexAuthError,
  exchangeCode,
  fetchProfile,
  stateMatches,
  verifyOAuthState,
  yandexConfig,
} from '@/server/auth/yandex';
import { getEnv } from '@/server/env';
import { readCookie, userSessionCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * Возврат с oauth.yandex.ru: проверка state (из подписанной куки), обмен кода
 * с PKCE verifier, профиль, upsert аккаунта, новая кука сессии (ротация),
 * редирект: незавершённый онбординг → лента знакомства /consultant, иначе next или кабинет роли.
 * Любая ошибка → /auth?error=<код>, без подробностей и без токенов в логах.
 */
export async function GET(req: Request) {
  const env = getEnv();
  const back = (error: string) => {
    const res = NextResponse.redirect(new URL(`/auth?error=${error}`, env.APP_URL), 303);
    res.cookies.set({ name: OAUTH_COOKIE, value: '', path: '/api/auth/yandex', maxAge: 0 });
    return res;
  };
  const cfg = yandexConfig();
  if (!cfg) return back('yandex_not_configured');

  const params = new URL(req.url).searchParams;
  if (params.get('error')) return back('yandex_denied');
  const saved = verifyOAuthState(readCookie(req, OAUTH_COOKIE));
  if (!saved || !stateMatches(saved.state, params.get('state'))) return back('state');
  const code = params.get('code');
  if (!code || code.length > 256) return back('exchange');

  // Текст согласия мог смениться между стартом и возвратом: проверяем до создания аккаунта,
  // иначе пользователь остался бы без Consent (тот же код, что на старте).
  if (saved.consent !== CONSENT_VERSION) return back('consent_required');

  let user;
  try {
    const token = await exchangeCode(cfg, code, saved.verifier);
    const profile = await fetchProfile(token);
    user = await upsertExternalUser(profile);
    // Галка согласия была на /auth (версия в подписанной куке state) — пишем так же, как раньше шаг чата.
    await ensureConsent(user.id, saved.consent);
  } catch (err) {
    if (err instanceof YandexAuthError) {
      console.warn(`[auth] yandex ${err.stage} failed: ${err.message}`);
      return back(err.stage);
    }
    console.error('[auth] yandex callback failed', err instanceof Error ? err.name : 'unknown');
    return back('internal');
  }

  const home = homePathFor(user);
  const target = needsOnboarding(user) ? home : (safeNext(saved.next) ?? home);
  const res = NextResponse.redirect(new URL(target, env.APP_URL), 303);
  res.cookies.set(userSessionCookie(sessionInputFor(user)));
  res.cookies.set({ name: OAUTH_COOKIE, value: '', path: '/api/auth/yandex', maxAge: 0 });
  return res;
}
