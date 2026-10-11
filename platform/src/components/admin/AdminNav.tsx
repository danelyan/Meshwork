'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cx } from '@/components/ui';
import { type AdminNavGroup, isNavActive } from '@/lib/admin-nav';

import styles from '@/app/(admin)/admin/admin.module.css';

/** Боковое меню админки: группы уже отфильтрованы по правам роли на сервере (`navFor`). */
export function AdminNav({ groups }: { groups: AdminNavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Разделы админки">
      {groups.map((g) => (
        <div key={g.title} className={styles.group}>
          <p className={styles.groupTitle}>{g.title}</p>
          {g.items.map((i) => (
            <Link key={i.href} href={i.href} className={cx(styles.link, isNavActive(i.href, pathname) && styles.active)} aria-current={isNavActive(i.href, pathname) ? 'page' : undefined}>
              {i.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
