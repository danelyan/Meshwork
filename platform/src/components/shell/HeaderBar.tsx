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
import { headerPlan } from './headerPlan';
import styles from './shell.module.css';

/**
 * Единая шапка: знак слева, в центре переключатель ролей (вход с выбранной ролью — на любом маршруте), справа колокольчик
 * и меню аккаунта (`account`, ADR 0004: роли, профиль компании, «Выйти») или «Войти». Что показывать, решает
 * `headerPlan` (headerPlan.ts) по входу, аккаунту и маршруту; здесь только вёрстка. Сессия без учётки в БД
 * (старая демо-кука) — ссылки роли и просто «Выйти».
 */
export function HeaderBar({ signedIn, links, account = null, demoEnabled = false }: { signedIn: boolean; links: NavLink[]; account?: HeaderAccount | null; demoEnabled?: boolean }) {
  const pathname = usePathname();
  const plan = headerPlan({ pathname, signedIn, account, hasLinks: links.length > 0 });
  if (plan.variant === 'bare') return null;
  return (
    <>
      <header className={styles.header}>
        <Brand />
        {plan.employerBadge && <span className={styles.employerBadge}>для работодателей</span>}
        {plan.center === 'roles' && account && <RoleSwitcher account={account} demoEnabled={demoEnabled} />}
        {plan.center === 'links' && (
          <nav className={styles.nav} aria-label="Основная навигация">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={(l.exact ? pathname === l.href : pathname.startsWith(l.href)) ? 'page' : undefined}>
                {l.label}
              </Link>
            ))}
          </nav>
        )}
        {plan.center === 'anchors' && (
          <nav className={`${styles.nav} ${styles.anchors}`} aria-label="Разделы страницы">
            {HOME_ANCHORS.map((a) => (
              <a key={a.href} href={a.href}>
                {a.label}
              </a>
            ))}
          </nav>
        )}
        <div className={styles.action}>
          {plan.notifications && account?.roles && <Notifications role={account.roles.role} />}
          {/* Тема пока действует только на экран консультанта — иконка там, где она что-то меняет. */}
          {plan.themeToggle && <ThemeToggle />}
          {plan.account === 'menu' && account ? (
            <AccountMenu account={account} sections={plan.sectionsInMenu ? links : undefined} />
          ) : plan.account === 'logout' ? (
            <LogoutButton className={styles.login} />
          ) : (
            <Link className={styles.login} href="/auth">
              Войти
            </Link>
          )}
        </div>
      </header>
      {plan.onboardingBanner && <OnboardingBanner />}
    </>
  );
}
