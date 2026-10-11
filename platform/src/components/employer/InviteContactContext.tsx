'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Способ связи компании в приглашениях (E05): строка – есть, null – нет (отправка закрыта, createInvitation
 * ответит 422 company_contact_required), undefined – неизвестно (форма вне кабинета работодателя, например в тестах).
 * Значение считает сервер в кабинете работодателя (app/(employer)/layout.tsx), форма приглашения его только читает.
 */
const InviteContactContext = createContext<string | null | undefined>(undefined);

export function InviteContactProvider({ value, children }: { value: string | null; children: ReactNode }) {
  return <InviteContactContext.Provider value={value}>{children}</InviteContactContext.Provider>;
}

export function useInviteContact(): string | null | undefined {
  return useContext(InviteContactContext);
}
