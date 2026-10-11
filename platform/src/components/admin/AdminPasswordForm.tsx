'use client';

import { useState } from 'react';

import { Button, Field, Notice } from '@/components/ui';
import ui from '@/components/ui.module.css';

import styles from '@/app/(admin)/admin/admin.module.css';

import { adminFetch } from './adminFetch';

/** Смена своего пароля; остальные сессии сотрудника отзываются. */
export function AdminPasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={styles.form}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await adminFetch('/api/admin/auth/password', { body: { current, next } });
          setCurrent('');
          setNext('');
          setMsg({ tone: 'info', text: 'Пароль изменён. Другие сессии завершены.' });
        } catch (err) {
          setMsg({ tone: 'error', text: err instanceof Error ? err.message : 'Ошибка' });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Текущий пароль">
        <input className={ui.input} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="Новый пароль" hint="От 8 до 128 символов">
        <input className={ui.input} type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Button type="submit" loading={busy}>Сменить пароль</Button>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </form>
  );
}
