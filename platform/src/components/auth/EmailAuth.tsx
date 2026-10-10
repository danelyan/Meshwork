'use client';

import { type FormEvent, useState } from 'react';

import { Button, Chip, Field, Notice } from '@/components/ui';
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

import { ConsentCheck } from './ConsentCheck';
import styles from './AuthEntry.module.css';

type Mode = 'login' | 'register' | 'forgot';
/** form — ввод почты/пароля; verify — код подтверждения почты; reset — код сброса + новый пароль. */
type Stage = 'form' | 'verify' | 'reset';

const MODES: [Mode, string][] = [
  ['login', 'Войти'],
  ['register', 'Регистрация'],
  ['forgot', 'Забыли пароль'],
];

/**
 * Вход и регистрация по почте (R-D-04): вкладки «Войти» / «Регистрация» / «Забыли пароль»
 * и шаг ввода 6-значного кода из письма. На демо-стенде сервер возвращает код подтверждения
 * (`demoCode`) — он показывается здесь, чтобы жюри прошло регистрацию без доступа к ящику.
 */
export function EmailAuth({ next, navigate }: { next: string | null; navigate: (path: string) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [stage, setStage] = useState<Stage>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function switchMode(m: Mode) {
    setMode(m);
    setStage('form');
    setError(null);
    setInfo(null);
    setCode('');
    setDemoCode(null);
  }

  function codeSent(r: CodeSent, to: Stage) {
    setStage(to);
    setCode('');
    setDemoCode(r.demoCode ?? null);
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
        setDemoCode(err.demoCode);
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
    : mode === 'login' ? 'Войти по почте' : mode === 'register' ? 'Получить код' : 'Прислать код';

  return (
    <form className={styles.emailForm} onSubmit={submit} noValidate aria-label="Вход по почте">
      <div className={styles.modes} role="group" aria-label="Способ">
        {MODES.map(([m, label]) => (
          <Chip key={m} pressed={mode === m} onClick={() => switchMode(m)} disabled={pending}>{label}</Chip>
        ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {info && <Notice>{info}</Notice>}
      {demoCode && (
        <Notice className={styles.demoCode}>
          Демо-стенд: письма идут в Mailpit, ящик жюри недоступен. Ваш код: <b>{demoCode}</b>
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
      {mode === 'register' && stage === 'form' && <ConsentCheck checked={agreed} onChange={setAgreed} />}
      <Button type="submit" variant="cta" loading={pending} disabled={!canSubmit}>{submitLabel}</Button>
      {codeStage && (
        <div className={styles.codeActions}>
          {stage === 'verify' && (
            <Button size="sm" disabled={pending} onClick={() => void run(async () => codeSent(await resendEmailCode({ email: email.trim() }), 'verify'))}>
              Прислать код ещё раз
            </Button>
          )}
          <Button size="sm" disabled={pending} onClick={() => switchMode(mode)}>Изменить почту</Button>
        </div>
      )}
    </form>
  );
}
