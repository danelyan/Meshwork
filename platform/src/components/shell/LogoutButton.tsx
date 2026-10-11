'use client';


import { logout } from '@/lib/api';

/** «Выйти»: гасит сессию (POST /api/auth/logout, с проверкой Origin) и обновляет серверные компоненты (шапка в лэйауте перечитывает куку). */
export function LogoutButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await logout();
        } finally {
          window.location.assign('/');
        }
      }}
    >
      Выйти
    </button>
  );
}
