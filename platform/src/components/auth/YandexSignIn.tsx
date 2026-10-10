'use client';

import { useState } from 'react';

import { CONSENT_VERSION } from '@/server/onboarding/consent-text';

import styles from '../AuthScreen.module.css';
import ui from '../ui.module.css';
import { ConsentCheck } from './ConsentCheck';

/**
 * Кнопки внешнего входа под одной галкой согласия: версия текста уходит в старт входа.
 * «Войти через ФСП ID» (/api/fsp-id/login) — только кандидату: ФСП ID есть у спортсменов; провайдер всегда
 * доступен (симулятор по env или встроенный мок). «Войти через Яндекс ID» (/api/auth/yandex) — если настроен.
 */
export function YandexSignIn({ enabled, next, fsp = false }: { enabled: boolean; next: string | null; fsp?: boolean }) {
  const [agreed, setAgreed] = useState(false);
  const qs = new URLSearchParams({ consent: CONSENT_VERSION, ...(next ? { next } : {}) });
  const active = enabled && agreed;
  return (
    <>
      <ConsentCheck checked={agreed} onChange={setAgreed} />
      {fsp && (
        <a href={agreed ? `/api/fsp-id/login?${qs.toString()}` : undefined} className={`${ui.btn} ${ui.primary} ${styles.yandex} ${styles.fsp}`} aria-disabled={agreed ? undefined : 'true'}>
          <svg className={styles.ya} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 2.5l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 16.8l-5.8 3.5 1.6-6.6-5.2-4.4 6.8-.5z" fill="currentColor" />
          </svg>
          Войти через ФСП ID
        </a>
      )}
      <a
        href={active ? `/api/auth/yandex?${qs.toString()}` : undefined}
        className={`${ui.btn} ${ui.primary} ${styles.yandex}`}
        aria-disabled={active ? undefined : 'true'}
        aria-describedby={enabled ? undefined : 'yandex-off'}
      >
        <svg className={styles.ya} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="12" fill="#FC3F1D" />
          <path d="M13.3 6.5h-1.1c-1.9 0-2.9 1-2.9 2.4 0 1.6.7 2.4 2.1 3.3l1.2.8-3.3 4.9H7.4l3-4.4C8.7 12.3 7.7 11.1 7.7 9c0-2.6 1.8-4.4 5.2-4.4h3.4v12.8h-2.9V6.5z" fill="#fff" />
        </svg>
        Войти через Яндекс ID
      </a>
    </>
  );
}
