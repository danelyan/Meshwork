// Тема страницы: константы и инлайн-скрипт без мигания. Без 'use client' и без React — модуль импортирует
// серверный app/layout.tsx (строка скрипта) и клиентский theme.ts (хук и переключатель).

/** Ключ localStorage. Имя прежнее (была «тема сцены»), чтобы сохранённый выбор не потерялся. */
export const THEME_KEY = 'fsp:scene-theme';

/**
 * Разделы кабинета, где действует выбранная тема (решение владельца 11.10: кабинеты кандидата и работодателя,
 * без лендинга, входа и юридических страниц). Путь подходит, если равен разделу или вложен в него.
 */
export const THEMED_PATHS: readonly string[] = [
  '/consultant',
  '/career', '/defense', '/defense-room', '/interview', '/invitations', '/profile', '/projects', '/saved', '/settings', '/skills', '/test',
  '/employer',
];

export function isThemedPath(pathname: string | null | undefined): boolean {
  return !!pathname && THEMED_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/**
 * Синхронный скрипт для <head>: до первой отрисовки ставит data-theme='dark' на <html>, если страница
 * тематическая и выбрана тёмная. Схема — Next.js guide «Preventing flash before hydration».
 */
export const THEME_SCRIPT = `(function(){try{var p=location.pathname;if(${JSON.stringify(THEMED_PATHS)}.some(function(x){return p===x||p.indexOf(x+'/')===0})&&localStorage.getItem(${JSON.stringify(THEME_KEY)})==='dark')document.documentElement.setAttribute('data-theme','dark')}catch(e){}})()`;
