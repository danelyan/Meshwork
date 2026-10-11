import { type Action, type StaffRoleName, can } from '@/server/admin/permissions';

/**
 * Меню админки (E-08): все разделы фаз 0–5 заведены фундаментом. Лейн фазы создаёт страницу по уже заданному
 * `href` (`src/app/(admin)/admin/<раздел>/page.tsx`) с гвардом `requirePageStaff('<href>', '<action>')` –
 * раскладку и этот реестр не трогает. Пункт скрыт, если у роли нет права `action`.
 */
export interface AdminNavItem {
  href: string;
  label: string;
  /** Право, без которого пункт скрыт; этим же правом страница проверяет доступ. */
  action: Action;
  /** Фаза эпика E-08, в которой делается страница. */
  phase: 0 | 1 | 2 | 3 | 4 | 5;
}

export interface AdminNavGroup {
  title: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    title: 'Обзор',
    items: [{ href: '/admin', label: 'Обзор', action: 'view_dashboard', phase: 1 }],
  },
  {
    title: 'База',
    items: [
      { href: '/admin/users', label: 'Пользователи', action: 'view_users', phase: 1 },
      { href: '/admin/candidates', label: 'Кандидаты', action: 'view_candidates', phase: 1 },
      { href: '/admin/companies', label: 'Компании', action: 'view_companies', phase: 1 },
      { href: '/admin/vacancies', label: 'Вакансии', action: 'view_vacancies', phase: 1 },
      { href: '/admin/invitations', label: 'Приглашения', action: 'view_invitations', phase: 1 },
      { href: '/admin/applications', label: 'Самоотклики', action: 'view_invitations', phase: 1 },
    ],
  },
  {
    title: 'Модерация',
    items: [
      { href: '/admin/complaints', label: 'Жалобы', action: 'view_complaints', phase: 2 },
      { href: '/admin/appeals', label: 'Апелляции', action: 'view_appeals', phase: 2 },
      { href: '/admin/objections', label: 'Возражения', action: 'view_objections', phase: 2 },
      { href: '/admin/red-flags', label: 'Красные флаги', action: 'view_red_flags', phase: 2 },
      { href: '/admin/verification', label: 'Верификация', action: 'view_verification', phase: 2 },
    ],
  },
  {
    title: 'Платформа',
    items: [
      { href: '/admin/settings', label: 'Настройки', action: 'view_settings', phase: 4 },
      { href: '/admin/catalogs', label: 'Справочники', action: 'edit_catalogs', phase: 4 },
      { href: '/admin/metrics', label: 'Метрики', action: 'view_metrics', phase: 5 },
      { href: '/admin/audit', label: 'Журнал', action: 'view_audit', phase: 0 },
      { href: '/admin/demo', label: 'Демо-данные', action: 'manage_demo', phase: 3 },
      { href: '/admin/staff', label: 'Персонал', action: 'manage_staff', phase: 0 },
    ],
  },
];

/** Меню для роли: только разрешённые пункты, пустые группы убраны. */
export function navFor(role: StaffRoleName): AdminNavGroup[] {
  return ADMIN_NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(role, i.action)) })).filter((g) => g.items.length > 0);
}

/** Активный пункт: точное совпадение для /admin, префикс для разделов. */
export function isNavActive(href: string, pathname: string): boolean {
  return href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`);
}
