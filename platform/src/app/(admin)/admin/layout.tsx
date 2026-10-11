import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { AdminNav } from '@/components/admin/AdminNav';
import { AdminLogout } from '@/components/admin/AdminLogout';
import { navFor } from '@/lib/admin-nav';
import { STAFF_ROLE_LABEL } from '@/server/admin/permissions';
import { getStaffPageSession } from '@/server/admin/session';

import styles from './admin.module.css';

export const metadata: Metadata = { title: 'ФСП Карьера - админка', robots: { index: false, follow: false } };

/**
 * Раскладка админки (E-08): меню из реестра `lib/admin-nav.ts` по правам роли. Доступ здесь не проверяется —
 * гвард `requirePageStaff` в каждой странице (layout не перерисовывается при клиентской навигации).
 * Без сессии персонала (страница входа) — только содержимое.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const staff = await getStaffPageSession();
  if (!staff) return <div className={styles.center}>{children}</div>;
  return (
    <div className={styles.shell}>
      <aside className={styles.side}>
        <div className={styles.brand}>ФСП Карьера · админка</div>
        <AdminNav groups={navFor(staff.role)} />
        <div className={styles.who}>
          <span>{staff.name}</span>
          <span className={styles.mono}>{STAFF_ROLE_LABEL[staff.role]}</span>
          <Link href="/admin/password" className={styles.link}>Сменить пароль</Link>
          <AdminLogout />
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
