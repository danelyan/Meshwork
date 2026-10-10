'use client';

import { setSceneTheme, useSceneTheme } from '@/components/avatar/scene-theme';

import styles from './shell.module.css';

/**
 * Иконка темы экрана консультанта в шапке (идея владельца 10.10). Тема и её хранение — `scene-theme.ts`
 * (тот же переключатель, что в dev-панели); в светлой теме показываем луну, в тёмной — солнце.
 */
export function ThemeToggle() {
  const dark = useSceneTheme() === 'dark';
  return (
    <button
      type="button"
      className={styles.themeToggle}
      aria-pressed={dark}
      aria-label="Тёмная тема"
      title={dark ? 'Светлая тема' : 'Тёмная тема'}
      onClick={() => setSceneTheme(dark ? 'light' : 'dark')}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </>
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        )}
      </svg>
    </button>
  );
}
