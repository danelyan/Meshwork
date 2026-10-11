import type { ReactNode } from 'react';

/**
 * Иконки разделов кабинета: квадратные концы и углы (радиусы 0, как в токенах) и один залитый квадрат-«узел»
 * в каждой – мотив сети MESHWORK. Цвет – currentColor, активный пункт сайдбара инвертируется сам.
 */
export type NavIconName =
  | 'consultant' | 'test' | 'skills' | 'projects' | 'invitations' | 'vacancies' | 'companies'
  | 'profile' | 'call' | 'saved' | 'settings' | 'match' | 'search' | 'company';

const node = (x: number, y: number, s = 4) => <rect x={x - s / 2} y={y - s / 2} width={s} height={s} fill="currentColor" stroke="none" />;

const ICONS: Record<NavIconName, ReactNode> = {
  // Реплика Киры: окно чата с хвостом и узел-«собеседник».
  consultant: <><path d="M3 4h18v12H10l-5 4v-4H3z" /><path d="M7 8.5h6M7 12h9" />{node(18, 8.5, 3)}</>,
  // Ступени грейда, узел – на верхней.
  test: <><path d="M3 20h5v-5h5v-5h5V5" /><path d="M3 20h18" />{node(18, 5)}</>,
  // Шкалы навыков разной длины, узлы – уровень.
  skills: <><path d="M3 6h18M3 12h18M3 18h18" strokeOpacity=".28" /><path d="M3 6h11M3 12h16M3 18h7" />{node(14, 6)}{node(19, 12)}{node(10, 18)}</>,
  // Код в рамке задания.
  projects: <><path d="M3 4h18v16H3z" /><path d="M9 9l-3 3 3 3M15 9l3 3-3 3" />{node(12, 12, 3)}</>,
  // Конверт с узлом-отметкой о новом.
  invitations: <><path d="M3 6h15M21 9v11H3V6" /><path d="M3 6l9 7 5-3.9" />{node(20.5, 5.5)}</>,
  // Портфель вакансии.
  vacancies: <><path d="M3 8h18v12H3z" /><path d="M9 8V4h6v4M3 13h18" />{node(12, 13)}</>,
  // Здание с окнами.
  companies: <><path d="M4 21V3h11v18M15 9h5v12M2 21h20" /><path d="M7.5 7h1M11 7h1M7.5 11h1M11 11h1M7.5 15h1M11 15h1" />{node(17.5, 13, 3)}</>,
  company: <><path d="M4 21V3h11v18M15 9h5v12M2 21h20" /><path d="M7.5 7h1M11 7h1M7.5 11h1M11 11h1M7.5 15h1M11 15h1" />{node(17.5, 13, 3)}</>,
  // Профиль: голова-квадрат и плечи.
  profile: <><path d="M8 3h8v8H8z" /><path d="M4 21v-6h16v6" />{node(12, 7, 3)}</>,
  // Видеосозвон.
  call: <><path d="M3 6h13v12H3z" /><path d="M16 10l5-3v10l-5-3" />{node(9.5, 12)}</>,
  // Закладка вместо звезды.
  saved: <><path d="M6 3h12v18l-6-5-6 5z" />{node(12, 9)}</>,
  // Шестерня из квадрата: зубцы по сторонам и диагоналям.
  settings: <><path d="M6 6h12v12H6z" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.5 4.5l2 2M17.5 17.5l2 2M19.5 4.5l-2 2M6.5 17.5l-2 2" />{node(12, 12)}</>,
  // Подборка: вакансия в центре и связи к кандидатам – как карта подборки.
  match: <><path d="M12 12L6 7M12 12l6-4M12 12l-5 6M12 12l6 5" /><path d="M2 3h4v4H2zM18 4h4v4h-4zM3 18h4v4H3zM18 17h4v4h-4z" />{node(12, 12, 5)}</>,
  // Поиск: квадратная линза.
  search: <><path d="M3 3h12v12H3z" /><path d="M15 15l6 6" />{node(9, 9)}</>,
};

export function NavIcon({ name }: { name: NavIconName }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" focusable="false">{ICONS[name]}</svg>;
}
