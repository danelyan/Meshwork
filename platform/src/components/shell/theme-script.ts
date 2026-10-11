// Тема страницы: константы и инлайн-скрипт без мигания. Без 'use client' и без React — модуль импортирует
// серверный app/layout.tsx (строка скрипта) и клиентский theme.ts (хук и переключатель).

/** Ключ localStorage. Имя прежнее (была «тема сцены»), чтобы сохранённый выбор не потерялся. */
export const THEME_KEY = 'fsp:scene-theme';

/** Страницы, где действует выбранная тема (решение владельца 11.10). Остальные всегда светлые. */
export const THEMED_PATHS: readonly string[] = ['/consultant'];

export function isThemedPath(pathname: string | null | undefined): boolean {
  return !!pathname && THEMED_PATHS.includes(pathname);
}

/**
 * Синхронный скрипт для <head>: до первой отрисовки ставит data-theme='dark' на <html>, если страница
 * тематическая и выбрана тёмная. Схема — Next.js guide «Preventing flash before hydration».
 */
export const THEME_SCRIPT = `(function(){try{if(${JSON.stringify(THEMED_PATHS)}.indexOf(location.pathname)>-1&&localStorage.getItem(${JSON.stringify(THEME_KEY)})==='dark')document.documentElement.setAttribute('data-theme','dark')}catch(e){}})()`;
