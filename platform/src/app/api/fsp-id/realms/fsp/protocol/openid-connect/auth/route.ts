import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/server/auth/csrf';
import { fspDemoParticipant } from '@/server/collector/fsp-demo';
import { fspProviderMode } from '@/server/fsp-id/client';
import { renderErrorPage, renderLoginPage, LOGIN_PAGE_HEADERS } from '@/server/fsp-id/mock/login-page';
import { FSP_ID_REALM_PATH, issueCode, validateAuthorize, type AuthorizeResult } from '@/server/fsp-id/mock/provider';

export const dynamic = 'force-dynamic';

/**
 * Authorization endpoint мока ФСП ID (путь как у Keycloak). Работает, только пока внешний провайдер
 * не настроен (нет FSP_OIDC_ISSUER и секрета) — иначе 404. GET — страница выбора демо-участника,
 * POST — выбор: одноразовый код и редирект на зарегистрированный redirect_uri. Входа на платформу
 * не требует: это страница «чужого» провайдера, кандидата проверяет наш callback.
 */
const ACTION = `${FSP_ID_REALM_PATH}/protocol/openid-connect/auth`;
const MAX_FORM_BYTES = 8 * 1024;

const html = (body: string, status = 200) => new NextResponse(body, { status, headers: LOGIN_PAGE_HEADERS });

function back(redirectUri: string, params: Record<string, string>) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return NextResponse.redirect(u, 303);
}

function rejected(r: Extract<AuthorizeResult, { ok: false }>) {
  return r.fatal ? html(renderErrorPage(r.message), 400) : back(r.redirectUri, { error: r.error, state: r.state });
}

export function GET(req: Request) {
  if (fspProviderMode() !== 'mock') return new NextResponse(null, { status: 404 });
  const r = validateAuthorize(new URL(req.url).searchParams);
  if (!r.ok) return rejected(r);
  return html(renderLoginPage(r.req, ACTION));
}

export async function POST(req: Request) {
  if (fspProviderMode() !== 'mock') return new NextResponse(null, { status: 404 });
  try {
    assertSameOrigin(req);
  } catch {
    return html(renderErrorPage('Запрос с чужого сайта'), 403);
  }
  const text = await req.text();
  if (text.length > MAX_FORM_BYTES) return html(renderErrorPage('Слишком большой запрос'), 413);
  const form = new URLSearchParams(text);
  const r = validateAuthorize(form);
  if (!r.ok) return rejected(r);
  if (form.get('cancel')) return back(r.req.redirectUri, { error: 'access_denied', state: r.req.state });
  const participant = fspDemoParticipant(form.get('participant') ?? '');
  if (!participant) return html(renderErrorPage('Неизвестный демо-участник'), 400);
  return back(r.req.redirectUri, { code: issueCode(r.req, participant), state: r.req.state });
}
