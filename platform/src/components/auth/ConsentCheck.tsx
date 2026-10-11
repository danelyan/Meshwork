'use client';

import { useId, useState } from 'react';

import { CONSENT_IS_DRAFT, CONSENT_PARAGRAPHS } from '@/server/onboarding/consent-text';

import styles from '../AuthScreen.module.css';

/**
 * Галка согласия на обработку ПДн при регистрации (R-C-14; решение владельца 09.10: согласие —
 * при регистрации одной галкой, в чате онбординга его больше нет). Без галки кнопка входа
 * неактивна; сервер всё равно проверяет версию текста и без неё пользователя не создаёт.
 */
export function ConsentCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  const textId = `${id}-text`;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={styles.consent}>
      <div className={styles.consentRow}>
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={styles.consentLabel}>
          <label htmlFor={id}>Согласен(на) на обработку персональных данных</label>{' '}
          <button type="button" className={styles.consentToggle} aria-label={expanded ? 'Скрыть текст согласия' : 'Показать текст согласия'} aria-expanded={expanded} aria-controls={textId} onClick={() => setExpanded(!expanded)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
          </button>
        </span>
      </div>
      <div id={textId} className={styles.consentText} hidden={!expanded}>
        {CONSENT_PARAGRAPHS.map((p) => (
          <p key={p}>{p}</p>
        ))}
        {CONSENT_IS_DRAFT && <p>Черновик текста, юрист его ещё не проверял.</p>}
        <a href="/consent" target="_blank" rel="noopener">Полный текст согласия</a>
      </div>
    </div>
  );
}
