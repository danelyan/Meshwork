import type { ReactNode } from 'react';

/** Кабинет работодателя: шапка и подвал — общая оболочка из app/layout.tsx (ссылки роли — components/shell/nav.ts). */
export default function EmployerLayout({ children }: { children: ReactNode }) {
  return <main id="main">{children}</main>;
}
