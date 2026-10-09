'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { getMe } from '@/lib/api';

import styles from './shell.module.css';

/** Аккаунт вошёл, но онбординг не завершён («Настроить позже») — плашка со ссылкой. Ошибки сети молча игнорируем. */
export function OnboardingBanner() {
  const pending = useOnboardingPending();
  if (!pending) return null;
  return (
    <p className={styles.banner} role="status">
      Онбординг не завершён: <Link href="/onboarding">продолжить</Link>
    </p>
  );
}

function useOnboardingPending(): boolean {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let alive = true;
    getMe().then(
      (u) => alive && setPending(Boolean(u && !u.onboarded)),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return pending;
}
