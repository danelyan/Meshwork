'use client';

import { useState, type FormEvent } from 'react';

import { ApiError } from '@/lib/api';
import { setContactApi } from '@/lib/employer-api';

import { Button, Field, Panel } from '../ui';
import ui from '../ui.module.css';

import styles from './Employer.module.css';

/** Способ связи кандидата (Q-35): почта или Telegram, компания видит его только после принятия приглашения. */
export function ContactForm({ contact: initial }: { contact: string | null }) {
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await setContactApi(value.trim());
      setSaved(r.contact);
      setValue(r.contact ?? '');
    } catch (err) {
      if (!(err instanceof ApiError)) setError('Не удалось сохранить контакт');
      else setError(err.status === 400 ? 'Укажи почту (name@mail.ru) или Telegram (@username)' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className={styles.card} aria-labelledby="contact-title">
      <h2 id="contact-title" className={styles.sectionTitle}>
        Как с тобой связаться
      </h2>
      <form className={styles.inviteBox} onSubmit={submit} noValidate aria-label="Контакт для работодателей">
        <Field label="Почта или Telegram" hint="Компания увидит контакт, только когда ты примешь её приглашение." error={error ?? undefined}>
          <input
            className={ui.input}
            value={value}
            maxLength={120}
            placeholder="name@mail.ru или @username"
            autoComplete="email"
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <p className={styles.meta} role="status">
          Сейчас: {saved ?? 'контакт не указан - компания увидит только почту аккаунта, если она есть'}
        </p>
        <div className={styles.actions}>
          <Button type="submit" size="sm" loading={busy}>
            Сохранить
          </Button>
        </div>
      </form>
    </Panel>
  );
}
