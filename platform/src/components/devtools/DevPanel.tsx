'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { COMPANION_SAY_EVENT } from '@/components/avatar/events';
import { Button, Kicker } from '@/components/ui';
import { CONSENT_VERSION } from '@/server/onboarding/consent-text';

import styles from './DevPanel.module.css';

interface Me {
  id: string;
  name: string;
  role: 'pending' | 'candidate' | 'employer';
  isDemo: boolean;
  onboarded: boolean;
}
interface Accounts {
  candidates: { id: string; name: string }[];
  employers: { id: string; name: string }[];
}
type Action =
  | 'new-conversation'
  | 'reset-onboarding'
  | 'delete-account'
  | 'new-user'
  | 'reset-test-attempts'
  | 'login-as'
  | 'logout';

const OPEN_KEY = 'fsp:devpanel:open';
const TOAST_KEY = 'fsp:devpanel:toast';

function storeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storeSet(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* хранилище недоступно - панель работает без запоминания */
  }
}

const ROLE_LABEL = { pending: 'роль не выбрана', candidate: 'кандидат', employer: 'работодатель' } as const;

/**
 * Дебаг-панель: монтируется только на localhost (DevPanelGate). Плавающая кнопка, поповер с быстрыми действиями.
 * После действия - жёсткий переход (чат хранит состояние в клиенте), тост показывается после перезагрузки.
 */
export function DevPanel() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [alsoProfile, setAlsoProfile] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((text: string, error = false) => {
    setToast({ text, error });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    if (storeGet(OPEN_KEY) === '1') setOpen(true);
    const pending = storeGet(TOAST_KEY);
    if (pending) {
      storeSet(TOAST_KEY, null);
      showToast(pending);
    }
  }, [showToast]);

  const setOpenPersist = useCallback((v: boolean) => {
    setOpen(v);
    if (!v) setConfirmDelete(false);
    storeSet(OPEN_KEY, v ? '1' : null);
  }, []);

  // Ctrl+Shift+D, Esc, клик вне
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setOpenPersist(!open);
      } else if (e.key === 'Escape' && open) {
        setOpenPersist(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (open && rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenPersist(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, setOpenPersist]);

  // кто я и список демо-аккаунтов - при открытии и смене страницы
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((j: { user: (Me & { role: Me['role'] }) | null }) => alive && setMe(j.user))
      .catch(() => alive && setMe(null));
    fetch('/api/dev/login-as')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Accounts | null) => alive && setAccounts(j))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open, pathname]);

  async function run(action: Action, body?: unknown, doneText = 'выполнено') {
    setBusy(action);
    try {
      const res = await fetch(`/api/dev/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const json = (await res.json().catch(() => ({}))) as { next?: string; error?: { message?: string }; deleted?: number };
      if (!res.ok) {
        showToast(json.error?.message ?? `Ошибка ${res.status}`, true);
        return;
      }
      const text = action === 'reset-test-attempts' ? `Готово: удалено попыток ${json.deleted ?? 0}` : `Готово: ${doneText}`;
      storeSet(TOAST_KEY, text);
      setConfirmDelete(false);
      const keep = action === 'reset-test-attempts';
      window.location.assign(keep ? pathname : (json.next ?? '/'));
    } catch {
      showToast('Сеть недоступна', true);
    } finally {
      setBusy(null);
    }
  }

  const onOnboarding = pathname === '/onboarding' || pathname.startsWith('/onboarding/');
  const isCandidate = me?.role === 'candidate';
  const signedIn = !!me;

  return (
    <div className={styles.root} ref={rootRef} data-devpanel>
      {toast && (
        <div className={`${styles.toast} ${toast.error ? styles.toastErr : ''}`} role="status">
          {toast.text}
        </div>
      )}
      {open && (
        <div className={styles.pop} role="dialog" aria-label="Дебаг-панель">
          <div className={styles.head}>
            <Kicker>Дебаг · localhost</Kicker>
            <span className={styles.mono}>Ctrl+Shift+D</span>
          </div>
          <div className={styles.who}>
            {me === undefined ? (
              <span>Загрузка…</span>
            ) : me ? (
              <>
                <strong>{me.name}</strong>
                <span>
                  {ROLE_LABEL[me.role]}
                  {me.isDemo ? ' · демо' : ''}
                  {me.onboarded ? '' : ' · онбординг не пройден'}
                </span>
                <span className={styles.mono}>userId {me.id.slice(0, 10)}…</span>
              </>
            ) : (
              <span>Не вошёл</span>
            )}
            <span className={styles.mono}>{pathname}</span>
          </div>

          {confirmDelete ? (
            <div className={styles.confirm} role="alertdialog" aria-label="Подтверждение удаления">
              <p className={styles.confirmText}>
                Удалить аккаунт «{me?.name}» и все его данные? Необратимо.
                {me?.isDemo ? ' Это демо-аккаунт; если он из сида - вернуть: npm run db:seed.' : ''}
              </p>
              <div className={styles.row}>
                <Button variant="danger" size="sm" loading={busy === 'delete-account'} onClick={() => run('delete-account', undefined, 'Аккаунт удалён')}>
                  Удалить
                </Button>
                <Button size="sm" onClick={() => setConfirmDelete(false)}>
                  Отмена
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.group}>
                <Button
                  size="sm"
                  className={styles.grow}
                  disabled={!signedIn || busy !== null}
                  loading={busy === (onOnboarding ? 'reset-onboarding' : 'new-conversation')}
                  onClick={() =>
                    onOnboarding
                      ? run('reset-onboarding', { alsoProfile }, 'Онбординг очищен')
                      : run('new-conversation', undefined, 'Новый диалог')
                  }
                >
                  Начать диалог заново
                </Button>
                <Button
                  size="sm"
                  className={styles.grow}
                  disabled={!signedIn || busy !== null}
                  loading={busy === 'reset-onboarding'}
                  onClick={() => run('reset-onboarding', { alsoProfile }, 'Онбординг очищен')}
                >
                  Очистить онбординг
                </Button>
                <label className={styles.check}>
                  <input type="checkbox" checked={alsoProfile} onChange={(e) => setAlsoProfile(e.target.checked)} />и ответы профиля
                </label>
                <Button
                  size="sm"
                  className={styles.grow}
                  disabled={!isCandidate || busy !== null}
                  loading={busy === 'reset-test-attempts'}
                  onClick={() => run('reset-test-attempts')}
                >
                  Сбросить попытки теста
                </Button>
                <Button
                  size="sm"
                  className={styles.grow}
                  disabled={!signedIn}
                  title="Аватар в чате произносит тестовую фразу (на странице консультанта или онбординга)"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent(COMPANION_SAY_EVENT, { detail: { text: 'Привет! Я компаньон ФСП Карьеры. Так звучит озвучка ответов: текст синтезирует SpeechKit, а рот двигается по громкости.' } }),
                    )
                  }
                >
                  Озвучить тест
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  className={styles.grow}
                  disabled={!signedIn || busy !== null}
                  onClick={() => setConfirmDelete(true)}
                >
                  Очистить аккаунт…
                </Button>
              </div>
              <div className={styles.group}>
                <Button size="sm" className={styles.grow} disabled={busy !== null} loading={busy === 'new-user'} onClick={() => run('new-user', { consent: CONSENT_VERSION }, 'Новый пользователь')}
                  title="Создаёт демо-гостя с согласием на текущую версию текста (как галка на /demo)">
                  Новый пользователь
                </Button>
                {accounts && (accounts.candidates.length > 0 || accounts.employers.length > 0) && (
                  <select
                    className={styles.select}
                    aria-label="Войти как"
                    value=""
                    disabled={busy !== null}
                    onChange={(e) => {
                      const [kind, id] = e.target.value.split(':');
                      if (!id) return;
                      void run('login-as', kind === 'e' ? { employerUserId: id } : { candidateId: id }, 'Вход выполнен');
                    }}
                  >
                    <option value="">Войти как…</option>
                    {accounts.candidates.map((c) => (
                      <option key={c.id} value={`c:${c.id}`}>
                        {c.name} · кандидат
                      </option>
                    ))}
                    {accounts.employers.map((u) => (
                      <option key={u.id} value={`e:${u.id}`}>
                        {u.name} · работодатель
                      </option>
                    ))}
                  </select>
                )}
                <Button size="sm" className={styles.grow} disabled={!signedIn || busy !== null} loading={busy === 'logout'} onClick={() => run('logout', undefined, 'Вы вышли')}>
                  Выйти
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <button type="button" className={styles.fab} aria-label="Дебаг-панель" aria-expanded={open} onClick={() => setOpenPersist(!open)}>
        dev
      </button>
    </div>
  );
}
