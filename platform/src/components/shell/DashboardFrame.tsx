'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { HeaderAccount } from '@/server/auth/role-plan';
import { NavIcon } from './NavIcon';
import { CANDIDATE_NAV, EMPLOYER_NAV, activeLinkHref, dashboardPath } from './nav';
import { CandidateSidebarSummary } from '@/components/candidate/CandidateSidebarSummary';
import { EmployerConsultantDock } from '@/components/employer/EmployerConsultantDock';
import styles from './DashboardFrame.module.css';

/**
 * Only the navigation is client-side; each destination retains its own server access guard.
 * `bare` прячет боковую панель, но не меняет дерево вокруг `children`: иначе страница перемонтируется,
 * а TestPage, включающий bare после загрузки попытки, уходит в бесконечную перезагрузку.
 */
export function DashboardFrame({ account, children, employerSummary, bare = false }: { account?: HeaderAccount | null; children: ReactNode; employerSummary?: ReactNode; bare?: boolean }) {
  const pathname = usePathname();
  if (!account?.roles || !dashboardPath(pathname)) return children;
  const isEmployer = account.roles.role === 'employer';
  const links = isEmployer ? EMPLOYER_NAV : CANDIDATE_NAV;
  const active = activeLinkHref(pathname, links);
  const consultant = pathname === '/consultant';
  return <div className={styles.frame} data-dashboard data-consultant={consultant || undefined} data-bare={bare || undefined}>
    {!bare && <aside className={styles.sidebar} aria-label="Ваш кабинет">
      <nav className={styles.nav} aria-label="Разделы кабинета">
        {links.map(({ href, icon, label }) => <Link key={href} href={href} aria-current={href === active ? 'page' : undefined}>
          <span aria-hidden="true"><NavIcon name={icon} /></span>{label}
        </Link>)}
      </nav>
      {isEmployer && <Link className={styles.create} href="/employer/needs/new">+ Новая вакансия</Link>}
      {!isEmployer && <details className={styles.summary}><summary>Мой профиль</summary><CandidateSidebarSummary /></details>}
      <div className={styles.note}>
        {isEmployer && employerSummary}
        <p>{isEmployer ? 'Имя и контакт кандидата откроются после принятия приглашения.' : 'Контакты доступны компании только после вашего согласия на приглашение.'}</p>
      </div>
    </aside>}
    <div className={styles.content}>{children}</div>
    {isEmployer && !bare && !consultant && <EmployerConsultantDock />}
  </div>;
}
