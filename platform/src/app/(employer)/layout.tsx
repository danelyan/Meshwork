import type { ReactNode } from 'react';

import { InviteContactProvider } from '@/components/employer/InviteContactContext';
import { getPageSession } from '@/server/auth/page';
import { companyInviteContactFor } from '@/server/employer/invitations';

/**
 * Кабинет работодателя: шапка и подвал — общая оболочка из app/layout.tsx (ссылки роли — components/shell/nav.ts).
 * Способ связи компании (E05) считается здесь один раз, формы приглашений читают его из контекста.
 */
export default async function EmployerLayout({ children }: { children: ReactNode }) {
  const session = await getPageSession();
  const inviteContact = session?.role === 'employer' && session.employerProfileId ? await companyInviteContactFor(session.employerProfileId).catch(() => null) : null;
  return (
    <main id="main">
      <InviteContactProvider value={inviteContact}>{children}</InviteContactProvider>
    </main>
  );
}
