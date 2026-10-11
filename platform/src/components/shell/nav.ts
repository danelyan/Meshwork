import type { SessionRole } from '@/server/session';
import type { NavIconName } from './NavIcon';

export interface NavLink {
  href: string;
  label: string;
  /** Активна только на этом пути (не на вложенных). */
  exact?: boolean;
}

/** Раздел кабинета: единый источник для шапки и боковой панели (DashboardFrame). */
export interface NavItem extends NavLink {
  icon: NavIconName;
  /** Показывать и в шапке; сайдбар показывает все разделы. Подписи в обоих местах одни. */
  header?: boolean;
}

/** Кандидат: порядок по стадиям пути (знакомство, тест, навыки, проекты, приглашения), затем личное. */
export const CANDIDATE_NAV: NavItem[] = [
  { href: '/consultant', icon: 'consultant', label: 'Консультант', header: true },
  { href: '/test', icon: 'test', label: 'Тест на грейд', header: true },
  { href: '/skills', icon: 'skills', label: 'Навыки и грейд' },
  /** lane project: лента проектных заданий (ADR 0003, ступень 2) */
  { href: '/projects', icon: 'projects', label: 'Проекты', header: true },
  { href: '/invitations', icon: 'invitations', label: 'Приглашения', header: true },
  { href: '/career', icon: 'vacancies', label: 'Вакансии' },
  { href: '/companies', icon: 'companies', label: 'Компании' },
  { href: '/profile', icon: 'profile', label: 'Профиль', header: true },
  { href: '/interview', icon: 'call', label: 'Созвон с ИИ' },
  { href: '/saved', icon: 'saved', label: 'Избранное' },
  { href: '/settings', icon: 'settings', label: 'Настройки' },
];

export const EMPLOYER_NAV: NavItem[] = [
  // Помощник по подбору - дом работодателя, лента /consultant; первым (решение владельца 10.10).
  { href: '/consultant', icon: 'consultant', label: 'ИИ-помощник', header: true },
  { href: '/employer', icon: 'match', label: 'Подборка', exact: true, header: true },
  { href: '/employer/search', icon: 'search', label: 'Поиск по базе', header: true },
  { href: '/employer/vacancies', icon: 'vacancies', label: 'Вакансии', header: true },
  { href: '/employer/saved', icon: 'saved', label: 'Избранное' },
  { href: '/employer/invitations', icon: 'invitations', label: 'Приглашения', header: true },
  { href: '/employer/calls', icon: 'call', label: 'Собеседования', header: true },
  // «Компания» - в сайдбаре и в меню аккаунта (AccountMenu).
  { href: '/employer/company', icon: 'company', label: 'Компания' },
];

/** Подмножество для шапки: те же подписи и порядок, что в сайдбаре. */
export const CANDIDATE_LINKS: NavLink[] = CANDIDATE_NAV.filter((l) => l.header);
export const EMPLOYER_LINKS: NavLink[] = EMPLOYER_NAV.filter((l) => l.header);

/** Все разделы кабинета роли (сайдбар). */
export function navFor(role: SessionRole | null): NavItem[] {
  if (role === 'candidate') return CANDIDATE_NAV;
  if (role === 'employer') return EMPLOYER_NAV;
  return [];
}

/** Ссылки роли; гость и `pending` (роль ещё не выбрана) — без ссылок. */
export function linksFor(role: SessionRole | null): NavLink[] {
  if (role === 'candidate') return CANDIDATE_LINKS;
  if (role === 'employer') return EMPLOYER_LINKS;
  return [];
}

/**
 * Подразделы без своей вкладки подсвечивают ближайшую (первую присутствующую в списке): в шапке нет «Навыков»,
 * «Вакансий», «Избранного» - они ведут к «Профилю» / «Поиску по базе»; «Компания» вкладки в шапке не имеет.
 */
const TAB_ALIASES: Record<string, string[]> = {
  '/career': ['/profile'], '/skills': ['/profile'], '/saved': ['/profile'], '/settings': ['/profile'],
  '/interview': ['/consultant'],
  '/employer/needs': ['/employer/vacancies', '/employer'],
  '/employer/saved': ['/employer/search'],
};

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * `href` вкладки, активной на маршруте: прямое совпадение (самое длинное), иначе псевдоним подраздела.
 * `sections` — все разделы роли (сайдбар): у раздела со своим пунктом псевдонима нет, иначе шапка и сайдбар
 * подсвечивали бы разное («Профиль» и «Вакансии» на одном экране).
 */
export function activeLinkHref(pathname: string, links: NavLink[], sections: NavLink[] = []): string | undefined {
  const direct = links
    .filter((l) => (l.exact ? pathname === l.href : under(pathname, l.href)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (direct) return direct.href;
  if (sections.some((l) => (l.exact ? pathname === l.href : under(pathname, l.href)))) return undefined;
  const alias = Object.keys(TAB_ALIASES).find((k) => under(pathname, k));
  return alias ? TAB_ALIASES[alias]?.find((t) => links.some((l) => l.href === t)) : undefined;
}

/** Cabinet routes share a single sidebar, including the consultant. */
export function dashboardPath(pathname: string): boolean {
  return pathname === '/employer' || pathname.startsWith('/employer/')
    || CANDIDATE_NAV.some(({ href }) => (pathname === href || pathname.startsWith(`${href}/`)));
}

/**
 * Полоса разделов кабинета на узком экране прокручивается внутри себя. Возвращает `scrollLeft`, при котором пункт
 * (`linkLeft`, `linkWidth` - в координатах содержимого полосы) стоит по центру видимой части; значение зажато
 * в пределы прокрутки. Полоса помещается целиком - 0.
 */
export function navScrollToShow(nav: { clientWidth: number; scrollWidth: number }, linkLeft: number, linkWidth: number): number {
  const max = nav.scrollWidth - nav.clientWidth;
  if (max <= 0) return 0;
  return Math.min(max, Math.max(0, Math.round(linkLeft - (nav.clientWidth - linkWidth) / 2)));
}
