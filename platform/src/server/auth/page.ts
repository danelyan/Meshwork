import 'server-only';

import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { type PageLevel, authRedirect, foreignPageRedirect, pageLevelFor } from '@/server/auth/access';
import { sessionExists } from '@/server/auth/stale';
import { SESSION_COOKIE, type SessionPrincipal, parseSession } from '@/server/session';

/** Сессия в Server Component (docs Next.js 15: `cookies()` асинхронная). */
const checkSession = cache(async (value: string | undefined): Promise<{ session: SessionPrincipal | null; stale: boolean }> => {
  const p = parseSession(value);
  if (!p) return { session: null, stale: false };
  // Одна выборка по id на запрос (React cache). Нет субъекта в БД — гость.
  return (await sessionExists(p)) ? { session: p, stale: false } : { session: null, stale: true };
});

/** Сессия страницы: подпись и срок + существование аккаунта в БД; протухшая кука = гость (`stale`). */
export async function getCheckedPageSession() {
  return checkSession((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Сессия в Server Component (docs Next.js 15: `cookies()` асинхронная). Протухшая кука → null. */
export async function getPageSession(): Promise<SessionPrincipal | null> {
  return (await getCheckedPageSession()).session;
}

/**
 * Гость → /auth?next=…. Протухшая кука (в Server Component куки менять нельзя) → через route handler
 * /api/auth/stale, который удаляет куку и ведёт на /auth.
 */
async function guestRedirect(next: string, stale: boolean): Promise<never> {
  return redirect(authRedirect(next, stale));
}

/**
 * Нужен аккаунт (любая роль, не старая демо-кука). Иначе → /auth?next=…. Вне таблицы `PAGE_ACCESS`:
 * для `page.tsx` не использовать (тест вызова гвардов его не принимает) — там `requirePageAccess` и обёртки.
 */
export async function requirePageUser(next: string): Promise<SessionPrincipal & { userId: string }> {
  const { session: s, stale } = await getCheckedPageSession();
  if (!s?.userId) return guestRedirect(next, stale);
  return s as SessionPrincipal & { userId: string };
}

/**
 * Единый гвард страниц: правило берётся из `PAGE_ACCESS` по пути (`foreignPageRedirect`), решает активная
 * роль. Вызывать в каждой `page.tsx`, не в layout: layout не перерисовывается при клиентской навигации
 * между дочерними страницами (docs Next.js: Authentication → Layouts and auth checks). `path` — адрес
 * страницы с query: он же уходит в `next` после входа. Возвращает сессию (null — только на public-странице).
 */
export async function requirePageAccess(path: string): Promise<SessionPrincipal | null> {
  const { session, stale } = await getCheckedPageSession();
  const to = foreignPageRedirect(session, path, { stale });
  if (to) redirect(to);
  return session;
}

/**
 * Типизированный гвард уровня. Нет записи для пути (например, id с `/` дал адрес глубже таблицы) — 404:
 * закрыто, но не 500. Запись есть, а уровень не тот — ошибка разработчика (не тот гвард): вне production
 * исключение, в production 404; статический тест ловит то же до запуска.
 */
async function requirePageLevel(level: Exclude<PageLevel, 'public'>, path: string): Promise<SessionPrincipal> {
  const actual = pageLevelFor(path);
  if (actual === null) notFound();
  if (actual !== level) {
    if (process.env.NODE_ENV !== 'production') throw new Error(`Гвард уровня ${level} на странице ${path}: в PAGE_ACCESS — ${actual}`);
    notFound();
  }
  return (await requirePageAccess(path)) as SessionPrincipal;
}

/** Страница кандидата: гость → /auth, pending → /consultant, работодатель → /employer/company. */
export async function requirePageCandidate(next: string): Promise<SessionPrincipal & { candidateId: string }> {
  return (await requirePageLevel('candidate', next)) as SessionPrincipal & { candidateId: string };
}

/**
 * /consultant — общий адрес ленты (решение владельца 10.10): знакомство (согласие, роль, шаги) для любой
 * роли и дом обеих ролей. Пускает любой вход; что показать роли — решает страница.
 */
export async function requirePageAccount(next: string): Promise<SessionPrincipal> {
  return requirePageLevel('account', next);
}

/** Кабинет работодателя: гость → /auth, pending и кандидат → /consultant. */
export async function requirePageEmployer(next: string): Promise<SessionPrincipal & { userId: string; employerProfileId: string }> {
  return (await requirePageLevel('employer', next)) as SessionPrincipal & { userId: string; employerProfileId: string };
}
