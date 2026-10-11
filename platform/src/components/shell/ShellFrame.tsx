'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';

import { MotionProvider } from '@/components/ui/MotionProvider';

import styles from './shell.module.css';
import type { HeaderAccount } from '@/server/auth/role-plan';
import { DashboardFrame } from './DashboardFrame';
import { useThemeRoot } from './theme';

const BARE_PATHS = ['/onboarding', '/design/consultant-grid-preview', '/design/consultant-grid-v1', '/design/consultant-grid-v2', '/design/consultant-grid-v3'];

const BareContext = createContext<(on: boolean) => void>(() => undefined);

/**
 * Страница прячет шапку и подвал, пока `active` (тест в процессе: уйти случайно нельзя).
 * Для целых маршрутов (онбординг) список — BARE_PATHS.
 */
export function useBareShell(active: boolean): void {
  const set = useContext(BareContext);
  useEffect(() => {
    set(active);
    return () => set(false);
  }, [active, set]);
}

/**
 * Каркас сайта: ссылка «К содержимому», шапка, страница, подвал. Шапка и подвал приходят готовыми серверными
 * элементами; здесь только решается, показывать ли их. Лэйаут не знает путь на сервере (не перерисовывается
 * при навигации), поэтому решение — на клиенте по `usePathname()`.
 */
export function ShellFrame({ header, footer, children, account, employerSummary }: { header: ReactNode; footer: ReactNode; children: ReactNode; account?: HeaderAccount | null; employerSummary?: ReactNode }) {
  const pathname = usePathname();
  // тёмная тема только на /consultant: атрибут на <html> снимается при уходе со страницы
  useThemeRoot(pathname);
  const [bareByPage, setBareByPage] = useState(false);
  const bare = bareByPage || BARE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const setter = useMemo(() => setBareByPage, []);
  return (
    <MotionProvider>
    <BareContext.Provider value={setter}>
      <div className={`${styles.frame}${pathname === '/consultant' ? ` ${styles.consultant}` : ''}`}>
      <a className={styles.skip} href="#main">
        К содержимому
      </a>
      {!bare && header}
      <div className={styles.page}><DashboardFrame account={account} employerSummary={employerSummary} bare={bare}>{children}</DashboardFrame></div>
      {!bare && footer}
      </div>
    </BareContext.Provider>
    </MotionProvider>
  );
}
