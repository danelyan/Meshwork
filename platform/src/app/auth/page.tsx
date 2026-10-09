import type { Metadata } from 'next';

import { AuthScreen } from '@/components/AuthScreen';
import { safeNext } from '@/server/auth/redirect';
import { yandexConfig } from '@/server/auth/yandex';
import { getEnv } from '@/server/env';

export const metadata: Metadata = { title: 'Вход - ФСП Карьера' };
export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** Страница входа (контракт для лендинга: «Приступим» → /auth). */
export default async function AuthPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const error = one(sp.error);
  return (
    <main id="main">
      <AuthScreen
        yandexEnabled={yandexConfig() !== null}
        demoEnabled={getEnv().DEMO_LOGIN}
        next={safeNext(one(sp.next))}
        error={error && /^[a-z_]{1,32}$/.test(error) ? error : null}
      />
    </main>
  );
}
