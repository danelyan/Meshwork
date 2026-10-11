'use client';

import { useState } from 'react';

import { Button, Field, Kicker, Notice, Panel } from '@/components/ui';
import ui from '@/components/ui.module.css';

import styles from '@/app/(admin)/admin/admin.module.css';

import { adminFetch } from './adminFetch';

type Step = { kind: 'password' } | { kind: 'totp' } | { kind: 'setup'; secret: string; otpauthUri: string };

/** Форма входа персонала: шаг 1 — пароль, шаг 2 — код TOTP (или настройка при первом входе). */
export function AdminLoginForm({ next }: { next: string }) {
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel variant="strong" className={styles.card}>
      <Kicker>Админка платформы</Kicker>
      <h1 className={styles.title}>{step.kind === 'password' ? 'Вход для персонала' : 'Второй фактор'}</h1>
      {step.kind === 'password' ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await adminFetch<{ step: 'totp' } | { step: 'setup'; secret: string; otpauthUri: string }>('/api/admin/auth/login', { body: { email, password } });
              setPassword('');
              setStep(r.step === 'setup' ? { kind: 'setup', secret: r.secret, otpauthUri: r.otpauthUri } : { kind: 'totp' });
            });
          }}
        >
          <Field label="Почта">
            <input className={ui.input} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Пароль">
            <input className={ui.input} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" loading={busy}>Дальше</Button>
        </form>
      ) : (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await adminFetch<{ next: string }>('/api/admin/auth/totp', { body: { code } });
              window.location.assign(next);
            });
          }}
        >
          {step.kind === 'setup' && (
            <>
              <p className={styles.muted}>Двухфакторный вход обязателен. Добавьте ключ в приложение-аутентификатор (по ссылке или вручную) и введите код из него.</p>
              <a href={step.otpauthUri} className={styles.mono}>Открыть в приложении</a>
              <code className={styles.secret}>{step.secret}</code>
            </>
          )}
          <Field label="Код из приложения" hint="6 цифр, обновляется каждые 30 секунд">
            <input className={ui.input} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Button type="submit" loading={busy}>Войти</Button>
        </form>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </Panel>
  );
}
