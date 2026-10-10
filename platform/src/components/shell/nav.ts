import type { SessionRole } from '@/server/session';

export interface NavLink {
  href: string;
  label: string;
  /** Активна только на этом пути (не на вложенных). */
  exact?: boolean;
}

export const CANDIDATE_LINKS: NavLink[] = [
  { href: '/consultant', label: 'Консультант' },
  { href: '/profile', label: 'Профиль' },
  { href: '/test', label: 'Тест' },
  { href: '/invitations', label: 'Приглашения' },
];

export const EMPLOYER_LINKS: NavLink[] = [
  { href: '/employer', label: 'Потребности', exact: true },
  { href: '/employer/search', label: 'Поиск по базе' },
  { href: '/employer/invitations', label: 'Приглашения' },
  { href: '/employer/company', label: 'Профиль компании' },
  // Помощник по подбору — дом работодателя, лента /consultant (решение владельца 10.10).
  { href: '/consultant', label: 'Помощник' },
];

/** Якоря главной: показываются гостю только на «/». */
export const HOME_ANCHORS: NavLink[] = [
  { href: '#companies', label: 'Компании' },
  { href: '#why', label: 'Почему мы' },
];

/** Ссылки роли; гость и `pending` (роль ещё не выбрана) — без ссылок. */
export function linksFor(role: SessionRole | null): NavLink[] {
  if (role === 'candidate') return CANDIDATE_LINKS;
  if (role === 'employer') return EMPLOYER_LINKS;
  return [];
}
