import { redirect } from 'next/navigation';

import { AdminLoginForm } from '@/components/admin/AdminLoginForm';
import { getStaffPageSession } from '@/server/admin/session';
import { getEnv } from '@/server/env';

/** Вход персонала: почта и пароль, затем TOTP (при первом входе – настройка приложения-аутентификатора). */
export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safe = next && next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin';
  if (await getStaffPageSession()) redirect(safe);
  return <AdminLoginForm next={safe} demo={getEnv().DEMO_LOGIN} />;
}
