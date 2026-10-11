import { NextResponse } from 'next/server';

import { isBlockedNow } from '@/server/admin/accounts/state';
import { homePathFor } from '@/server/auth/access';
import { CONSENT_VERSION, ensureConsent } from '@/server/auth/consent';
import { safeNext } from '@/server/auth/redirect';
import { chooseRole, needsOnboarding, sessionInputFor, upsertExternalUser } from '@/server/auth/users';
import { getEnv } from '@/server/env';
import { completeFlow, endProviderSession, FSP_OAUTH_COOKIE, FSP_OAUTH_COOKIE_PATH, FSP_RETURN_PATH, FspCallbackFailed, fspIdentity, fspOidcConfig, fspProviderMode, fspTransport, verifyFlowState } from '@/server/fsp-id/client';
import { linkFspSubject } from '@/server/fsp-id/link';
import { registryFor } from '@/server/fsp-id/registry';
import { recordFspLink } from '@/server/onboarding/service';
import { getSession, readCookie, requireCandidate, userSessionCookie } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * Возврат от ФСП ID: проверка state, обмен кода с PKCE, проверка ID-токена (подпись RS256 по JWKS, iss,
 * aud, exp, nonce), достижения из реестра (симулятор по токену участника или демо-реестр мока).
 * Два режима из подписанной куки потока:
 *  - `link` — привязка к вошедшему кандидату (кандидат сессии = кандидат потока), итог — /settings или
 *    чат знакомства с `?fsp=<результат>`;
 *  - `login` — вход на платформу: аккаунт по `AuthAccount(fsp, <ФСП ID>)` (по почте не склеиваем), новый —
 *    сразу кандидат (ФСП ID есть только у спортсменов), согласие с галки /auth, привязка, кука сессии.
 * Токены и код в URL и логи не попадают, кука потока стирается.
 */
export async function GET(req: Request) {
  const env = getEnv();
  const saved = verifyFlowState(readCookie(req, FSP_OAUTH_COOKIE));
  const login = saved?.mode === 'login';
  const clear = (res: NextResponse) => {
    res.cookies.set({ name: FSP_OAUTH_COOKIE, value: '', path: FSP_OAUTH_COOKIE_PATH, maxAge: 0 });
    return res;
  };
  const redirect = (path: string) => clear(NextResponse.redirect(new URL(path, env.APP_URL), 303));
  const back = FSP_RETURN_PATH[saved?.ret ?? 'settings'];
  const done = (result: string) => (login ? redirect(result.startsWith('error_') ? `/auth?error=fsp_${result.slice(6)}` : '/consultant') : redirect(`${back}?fsp=${result}`));

  let candidateId: string | null = null;
  if (!login) {
    try {
      candidateId = requireCandidate(req);
    } catch {
      return redirect('/auth?next=/settings');
    }
  }
  if (login && saved?.consent !== CONSENT_VERSION) return redirect('/auth?error=consent_required');

  try {
    const transport = fspTransport();
    const { claims, accessToken, refreshToken } = await completeFlow(transport, new URL(req.url).searchParams, saved, candidateId);
    const who = fspIdentity(claims);
    const registry = await registryFor(who.fspId, { apiUrl: fspOidcConfig()?.apiUrl ?? null, accessToken });
    // Личность и достижения получены — сессия у провайдера больше не нужна (иначе следующий вход будет тем же участником).
    await endProviderSession(transport, refreshToken);

    if (!login) {
      const view = await linkFspSubject(candidateId!, who, registry, fspProviderMode());
      // Из шага знакомства: ответ шага ФСП и следующий вопрос в чате. Сбой здесь привязку не отменяет.
      const userId = getSession(req)?.userId;
      if (saved?.ret === 'consultant' && userId) await recordFspLink(userId).catch((e: unknown) => console.warn('[fsp-id] onboarding step not recorded', e instanceof Error ? e.message : 'unknown'));
      return done(view.state);
    }

    let user = await upsertExternalUser({ provider: 'fsp', providerAccountId: who.fspId, name: who.name ?? 'Участник ФСП', email: null });
    // E-08 фаза 3: заблокированный аккаунт не входит и не привязывает достижения.
    if (isBlockedNow(user)) return redirect('/auth?error=account_blocked');
    await ensureConsent(user.id, saved!.consent);
    if (user.role === 'pending') user = await chooseRole(user.id, { role: 'candidate' });
    if (user.candidateId) {
      await linkFspSubject(user.candidateId, who, registry, fspProviderMode());
      await recordFspLink(user.id).catch((e: unknown) => console.warn('[fsp-id] onboarding step not recorded', e instanceof Error ? e.message : 'unknown'));
    }
    const home = homePathFor(user.role);
    const target = needsOnboarding(user) ? home : (safeNext(saved!.next ?? null) ?? home);
    const res = redirect(target);
    res.cookies.set(userSessionCookie(sessionInputFor(user)));
    return res;
  } catch (err) {
    if (err instanceof FspCallbackFailed) {
      console.warn(`[fsp-id] callback failed: ${err.code}${err.detail ? ` ${err.detail}` : ''}`);
      return done(`error_${err.code}`);
    }
    console.error('[fsp-id] callback failed', err instanceof Error ? err.name : 'unknown');
    return done('error_internal');
  }
}
