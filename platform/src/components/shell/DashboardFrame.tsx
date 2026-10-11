'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { HeaderAccount } from '@/server/auth/role-plan';
import { LogoutButton } from './LogoutButton';
import { CandidateSidebarSummary } from '@/components/candidate/CandidateSidebarSummary';
import { EmployerConsultantDock } from '@/components/employer/EmployerConsultantDock';
import styles from './DashboardFrame.module.css';

const candidate = [
  ['/career', '◇', 'Моя карта'], ['/profile', '○', 'Профиль'],
  ['/skills', '△', 'Навыки и грейд'], ['/interview', '▷', 'ИИнтервью'], ['/projects', '▤', 'Проекты'],
  ['/invitations', '✉', 'Приглашения'], ['/saved', '☆', 'Избранное'],
  ['/test', '▷', 'Тест на грейд'],
  ['/consultant', '◆', 'Консультант'], ['/settings', '⚙', 'Настройки'],
] as const;
const employer = [
  ['/employer', '◇', 'Подборка'], ['/employer/search', '⌕', 'Поиск по базе'],
  ['/employer/saved', '☆', 'Избранное'], ['/employer/vacancies', '▤', 'Вакансии'], ['/employer/invitations', '✉', 'Приглашения'],
  ['/employer/calls', '▷', 'Собеседования'], ['/consultant', '◆', 'ИИ-помощник'],
  ['/employer/company', '○', 'Компания'],
] as const;

export function dashboardPath(pathname: string): boolean {
  return pathname === '/test' || pathname.startsWith('/test/') || candidate.some(([href]) => href !== '/consultant' && (pathname === href || pathname.startsWith(`${href}/`))) || pathname === '/employer' || pathname.startsWith('/employer/');
}

/**
 * Only the navigation is client-side; each destination retains its own server access guard.
 * `bare` прячет боковую панель, но не меняет дерево вокруг `children`: иначе страница перемонтируется,
 * а TestPage, включающий bare после загрузки попытки, уходит в бесконечную перезагрузку.
 */
export function DashboardFrame({ account, children, employerSummary, bare = false }: { account?: HeaderAccount | null; children: ReactNode; employerSummary?: ReactNode; bare?: boolean }) {
  const pathname = usePathname();
  if (!account?.roles || !dashboardPath(pathname)) return children;
  const isEmployer = account.roles.role === 'employer';
  const links = isEmployer ? employer : candidate;
  return <div className={styles.frame} data-dashboard data-bare={bare || undefined}>
    {!bare && <aside className={styles.sidebar} aria-label="Ваш кабинет">
      <div className={styles.identity}>
        <span className={styles.monogram} data-employer={isEmployer || undefined} aria-hidden="true">{((isEmployer ? account.roles.companyName : account.userName)?.trim() || 'Ф').slice(0, 1).toUpperCase()}</span>
        <div><strong>{(isEmployer ? account.roles.companyName : account.userName) || 'Ваш кабинет'}</strong><small>{isEmployer ? 'Работодатель' : 'Кандидат'}</small></div>
      </div>
      {!isEmployer && <div className={styles.summary}><CandidateSidebarSummary /></div>}
      {isEmployer && <Link className={styles.create} href="/employer/needs/new">+ Новая вакансия</Link>}
      <nav className={styles.nav} aria-label="Разделы кабинета">
        {links.map(([href, icon, label]) => <Link key={href} href={href} aria-current={(pathname === href || (href !== '/employer' && pathname.startsWith(`${href}/`))) ? 'page' : undefined}>
          <span aria-hidden="true">{icon}</span>{label}
        </Link>)}
      </nav>
      <div className={styles.note}>
        {isEmployer && employerSummary}
        <p>{isEmployer ? 'Имя и контакт кандидата откроются после принятия приглашения.' : 'Контакты доступны компании только после вашего согласия на приглашение.'}</p>
        <LogoutButton className={styles.logout} />
      </div>
    </aside>}
    <div className={styles.content}>{children}</div>
    {isEmployer && !bare && <EmployerConsultantDock />}
  </div>;
}
