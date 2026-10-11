'use client';

import { type FormEvent, type ReactNode, useState } from 'react';

import { Button, Field, Notice } from '@/components/ui';
import {
  AuthFormError,
  type CodeSent,
  forgotPassword,
  loginEmail,
  registerEmail,
  resendEmailCode,
  resetPasswordWithCode,
  verifyEmailCode,
} from '@/lib/email-auth';
import { CONSENT_VERSION } from '@/server/onboarding/consent-text';

import styles from './AuthEntry.module.css';

type Mode = 'login' | 'register' | 'forgot';
/** form — ввод почты/пароля; verify — код подтверждения почты; reset — код сброса + новый пароль. */
type Stage = 'form' | 'verify' | 'reset';

/**
 * Вход и регистрация по почте (R-D-04): переключение «Регистрация» / «Уже есть аккаунт», ссылка сброса пароля
 * и шаг ввода 6-значного кода из письма. При локальной разработке сервер возвращает код
 * подтверждения (`devCode`) — он показывается здесь; на стенде кода в ответе нет, только письмо.
 */
export function EmailAuth({ next, navigate, agreed, consent }: { next: string | null; navigate: (path: string) => void; agreed: boolean; consent?: ReactNode }) {
  const [mode, setMode] = useState<Mode>('login');
  const [stage, setStage] = useState<Stage>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function switchMode(m: Mode) {
    setMode(m);
    setStage('form');
    setError(null);
    setInfo(null);
    setCode('');
    setDevCode(null);
  }

  function codeSent(r: CodeSent, to: Stage) {
    setStage(to);
    setCode('');
    setDevCode(r.devCode ?? null);
    setInfo(`Если почта ${email.trim()} есть в системе, на неё ушло письмо с кодом. Код действует 15 минут.`);
  }

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      if (err instanceof AuthFormError && err.code === 'email_not_verified') {
        setStage('verify');
        setCode('');
        setDevCode(err.devCode);
        setInfo('Почта ещё не подтверждена: мы отправили новый код.');
      } else {
        setError(err instanceof Error ? err.message : 'Не получилось. Попробуйте ещё раз.');
      }
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const addr = email.trim();
    if (stage === 'verify') {
      return void run(async () => navigate((await verifyEmailCode({ email: addr, code, next })).next));
    }
    if (stage === 'reset') {
      return void run(async () => navigate((await resetPasswordWithCode({ email: addr, code, password, next })).next));
    }
    if (mode === 'login') return void run(async () => navigate((await loginEmail({ email: addr, password, next })).next));
    if (mode === 'register') {
      return void run(async () => codeSent(await registerEmail({ email: addr, password, consent: CONSENT_VERSION }), 'verify'));
    }
    return void run(async () => {
      await forgotPassword({ email: addr });
      setPassword('');
      codeSent({ sent: true }, 'reset');
    });
  }

  const codeStage = stage !== 'form';
  const canSubmit =
    !pending &&
    email.trim().length > 3 &&
    (codeStage
      ? /^\d{6}$/.test(code) && (stage === 'verify' || password.length >= 8)
      : mode === 'forgot' || (mode === 'register' ? password.length >= 8 && agreed : password.length > 0));
  const submitLabel = stage === 'verify' ? 'Подтвердить почту' : stage === 'reset' ? 'Сменить пароль и войти'
    : mode === 'login' ? 'Войти' : mode === 'register' ? 'Получить код' : 'Прислать код';

  return (
    <form className={styles.emailForm} onSubmit={submit} noValidate aria-label="Вход по почте">
      {mode === 'forgot' && <h4 className={styles.resetTitle}>Восстановление пароля</h4>}
      {error && <Notice tone="error">{error}</Notice>}
      {info && <Notice>{info}</Notice>}
      {devCode && (
        <Notice className={styles.devCode}>
          Локальная разработка: код показан, письмо не отправлено. Код: <b>{devCode}</b>
        </Notice>
      )}
      <Field label="Почта">
        <input type="email" name="email" autoComplete="email" inputMode="email" maxLength={254} required
          value={email} readOnly={codeStage} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {codeStage && (
        <Field label="Код из письма" hint="6 цифр">
          <input name="code" autoComplete="one-time-code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </Field>
      )}
      {(stage === 'reset' || (stage === 'form' && mode !== 'forgot')) && (
        <Field label={stage === 'reset' ? 'Новый пароль' : 'Пароль'} hint={mode === 'login' && stage === 'form' ? undefined : 'Не короче 8 символов'}>
          <input type="password" name="password" required minLength={mode === 'login' && stage === 'form' ? 1 : 8} maxLength={128}
            autoComplete={mode === 'login' && stage === 'form' ? 'current-password' : 'new-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      )}
      {consent}
      <Button type="submit" variant="cta" loading={pending} disabled={!canSubmit}>{submitLabel}</Button>
      {stage === 'form' && (
        <div className={styles.emailLinks}>
          {mode === 'login' && <button type="button" className={styles.textAction} disabled={pending} onClick={() => switchMode('register')}>Регистрация</button>}
          {mode === 'register' && <button type="button" className={styles.textAction} disabled={pending} onClick={() => switchMode('login')}>Уже есть аккаунт</button>}
          {mode === 'login' && <button type="button" className={styles.textAction} disabled={pending} onClick={() => switchMode('forgot')}>Забыли пароль?</button>}
          {mode === 'forgot' && <button type="button" className={styles.textAction} disabled={pending} onClick={() => switchMode('login')}>Вернуться ко входу</button>}
        </div>
      )}
      {codeStage && (
        <div className={styles.codeActions}>
          <Button size="sm" disabled={pending} onClick={() => void run(async () => codeSent(stage === 'verify' ? await resendEmailCode({ email: email.trim() }) : await forgotPassword({ email: email.trim() }), stage))}>
              Прислать код ещё раз
          </Button>
          <Button size="sm" disabled={pending} onClick={() => switchMode(mode)}>Изменить почту</Button>
        </div>
      )}
    </form>
  );
}
