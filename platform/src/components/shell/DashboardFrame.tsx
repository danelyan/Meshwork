'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { HeaderAccount } from '@/server/auth/role-plan';
import { LogoutButton } from './LogoutButton';
import styles from './DashboardFrame.module.css';

const candidate = [
  ['/career', '◇', 'Моя карта'], ['/profile', '○', 'Профиль'],
  ['/test', '△', 'Навыки и грейд'], ['/projects', '▤', 'Проекты'],
  ['/invitations', '✉', 'Приглашения'], ['/saved', '☆', 'Избранное'],
  ['/consultant', '◆', 'Консультант'], ['/settings', '⚙', 'Настройки'],
] as const;
const employer = [
  ['/employer', '▤', 'Вакансии'], ['/employer/search', '◇', 'Поиск по базе'],
  ['/employer/saved', '☆', 'Избранное'], ['/employer/invitations', '✉', 'Приглашения'],
  ['/employer/calls', '▷', 'Собеседования'], ['/consultant', '◆', 'ИИ-помощник'],
  ['/employer/company', '○', 'Компания'],
] as const;

export function dashboardPath(pathname: string): boolean {
  return candidate.some(([href]) => href !== '/consultant' && (pathname === href || pathname.startsWith(`${href}/`))) || pathname === '/employer' || pathname.startsWith('/employer/');
}

/** Only the navigation is client-side; each destination retains its own server access guard. */
export function DashboardFrame({ account, children }: { account?: HeaderAccount | null; children: ReactNode }) {
  const pathname = usePathname();
  if (!account?.roles || !dashboardPath(pathname)) return children;
  const isEmployer = account.roles.role === 'employer';
  const links = isEmployer ? employer : candidate;
  return <div className={styles.frame} data-dashboard>
    <aside className={styles.sidebar} aria-label="Ваш кабинет">
      <div className={styles.identity}>
        <span className={styles.monogram} aria-hidden="true">{(account.userName.trim() || 'Ф').slice(0, 1).toUpperCase()}</span>
        <div><strong>{(isEmployer ? account.roles.companyName : account.userName) || 'Ваш кабинет'}</strong><small>{isEmployer ? 'Работодатель' : 'Кандидат'}</small></div>
      </div>
      {isEmployer && <Link className={styles.create} href="/employer/needs/new">+ Новая вакансия</Link>}
      <nav className={styles.nav} aria-label="Разделы кабинета">
        {links.map(([href, icon, label]) => <Link key={href} href={href} aria-current={(pathname === href || (href !== '/employer' && pathname.startsWith(`${href}/`))) ? 'page' : undefined}>
          <span aria-hidden="true">{icon}</span>{label}
        </Link>)}
      </nav>
      <div className={styles.note}>
        <p>{isEmployer ? 'Имя и контакт кандидата откроются после принятия приглашения.' : 'Контакты доступны компании только после вашего согласия на приглашение.'}</p>
        <LogoutButton className={styles.logout} />
      </div>
    </aside>
    <div className={styles.content}>{children}</div>
  </div>;
}
