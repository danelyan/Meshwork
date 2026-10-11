'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { HeaderAccount } from '@/server/auth/role-plan';
import { NavIcon } from './NavIcon';
import { CANDIDATE_NAV, EMPLOYER_NAV, activeLinkHref, dashboardPath } from './nav';
import { CandidateSidebarSummary } from '@/components/candidate/CandidateSidebarSummary';
import styles from './DashboardFrame.module.css';

/**
 * Only the navigation is client-side; each destination retains its own server access guard.
 * `bare` прячет боковую панель, но не меняет дерево вокруг `children`: иначе страница перемонтируется,
 * а TestPage, включающий bare после загрузки попытки, уходит в бесконечную перезагрузку.
 */
const COLLAPSE_KEY = 'fsp:sidebar-collapsed';

/** Свёрнутое боковое меню (только иконки) - запоминается в браузере. */
function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* приватный режим */
    }
  }, []);
  const toggle = useCallback(() => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1');
      } catch {
        /* приватный режим */
      }
      return !v;
    });
  }, []);
  return [collapsed, toggle];
}

export function DashboardFrame({ account, children, employerSummary, employerDock, bare = false }: { account?: HeaderAccount | null; children: ReactNode; employerSummary?: ReactNode; employerDock?: ReactNode; bare?: boolean }) {
  const pathname = usePathname();
  const [collapsed, toggle] = useCollapsed();
  if (!account?.roles || !dashboardPath(pathname)) return children;
  const isEmployer = account.roles.role === 'employer';
  const links = isEmployer ? EMPLOYER_NAV : CANDIDATE_NAV;
  const active = activeLinkHref(pathname, links);
  const consultant = pathname === '/consultant';
  return <div className={styles.frame} data-dashboard data-consultant={consultant || undefined} data-bare={bare || undefined} data-collapsed={collapsed || undefined}>
    {!bare && <aside className={styles.sidebar} aria-label="Ваш кабинет">
      <button type="button" className={styles.collapse} onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" aria-hidden="true">
          <path d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
        </svg>
      </button>
      <nav className={styles.nav} aria-label="Разделы кабинета">
        {links.map(({ href, icon, label }) => <Link key={href} href={href} aria-current={href === active ? 'page' : undefined} title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined}>
          <span aria-hidden="true"><NavIcon name={icon} /></span><em className={styles.label}>{label}</em>
        </Link>)}
      </nav>
      {isEmployer && <Link className={styles.create} href="/employer/needs/new" title="Новая вакансия" aria-label="Новая вакансия">+<em className={styles.label}> Новая вакансия</em></Link>}
      {!isEmployer && <details className={styles.summary}><summary>Мой профиль</summary><CandidateSidebarSummary /></details>}
      <div className={styles.note}>
        {isEmployer && employerSummary}
        <p>{isEmployer ? 'Имя и контакт кандидата откроются после принятия приглашения.' : 'Контакты доступны компании только после вашего согласия на приглашение.'}</p>
      </div>
    </aside>}
    <div className={styles.content}>{children}</div>
    {isEmployer && !bare && !consultant && employerDock}
  </div>;
}
