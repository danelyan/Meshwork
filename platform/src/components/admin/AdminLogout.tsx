'use client';

import { useState } from 'react';

import { Button } from '@/components/ui';

/** Выход из админки: отзыв сессии на сервере, затем страница входа. */
export function AdminLogout() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/admin/auth/logout', { method: 'POST' }).catch(() => undefined);
        window.location.assign('/admin/login');
      }}
    >
      Выйти
    </Button>
  );
}
