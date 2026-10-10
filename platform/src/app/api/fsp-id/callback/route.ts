import { NextResponse } from 'next/server';

import { getEnv } from '@/server/env';
import { completeFlow, FSP_OAUTH_COOKIE, FSP_OAUTH_COOKIE_PATH, FspCallbackFailed, fspIdentity, fspOidcConfig, fspProviderMode, fspTransport, verifyFlowState } from '@/server/fsp-id/client';
import { linkFspSubject } from '@/server/fsp-id/link';
import { registryFor } from '@/server/fsp-id/registry';
import { readCookie, requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * Возврат от ФСП ID: проверка state, кандидата потока, обмен кода с PKCE, проверка ID-токена
 * (подпись RS256 по JWKS, iss, aud, exp, nonce), достижения из реестра (симулятор по токену участника или
 * демо-реестр мока), привязка участника к профилю. Итог — редирект на
 * /settings?fsp=<результат>; токены и код в URL и логи не попадают, кука потока стирается.
 */
export async function GET(req: Request) {
  const env = getEnv();
  const done = (result: string) => {
    const res = NextResponse.redirect(new URL(`/settings?fsp=${result}`, env.APP_URL), 303);
    res.cookies.set({ name: FSP_OAUTH_COOKIE, value: '', path: FSP_OAUTH_COOKIE_PATH, maxAge: 0 });
    return res;
  };
  let candidateId: string;
  try {
    candidateId = requireCandidate(req);
  } catch {
    return NextResponse.redirect(new URL('/auth?next=/settings', env.APP_URL), 303);
  }
  const params = new URL(req.url).searchParams;
  try {
    const { claims, accessToken } = await completeFlow(fspTransport(), params, verifyFlowState(readCookie(req, FSP_OAUTH_COOKIE)), candidateId);
    const who = fspIdentity(claims);
    const registry = await registryFor(who.fspId, { apiUrl: fspOidcConfig()?.apiUrl ?? null, accessToken });
    const view = await linkFspSubject(candidateId, who, registry, fspProviderMode());
    return done(view.state);
  } catch (err) {
    if (err instanceof FspCallbackFailed) {
      console.warn(`[fsp-id] callback failed: ${err.code}${err.detail ? ` ${err.detail}` : ''}`);
      return done(`error_${err.code}`);
    }
    console.error('[fsp-id] callback failed', err instanceof Error ? err.name : 'unknown');
    return done('error_internal');
  }
}
