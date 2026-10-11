import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getEnv } from '@/server/env';
import { SITE_ACCESS_COOKIE, SITE_ACCESS_PATH, siteAccessDecision, siteAccessKey } from '@/server/site-access';

/** Пароль на публичный стенд (SITE_PASSWORD / SITE_PASSWORD_SHA256, src/server/site-access.ts). Не задан — пропускает всё. */
export function middleware(req: NextRequest) {
  const env = getEnv();
  const decision = siteAccessDecision({
    key: siteAccessKey(env),
    secret: env.SESSION_SECRET,
    host: req.headers.get('host'),
    pathname: req.nextUrl.pathname,
    cookie: req.cookies.get(SITE_ACCESS_COOKIE)?.value,
  });
  if (decision === 'allow') return NextResponse.next();
  if (decision === 'deny') {
    return NextResponse.json({ error: { code: 'site_locked', message: 'Стенд закрыт паролем' } }, { status: 401 });
  }
  // От APP_URL, как остальные редиректы: за Caddy адрес запроса внутри контейнера — 0.0.0.0:3000.
  const url = new URL(SITE_ACCESS_PATH, env.APP_URL);
  url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Node.js-рантайм (Next 15.5): node:crypto и окружение контейнера во время запроса.
  runtime: 'nodejs',
  // Статика сборки и файлы public/ — без проверки: страница пароля должна загрузить стили и шрифты.
  // design/ — только файлы public/design/<каталог>/<файл>: страницы /design/<имя> (src/app/design) идут через проверку.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/|audio/|avatar/|design/[^/]+/[^/]|landing/|models/).*)'],
};
