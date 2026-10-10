import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

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
  return redirect(stale ? `/api/auth/stale?next=${encodeURIComponent(next)}` : `/auth?next=${encodeURIComponent(next)}`);
}

/** Guard страницы: нужен аккаунт (любая роль). Иначе → /auth?next=… */
export async function requirePageUser(next: string): Promise<SessionPrincipal & { userId: string }> {
  const { session: s, stale } = await getCheckedPageSession();
  if (!s?.userId) return guestRedirect(next, stale);
  return s as SessionPrincipal & { userId: string };
}

/**
 * Куда отправить с страницы кандидата; null — пускать. Чистая функция (тесты без Next).
 * Нет сессии → /auth?next=…; роль не выбрана → /consultant (знакомство идёт в его ленте); работодатель → /employer.
 * Кандидат с незавершённым онбордингом («Настроить позже») пускается — ему плашка OnboardingBanner.
 * Старая кука демо-кандидата без аккаунта (userId = null) — кандидат, как и в API (requireCandidate).
 */
export function candidatePageRedirect(s: SessionPrincipal | null, next: string): string | null {
  if (!s) return `/auth?next=${encodeURIComponent(next)}`;
  if (s.candidateId) return null;
  if (s.employerProfileId) return '/employer';
  return '/consultant';
}

/**
 * Guard страниц кандидата — вызывать в каждой page.tsx группы (candidate), не в layout:
 * layout не перерисовывается при клиентской навигации между дочерними страницами
 * (docs Next.js: Authentication → Layouts and auth checks).
 */
export async function requirePageCandidate(next: string): Promise<SessionPrincipal & { candidateId: string }> {
  const { session: s, stale } = await getCheckedPageSession();
  if (!s && stale) return guestRedirect(next, true);
  const to = candidatePageRedirect(s, next);
  if (to) redirect(to);
  return s as SessionPrincipal & { candidateId: string };
}

/**
 * Guard /consultant — общий адрес ленты (решение владельца 10.10): знакомство (согласие, роль, шаги)
 * для любой роли и консультант кандидата. Пускает любой вход; что показать роли — решает страница:
 * данные кандидата (разговор, демо-резюме) грузятся только при candidateId из подписанной куки.
 */
export async function requirePageAccount(next: string): Promise<SessionPrincipal> {
  const { session: s, stale } = await getCheckedPageSession();
  if (!s) return guestRedirect(next, stale);
  return s;
}

/** Guard кабинета работодателя: нет входа → /auth, роль не выбрана → /consultant (знакомство), кандидат → /consultant. */
export async function requirePageEmployer(next: string): Promise<SessionPrincipal & { userId: string; employerProfileId: string }> {
  const { session: s, stale } = await getCheckedPageSession();
  if (!s) return guestRedirect(next, stale);
  if (s.userId && s.role === 'pending') redirect('/consultant');
  if (!s.userId || !s.employerProfileId) redirect('/consultant');
  return s as SessionPrincipal & { userId: string; employerProfileId: string };
}
