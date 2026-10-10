import type { ReactNode } from 'react';

/** Страницы общих адресов (/consultant): шапка и подвал — общая оболочка из app/layout.tsx. Роль решает сама страница. */
export default function SharedLayout({ children }: { children: ReactNode }) {
  return <main id="main">{children}</main>;
}
