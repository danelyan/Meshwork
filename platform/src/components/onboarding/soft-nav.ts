'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useTransition } from 'react';

/**
 * Переход после действия знакомства («Настроить позже», «Вернуться к знакомству»). Тот же адрес —
 * мягкое обновление: сервер заново выбирает ленту (шаги или пауза), а сцена с головой, звук и правая
 * колонка остаются смонтированными (router.refresh сохраняет клиентское состояние и прокрутку).
 * Другой адрес — полная навигация, как раньше.
 */
export function useSoftGo(): (path: string) => void {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return useCallback(
    (path: string) => {
      const query = new URLSearchParams(window.location.search);
      const leavingIntake = query.get('mode') === 'intake' || query.get('edit') === 'profile';
      if (path === window.location.pathname && !leavingIntake) startTransition(() => router.refresh());
      else window.location.assign(path);
    },
    [router],
  );
}
