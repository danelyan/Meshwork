import { NextResponse } from 'next/server';

import { getEnv } from '@/server/env';
import { buildAuthorizeUrl, FSP_OAUTH_COOKIE, FSP_OAUTH_COOKIE_PATH, FSP_OAUTH_TTL_SEC, FSP_RETURN_PATH, fspTransport, newFlow, signFlowState } from '@/server/fsp-id/client';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * Старт привязки ФСП ID (кнопка в настройках кандидата): state, nonce и PKCE verifier – в подписанной
 * httpOnly-куке на 10 минут (только для /api/fsp-id), редирект на authorization endpoint провайдера.
 * Провайдер – внешний симулятор ФСП ID по env или встроенный мок. Провайдер не отвечает – на /settings с ошибкой.
 * Без сессии кандидата – на вход.
 */
export async function GET(req: Request) {
  const env = getEnv();
  let candidateId: string;
  try {
    candidateId = requireCandidate(req);
  } catch {
    return NextResponse.redirect(new URL('/auth?next=/settings', env.APP_URL), 303);
  }
  // `?return=consultant` – старт из шага знакомства: вернём в чат. Иначе – в настройки.
  const ret = new URL(req.url).searchParams.get('return') === 'consultant' ? 'consultant' : 'settings';
  const flow = newFlow(candidateId, undefined, ret);
  let authorizeUrl: string;
  try {
    authorizeUrl = await buildAuthorizeUrl(fspTransport(), flow);
  } catch (err) {
    console.warn('[fsp-id] link: provider unavailable', err instanceof Error ? err.message : 'unknown');
    return NextResponse.redirect(new URL(`${FSP_RETURN_PATH[ret]}?fsp=error_unavailable`, env.APP_URL), 303);
  }
  const res = NextResponse.redirect(authorizeUrl, 303);
  res.cookies.set({
    name: FSP_OAUTH_COOKIE,
    value: signFlowState(flow),
    httpOnly: true,
    // Lax: кука уходит на верхнеуровневый GET-возврат от провайдера (в проде – другой домен).
    sameSite: 'lax',
    secure: env.APP_URL.startsWith('https://'),
    path: FSP_OAUTH_COOKIE_PATH,
    maxAge: FSP_OAUTH_TTL_SEC,
  });
  return res;
}
