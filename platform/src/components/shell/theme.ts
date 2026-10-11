'use client';

import { useLayoutEffect, useSyncExternalStore } from 'react';

import { THEME_KEY, isThemedPath } from './theme-script';

// Тема страницы (лейн theme, решение владельца 11.10): по умолчанию светлая, тёмная — переключателем в шапке
// (ThemeToggle) или в dev-панели. Действует только на THEMED_PATHS (разделы кабинета): там на <html> ставится
// data-theme='dark' (токены — styles/tokens.css), на остальных страницах атрибут снимается. Выбор хранится в
// localStorage; до гидрации его ставит инлайн-скрипт THEME_SCRIPT в app/layout.tsx, поэтому мигания нет.

export type Theme = 'light' | 'dark';

const EVENT = 'fsp:theme';

export function readTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Выбранная тема (не зависит от страницы); на сервере и при гидрации — светлая. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => 'light');
}

/** Ставит или снимает data-theme на <html> для пути `pathname`. */
export function applyTheme(pathname: string | null | undefined, theme: Theme = readTheme()) {
  const root = document.documentElement;
  if (theme === 'dark' && isThemedPath(pathname)) root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
}

export function setTheme(theme: Theme) {
  try {
    if (theme === 'dark') window.localStorage.setItem(THEME_KEY, 'dark');
    else window.localStorage.removeItem(THEME_KEY);
  } catch {
    /* хранилище недоступно — тема не запоминается, но применяется до перезагрузки */
  }
  applyTheme(window.location.pathname, theme);
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Держит атрибут темы на <html> в согласии с путём и выбором: снимает при уходе с /consultant (клиентская
 * навигация), возвращает при заходе и после dev-перемонтирования корня. Тему читает из хранилища, а не из
 * снимка useTheme: при гидрации тот светлый и иначе сбросил бы атрибут, поставленный скриптом.
 */
export function useThemeRoot(pathname: string | null) {
  const theme = useTheme();
  useLayoutEffect(() => {
    applyTheme(pathname);
  }, [pathname, theme]);
}
