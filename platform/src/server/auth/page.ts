import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { SESSION_COOKIE, type SessionPrincipal, parseSession } from '@/server/session';

/** Сессия в Server Component (docs Next.js 15: `cookies()` асинхронная). */
export async function getPageSession(): Promise<SessionPrincipal | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return parseSession(value);
}

const toAuth = (next: string): never => redirect(`/auth?next=${encodeURIComponent(next)}`);

/** Guard страницы: нужен аккаунт (любая роль). Иначе → /auth?next=… */
export async function requirePageUser(next: string): Promise<SessionPrincipal & { userId: string }> {
  const s = await getPageSession();
  if (!s?.userId) return toAuth(next);
  return s as SessionPrincipal & { userId: string };
}

/** Guard кабинета работодателя: нет входа → /auth, роль не выбрана → /onboarding, кандидат → /consultant. */
export async function requirePageEmployer(next: string): Promise<SessionPrincipal & { userId: string; employerProfileId: string }> {
  const s = await getPageSession();
  if (!s) return toAuth(next);
  if (s.userId && s.role === 'pending') redirect('/onboarding');
  if (!s.userId || !s.employerProfileId) redirect('/consultant');
  return s as SessionPrincipal & { userId: string; employerProfileId: string };
}
