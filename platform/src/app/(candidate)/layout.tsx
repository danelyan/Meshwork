import type { ReactNode } from 'react';

/**
 * Кабинет кандидата: шапка и подвал — общая оболочка из app/layout.tsx.
 * Доступ проверяет каждая page.tsx (`requirePageCandidate`), не layout: layout не перерисовывается
 * при клиентской навигации между дочерними страницами (docs Next.js: Authentication).
 */
export default function CandidateLayout({ children }: { children: ReactNode }) {
  return <main id="main">{children}</main>;
}
