import type { ReactNode } from 'react';

/** Кабинет кандидата: шапка и подвал — общая оболочка из app/layout.tsx. */
export default function CandidateLayout({ children }: { children: ReactNode }) {
  return <main id="main">{children}</main>;
}
