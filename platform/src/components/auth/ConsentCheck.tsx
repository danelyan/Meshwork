'use client';

import { useId } from 'react';

import { CONSENT_IS_DRAFT, CONSENT_PARAGRAPHS } from '@/server/onboarding/consent-text';

import styles from '../AuthScreen.module.css';

/**
 * Галка согласия на обработку ПДн при регистрации (R-C-14; решение владельца 09.10: согласие —
 * при регистрации одной галкой, в чате онбординга его больше нет). Без галки кнопка входа
 * неактивна; сервер всё равно проверяет версию текста и без неё пользователя не создаёт.
 */
export function ConsentCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className={styles.consent}>
      <label className={styles.consentRow} htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>
          Согласен(на) на обработку персональных данных —{' '}
          <a href="/consent" target="_blank" rel="noopener">
            полный текст
          </a>
        </span>
      </label>
      <details className={styles.consentText}>
        <summary>Коротко, на что согласие</summary>
        {CONSENT_PARAGRAPHS.map((p) => (
          <p key={p}>{p}</p>
        ))}
        {CONSENT_IS_DRAFT && <p>Черновик текста, юрист его ещё не проверял.</p>}
      </details>
    </div>
  );
}
