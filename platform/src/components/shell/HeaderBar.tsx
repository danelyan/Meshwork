'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { HOME_ANCHORS, type NavLink } from './nav';
import { LogoutButton } from './LogoutButton';
import { Brand } from './Brand';
import { OnboardingBanner } from './OnboardingBanner';
import styles from './shell.module.css';

/** Шапка: знак слева, навигация роли (гостю на главной — якоря), справа «Войти» или «Выйти». */
export function HeaderBar({ signedIn, links }: { signedIn: boolean; links: NavLink[] }) {
  const pathname = usePathname();
  const home = pathname === '/';
  return (
    <>
      <header className={styles.header}>
        <Brand />
        {links.length > 0 ? (
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
        {home && <span className={styles.edition}>№ 01 · осень 2026</span>}
        <div className={styles.action}>{signedIn ? <LogoutButton className={styles.login} /> : <Link className={styles.login} href="/auth">Войти</Link>}</div>
      </header>
      {signedIn && <OnboardingBanner />}
    </>
  );
}
