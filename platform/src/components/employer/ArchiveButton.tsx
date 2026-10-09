'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ApiError } from '@/lib/api';
import { archiveVacancyApi } from '@/lib/employer-api';

import { Button, Notice } from '../ui';

/** Закрыть потребность (в архиве подборка не строится) или вернуть её. */
export function ArchiveButton({ vacancyId, archived }: { vacancyId: string; archived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await archiveVacancyApi(vacancyId, !archived);
            router.push('/employer');
            router.refresh();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Не удалось изменить потребность');
            setBusy(false);
          }
        }}
      >
        {archived ? 'Вернуть в работу' : 'Закрыть потребность'}
      </Button>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
