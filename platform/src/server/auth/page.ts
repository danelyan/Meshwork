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

/**
 * Куда отправить с страницы кандидата; null — пускать. Чистая функция (тесты без Next).
 * Нет сессии → /auth?next=…; роль не выбрана → /onboarding; работодатель → /employer.
 * Кандидат с незавершённым онбордингом («Настроить позже») пускается — ему плашка OnboardingBanner.
 * Старая кука демо-кандидата без аккаунта (userId = null) — кандидат, как и в API (requireCandidate).
 */
export function candidatePageRedirect(s: SessionPrincipal | null, next: string): string | null {
  if (!s) return `/auth?next=${encodeURIComponent(next)}`;
  if (s.candidateId) return null;
  if (s.employerProfileId) return '/employer';
  return '/onboarding';
}

/**
 * Guard страниц кандидата — вызывать в каждой page.tsx группы (candidate), не в layout:
 * layout не перерисовывается при клиентской навигации между дочерними страницами
 * (docs Next.js: Authentication → Layouts and auth checks).
 */
export async function requirePageCandidate(next: string): Promise<SessionPrincipal & { candidateId: string }> {
  const s = await getPageSession();
  const to = candidatePageRedirect(s, next);
  if (to) redirect(to);
  return s as SessionPrincipal & { candidateId: string };
}

/** Guard кабинета работодателя: нет входа → /auth, роль не выбрана → /onboarding, кандидат → /consultant. */
export async function requirePageEmployer(next: string): Promise<SessionPrincipal & { userId: string; employerProfileId: string }> {
  const s = await getPageSession();
  if (!s) return toAuth(next);
  if (s.userId && s.role === 'pending') redirect('/onboarding');
  if (!s.userId || !s.employerProfileId) redirect('/consultant');
  return s as SessionPrincipal & { userId: string; employerProfileId: string };
}
