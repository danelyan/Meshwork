import { NextResponse } from 'next/server';

import { CONSENT_VERSION } from '@/server/auth/consent';
import { safeNext } from '@/server/auth/redirect';
import { getEnv } from '@/server/env';
import { buildAuthorizeUrl, FSP_OAUTH_COOKIE, FSP_OAUTH_COOKIE_PATH, FSP_OAUTH_TTL_SEC, fspTransport, newLoginFlow, signFlowState } from '@/server/fsp-id/client';

export const dynamic = 'force-dynamic';

/**
 * Старт входа на платформу через ФСП ID (кнопка на /auth рядом с Яндекс ID): согласие – галкой до входа,
 * как у Яндекса; state, nonce, PKCE verifier, согласие и next – в подписанной httpOnly-куке на 10 минут.
 * Провайдер – симулятор ФСП ID по env или встроенный мок. Возврат – /api/fsp-id/callback.
 */
export async function GET(req: Request) {
  const env = getEnv();
  const params = new URL(req.url).searchParams;
  const consent = params.get('consent');
  if (consent !== CONSENT_VERSION) return NextResponse.redirect(new URL('/auth?error=consent_required', env.APP_URL), 303);
  const flow = newLoginFlow(consent, safeNext(params.get('next')));
  let authorizeUrl: string;
  try {
    authorizeUrl = await buildAuthorizeUrl(fspTransport(), flow);
  } catch (err) {
    console.warn('[fsp-id] login: provider unavailable', err instanceof Error ? err.message : 'unknown');
    return NextResponse.redirect(new URL('/auth?error=fsp_unavailable', env.APP_URL), 303);
  }
  const res = NextResponse.redirect(authorizeUrl, 303);
  res.cookies.set({
    name: FSP_OAUTH_COOKIE,
    value: signFlowState(flow),
    httpOnly: true,
    sameSite: 'lax',
    secure: env.APP_URL.startsWith('https://'),
    path: FSP_OAUTH_COOKIE_PATH,
    maxAge: FSP_OAUTH_TTL_SEC,
  });
  return res;
}
