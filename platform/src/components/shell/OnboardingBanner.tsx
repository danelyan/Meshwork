'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { getMe } from '@/lib/api';

import styles from './shell.module.css';

const HIDE_KEY = 'onboarding-banner-hidden';

/**
 * Аккаунт вошёл, но онбординг не завершён («Настроить позже») — плашка с прогрессом и ссылкой.
 * Крестик скрывает её до следующего входа (sessionStorage), онбординг не трогает. Ошибки сети молча игнорируем.
 * Знакомство любой роли идёт в ленте /consultant (решение владельца 10.10) — там плашка не нужна.
 */
export function OnboardingBanner() {
  const pathname = usePathname();
  const pending = useOnboardingPending();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(HIDE_KEY) === '1') setHidden(true);
    } catch {
      /* хранилище недоступно — плашка просто остаётся */
    }
  }, []);
  if (!pending || hidden || pathname === pending.href) return null;
  const { progress } = pending;
  const hide = () => {
    setHidden(true);
    try {
      window.sessionStorage.setItem(HIDE_KEY, '1');
    } catch {
      /* скрыто до перезагрузки страницы */
    }
  };
  return (
    <div className={styles.banner} role="status">
      <p className={styles.bannerText}>
        {progress ? `Знакомство: заполнено ${progress.done} из ${progress.total} — ` : 'Онбординг не завершён: '}
        <Link href={pending.href}>продолжить</Link>
      </p>
      <button type="button" className={styles.bannerClose} aria-label="Скрыть" onClick={hide}>
        ×
      </button>
    </div>
  );
}

interface Pending {
  href: string;
  progress: { done: number; total: number } | null;
}

/** Куда продолжать незавершённый онбординг и сколько шагов закрыто; null — завершён или неизвестно. */
function useOnboardingPending(): Pending | null {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    let alive = true;
    getMe().then(
      (u) => alive && setPending(u && !u.onboarded ? { href: '/consultant', progress: validProgress(u.onboardingProgress) } : null),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return pending;
}

function validProgress(p: { done: number; total: number } | null | undefined): Pending['progress'] {
  return p && p.total > 0 && p.done >= 0 && p.done <= p.total ? p : null;
}
