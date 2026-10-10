import type { Metadata } from 'next';

import { Button, Field, Panel } from '@/components/ui';
import ui from '@/components/ui.module.css';
import { safeNext } from '@/server/auth/redirect';

import { enterSite } from './actions';
import styles from './site-access.module.css';

export const metadata: Metadata = { title: 'Доступ к стенду - ФСП Карьера' };
export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** Ввод пароля стенда (SITE_PASSWORD). Сюда ведёт middleware с публичного адреса без куки доступа. */
export default async function SiteAccessPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const next = safeNext(one(sp.next)) ?? '/';
  return (
    <main className={styles.page}>
      <form action={enterSite} className={styles.form}>
        <Panel variant="strong" className={styles.card}>
          <h1 className={styles.title}>Стенд закрыт паролем</h1>
          <input type="hidden" name="next" value={next} />
          <Field label="Пароль" error={one(sp.error) ? 'Неверный пароль' : undefined}>
            <input className={ui.input} type="password" name="password" autoComplete="current-password" required autoFocus />
          </Field>
          <Button type="submit" variant="cta">
            Войти
          </Button>
        </Panel>
      </form>
    </main>
  );
}
