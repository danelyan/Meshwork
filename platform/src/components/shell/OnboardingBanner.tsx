'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { getMe } from '@/lib/api';

import styles from './shell.module.css';

/**
 * Аккаунт вошёл, но онбординг не завершён («Настроить позже») — плашка со ссылкой. Ошибки сети молча игнорируем.
 * Кандидат продолжает знакомство в ленте /consultant (решение владельца 10.10) — там плашка не нужна.
 */
export function OnboardingBanner() {
  const pathname = usePathname();
  const href = useOnboardingPending();
  if (!href || pathname === href) return null;
  return (
    <p className={styles.banner} role="status">
      Онбординг не завершён: <Link href={href}>продолжить</Link>
    </p>
  );
}

/** Куда продолжать незавершённый онбординг; null — завершён или неизвестно. */
function useOnboardingPending(): string | null {
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getMe().then(
      (u) => alive && setPending(u && !u.onboarded ? (u.role === 'candidate' ? '/consultant' : '/onboarding') : null),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return pending;
}
