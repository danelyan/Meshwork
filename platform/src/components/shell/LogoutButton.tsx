'use client';

import { useRouter } from 'next/navigation';

import { demoLogout } from '@/lib/api';

/** «Выйти»: гасит сессию и обновляет серверные компоненты (шапка в лэйауте перечитывает куку). */
export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await demoLogout();
        } finally {
          router.push('/');
          router.refresh();
        }
      }}
    >
      Выйти
    </button>
  );
}
