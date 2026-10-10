/**
 * Значение `data-role` для `<body>` (ролевая тема, docs/design-system.md, «Роль в оболочке»): гость и pending -
 * без атрибута. Вынесено из app/layout.tsx: Next.js не разрешает раскладке лишние экспорты.
 */
export function bodyRole(session: { role: string } | null | undefined): 'candidate' | 'employer' | undefined {
  return session?.role === 'candidate' || session?.role === 'employer' ? session.role : undefined;
}
