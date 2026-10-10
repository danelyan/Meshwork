'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { RoleMenu } from '@/server/auth/role-plan';

import { HOME_ANCHORS, type NavLink } from './nav';
import { LogoutButton } from './LogoutButton';
import { Brand } from './Brand';
import { OnboardingBanner } from './OnboardingBanner';
import { RoleSwitch } from './RoleSwitch';
import styles from './shell.module.css';

/**
 * Шапка: знак слева, навигация роли (гостю на главной — якоря), справа метка активной роли с переключателем
 * (`roleMenu`, ADR 0004) и «Войти» или «Выйти».
 */
export function HeaderBar({ signedIn, links, roleMenu = null }: { signedIn: boolean; links: NavLink[]; roleMenu?: RoleMenu | null }) {
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
        {home && !roleMenu && <span className={styles.edition}>№ 01 · осень 2026</span>}
        {roleMenu && <RoleSwitch menu={roleMenu} />}
        <div className={styles.action}>{signedIn ? <LogoutButton className={styles.login} /> : <Link className={styles.login} href="/auth">Войти</Link>}</div>
      </header>
      {signedIn && <OnboardingBanner />}
    </>
  );
}
