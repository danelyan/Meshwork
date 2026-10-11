'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type FocusEvent, type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Popover } from '@/components/ui/Reveal';
import { VisuallyHidden } from '@/components/ui/VisuallyHidden';
import { logout as logoutApi, switchRoleApi } from '@/lib/api';
import type { ActiveRole, HeaderAccount } from '@/server/auth/role-plan';

import styles from './shell.module.css';

const ROLE_LABEL = { candidate: 'Кандидат', employer: 'Работодатель' } as const;
const BECOME_LABEL = { candidate: 'Стать кандидатом', employer: 'Стать работодателем' } as const;
/** Тихий пункт внизу меню, когда второго профиля нет: роль не выдаём за существующую. */
const CREATE_ITEM = { candidate: 'Ищу работу - создать профиль кандидата', employer: 'Я ещё и нанимаю - создать компанию' } as const;

/** Куда ведёт переход после ответа API; вынесено, чтобы тест подменил навигацию. */
export type Navigate = (href: string) => void;
const fullNavigation: Navigate = (href) => window.location.assign(href);

const CREATE_TEXT = {
  candidate: 'Создадим профиль кандидата на этой же учётке: имя и почта - из учётки, согласие уже дано. Дальше - знакомство в ленте консультанта.',
  employer: 'Создадим профиль работодателя и новую компанию на этой же учётке. Дальше - знакомство в ленте помощника.',
} as const;

const ITEMS = 'button:not(:disabled), a[href]';

/** Инициалы из имени (до двух слов); пустое имя - первая буква почты или «?». */
export function initialsOf(name: string, email: string | null): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0]);
  const s = letters.join('') || (email ? Array.from(email.trim())[0] : '') || '?';
  return s.toUpperCase();
}

/**
 * Меню аккаунта в шапке (ADR 0004): кружок с инициалами, активная роль и шеврон; по клику - панель с именем и
 * почтой, ролями, ссылкой «Профиль компании» (работодатель) и «Выйти». Роль не выбрана (`roles` null, знакомство) -
 * на кнопке подпись «Аккаунт», в панели только имя, почта и «Выйти». Сделано как disclosure (кнопка с
 * `aria-expanded`/`aria-controls` + панель), а не `role=menu`: в панели есть форма создания профиля, а меню-семантика
 * её не допускает. Стрелки ↑/↓ ходят по пунктам, Escape закрывает и возвращает фокус на кнопку, клик вне,
 * уход фокуса (Tab) и переход по ссылке закрывают.
 * Роль: переключатель ролей показываем, только когда оба профиля есть (решение владельца 10.10 «показывать честно»).
 * Второго профиля нет - внизу тихий пункт «создать…» и шаг подтверждения (профиль с ПДн одним кликом не создаём;
 * работодателю - ещё и название компании); на общем демо-аккаунте этого пункта нет. После ответа - полная
 * навигация на `next`: дом обеих ролей один адрес /consultant, клиентское состояние прежней роли должно сброситься.
 */
export function AccountMenu({ account, navigate = fullNavigation }: { account: HeaderAccount; navigate?: Navigate }) {
  const menu = account.roles;
  const pathname = usePathname();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [company, setCompany] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const needsCompany = menu !== null && !menu.otherExists && menu.other === 'employer';

  const reset = () => {
    setOpen(false);
    setConfirming(false);
    setError(null);
  };
  const close = (refocus: boolean) => {
    reset();
    if (refocus) trigger.current?.focus();
  };

  // Переход по ссылке (в т.ч. «Профиль компании») - меню закрывается.
  useEffect(reset, [pathname]);

  // Клик вне меню закрывает его.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) reset();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const go = async (body: Parameters<typeof switchRoleApi>[0]) => {
    // Двойной клик до перерисовки (кнопка ещё не заблокирована) - второй запрос не уходит.
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { next } = await switchRoleApi(body);
      navigate(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сменить роль');
      setBusy(false);
      inFlight.current = false;
    }
  };

  const pickRole = (role: ActiveRole) => {
    if (!menu?.otherExists || role === menu.role || busy) return;
    void go({ role });
  };

  const onConfirm = (e: FormEvent) => {
    e.preventDefault();
    if (!needsCompany) {
      void go({ role: 'candidate' });
      return;
    }
    const name = company.trim();
    if (name.length < 2) {
      setError('Название компании - от 2 символов');
      return;
    }
    void go({ role: 'employer', companyName: name });
  };

  // Выход - POST /api/auth/logout (с проверкой Origin), а не демо-маршрут DELETE /api/demo/login.
  const logout = async () => {
    try {
      await logoutApi();
    } finally {
      window.location.assign('/');
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items[i < 0 ? (step === 1 ? 0 : items.length - 1) : (i + step + items.length) % items.length]?.focus();
  };

  // Tab уводит фокус за пределы меню - закрываем, не держим ловушку.
  const onBlur = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (open && next && !root.current?.contains(next)) reset();
  };

  const roleLabel = (role: ActiveRole) => {
    if (role === 'employer') return menu?.companyName ? `Работодатель · ${menu.companyName}` : ROLE_LABEL.employer;
    return ROLE_LABEL.candidate;
  };
  const canCreate = menu !== null && !menu.otherExists && menu.canCreateOther;

  const roleItem = (role: ActiveRole) => {
    const active = role === menu?.role;
    return (
      <button
        key={role}
        type="button"
        className={styles.menuItem}
        aria-current={active ? 'true' : undefined}
        onClick={() => pickRole(role)}
      >
        <span className={styles.radio} aria-hidden="true" data-on={active || undefined} />
        <span className={styles.menuLabel}>{roleLabel(role)}</span>
        {active && <VisuallyHidden> (активная роль)</VisuallyHidden>}
      </button>
    );
  };

  return (
    <div className={styles.account} ref={root} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={trigger}
        type="button"
        className={styles.accountBtn}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span className={styles.avatar} aria-hidden="true">
          {initialsOf(menu?.role === 'employer' ? menu.companyName || account.userName : account.userName, account.userEmail)}
        </span>
        <span className={styles.accountRole}>
          {menu ? (
            <>
              <VisuallyHidden>Аккаунт, активная роль: {ROLE_LABEL[menu.role]}</VisuallyHidden>
              <span aria-hidden="true">{menu.role === 'employer' ? menu.companyName || ROLE_LABEL.employer : account.userName}</span>
            </>
          ) : (
            'Аккаунт'
          )}
        </span>
        <span className={styles.chevron} aria-hidden="true" data-open={open || undefined} />
      </button>
      <Popover open={open} id={panelId} ref={panel} className={styles.accountPanel} style={{ transformOrigin: 'top right' }}>
          <div className={styles.menuHead}>
            <strong>{account.userName}</strong>
            {account.userEmail && <span>{account.userEmail}</span>}
          </div>
          {menu?.otherExists && (
            <div className={styles.menuGroup} role="group" aria-label="Роль">
              {roleItem('employer')}
              {roleItem('candidate')}
            </div>
          )}
          {error && !confirming && (
            <p role="alert" className={styles.roleError}>
              {error}
            </p>
          )}
          {menu?.role === 'employer' && (
            <Link className={styles.menuItem} href="/employer/company">
              Профиль компании
            </Link>
          )}
          {menu && canCreate && !confirming && (
            <button type="button" className={`${styles.menuItem} ${styles.menuQuiet}`} onClick={() => setConfirming(true)}>
              {CREATE_ITEM[menu.other]}
            </button>
          )}
          {menu && canCreate && confirming && (
            <form className={styles.rolePanel} onSubmit={onConfirm} aria-label={BECOME_LABEL[menu.other]}>
              <p className={styles.roleText}>{CREATE_TEXT[menu.other]}</p>
              {needsCompany ? (
                <Field label="Название компании" error={error ?? undefined}>
                  <input className={styles.roleInput} value={company} onChange={(e) => setCompany(e.target.value)} maxLength={120} autoFocus autoComplete="organization" />
                </Field>
              ) : (
                error && (
                  <p role="alert" className={styles.roleError}>
                    {error}
                  </p>
                )
              )}
              <div className={styles.roleActions}>
                <Button type="submit" size="sm" variant="primary" loading={busy} autoFocus={!needsCompany}>
                  Создать
                </Button>
                <Button size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                  Отмена
                </Button>
              </div>
            </form>
          )}
          <hr className={styles.menuSep} />
          <button type="button" className={styles.menuItem} onClick={() => void logout()}>
            Выйти
          </button>
      </Popover>
    </div>
  );
}
