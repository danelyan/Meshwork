'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { HeaderAccount } from '@/server/auth/role-plan';

import { HOME_ANCHORS, type NavLink } from './nav';
import { LogoutButton } from './LogoutButton';
import { Brand } from './Brand';
import { OnboardingBanner } from './OnboardingBanner';
import { AccountMenu } from './AccountMenu';
import { ThemeToggle } from './ThemeToggle';
import { Notifications } from './Notifications';
import { RoleSwitcher } from './RoleSwitcher';
import { dashboardPath } from './DashboardFrame';
import styles from './shell.module.css';

/**
 * Шапка: знак слева, навигация роли (гостю на главной — якоря), справа меню аккаунта (`account`, ADR 0004:
 * роли, профиль компании, «Выйти») или «Войти». Сессия без учётки в БД (старая демо-кука) — просто «Выйти».
 */
export function HeaderBar({ signedIn, links, account = null, demoEnabled = false }: { signedIn: boolean; links: NavLink[]; account?: HeaderAccount | null; demoEnabled?: boolean }) {
  const pathname = usePathname();
  const home = pathname === '/';
  const cabinet = dashboardPath(pathname) && !!account?.roles;
  return (
    <>
      <header className={styles.header}>
        <Brand />
        {cabinet && account?.roles?.role === 'employer' && <span className={styles.employerBadge}>для работодателей</span>}
        {cabinet && account ? <RoleSwitcher account={account} demoEnabled={demoEnabled} /> : links.length > 0 ? (
          <nav className={styles.nav} aria-label="Основная навигация">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={(l.exact ? pathname === l.href : pathname.startsWith(l.href)) ? 'page' : undefined}>
                {l.label}
              </Link>
            ))}
          </nav>
        ) : (
          home && (
            <nav className={`${styles.nav} ${styles.anchors}`} aria-label="Разделы страницы">
              {HOME_ANCHORS.map((a) => (
                <a key={a.href} href={a.href}>
                  {a.label}
                </a>
              ))}
            </nav>
          )
        )}
        {home && !account && <span className={styles.edition}>№ 01 · осень 2026</span>}
        <div className={styles.action}>
          {account?.roles && <Notifications role={account.roles.role} />}
          {/* Тема пока действует только на экран консультанта — иконка там, где она что-то меняет. */}
          {pathname === '/consultant' && <ThemeToggle />}
          {account ? (
            <AccountMenu account={account} />
          ) : signedIn ? (
            <LogoutButton className={styles.login} />
          ) : (
            <Link className={styles.login} href="/auth">
              Войти
            </Link>
          )}
        </div>
      </header>
      {signedIn && <OnboardingBanner />}
    </>
  );
}
