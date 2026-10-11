'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { HeaderAccount } from '@/server/auth/role-plan';

import { HOME_ANCHORS, activeLinkHref, navFor, type NavLink } from './nav';
import { LogoutButton } from './LogoutButton';
import { Brand } from './Brand';
import { OnboardingBanner } from './OnboardingBanner';
import { AccountMenu } from './AccountMenu';
import { isThemedPath } from './theme-script';
import { ThemeToggle } from './ThemeToggle';
import { Notifications } from './Notifications';
import styles from './shell.module.css';

/**
 * Шапка: знак слева, навигация роли (гостю на главной — якоря), справа меню аккаунта (`account`, ADR 0004:
 * роли, профиль компании, «Выйти») или «Войти». Сессия без учётки в БД (старая демо-кука) — просто «Выйти».
 */
export function HeaderBar({ signedIn, links, account = null }: { signedIn: boolean; links: NavLink[]; account?: HeaderAccount | null }) {
  const pathname = usePathname();
  const home = pathname === '/';
  const role = account?.roles?.role ?? null;
  const active = activeLinkHref(pathname, links, navFor(role));
  return (
    <>
      <header className={styles.header}>
        <Brand />
        {role === 'employer' && <span className={styles.employerBadge}>для работодателей</span>}
        {links.length > 0 ? (
          <nav className={styles.nav} aria-label="Основная навигация">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.href === active ? 'page' : undefined}>
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
        <div className={styles.action}>
          {account?.roles && <Notifications role={account.roles.role} />}
          {/* Тема действует в разделах кабинета (THEMED_PATHS) — иконка там, где она что-то меняет; на лендинге, входе и юридических её нет. */}
          {isThemedPath(pathname) && <ThemeToggle />}
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
