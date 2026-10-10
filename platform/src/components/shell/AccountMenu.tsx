'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type FocusEvent, type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { VisuallyHidden } from '@/components/ui/VisuallyHidden';
import { demoLogout, switchRoleApi } from '@/lib/api';
import type { ActiveRole, RoleMenu } from '@/server/auth/role-plan';

import styles from './shell.module.css';

const ROLE_LABEL = { candidate: 'Кандидат', employer: 'Работодатель' } as const;
const BECOME_LABEL = { candidate: 'Стать кандидатом', employer: 'Стать работодателем' } as const;

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
 * почтой, ролями, ссылкой «Профиль компании» (работодатель) и «Выйти». Сделано как disclosure (кнопка с
 * `aria-expanded`/`aria-controls` + панель), а не `role=menu`: в панели есть форма создания профиля, а меню-семантика
 * её не допускает. Стрелки ↑/↓ ходят по пунктам, Escape закрывает и возвращает фокус на кнопку, клик вне,
 * уход фокуса (Tab) и переход по ссылке закрывают.
 * Роль: второй профиль есть - переключаем сразу; нет - шаг подтверждения (профиль с ПДн одним кликом не создаём;
 * работодателю - ещё и название компании); общий демо-аккаунт - пункт неактивен. После ответа - полная
 * навигация на `next`: дом обеих ролей один адрес /consultant, клиентское состояние прежней роли должно сброситься.
 */
export function AccountMenu({ menu, navigate = fullNavigation }: { menu: RoleMenu; navigate?: Navigate }) {
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
  const needsCompany = !menu.otherExists && menu.other === 'employer';

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
    if (role === menu.role || busy) return;
    if (menu.otherExists) void go({ role });
    else setConfirming(true);
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

  const logout = async () => {
    try {
      await demoLogout();
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
    if (role === 'employer') return menu.role === 'employer' && menu.companyName ? `Работодатель · ${menu.companyName}` : ROLE_LABEL.employer;
    return ROLE_LABEL.candidate;
  };
  const demoLocked = !menu.otherExists && !menu.canCreateOther;

  const roleItem = (role: ActiveRole) => {
    const active = role === menu.role;
    const locked = !active && demoLocked;
    return (
      <button
        key={role}
        type="button"
        className={styles.menuItem}
        aria-current={active ? 'true' : undefined}
        disabled={locked}
        onClick={() => pickRole(role)}
      >
        <span className={styles.radio} aria-hidden="true" data-on={active || undefined} />
        <span>{roleLabel(role)}</span>
        {active && <VisuallyHidden> (активная роль)</VisuallyHidden>}
        {locked && <span className={styles.menuHint}>Недоступно на демо-аккаунте</span>}
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
          {initialsOf(menu.userName, menu.userEmail)}
        </span>
        <span className={styles.accountRole}>
          <VisuallyHidden>Аккаунт, активная роль: </VisuallyHidden>
          {ROLE_LABEL[menu.role]}
        </span>
        <span className={styles.chevron} aria-hidden="true" data-open={open || undefined} />
      </button>
      {open && (
        <div id={panelId} ref={panel} className={styles.accountPanel}>
          <div className={styles.menuHead}>
            <strong>{menu.userName}</strong>
            {menu.userEmail && <span>{menu.userEmail}</span>}
          </div>
          <div className={styles.menuGroup} role="group" aria-label="Роль">
            {roleItem('employer')}
            {roleItem('candidate')}
          </div>
          {confirming && (
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
          {error && !confirming && (
            <p role="alert" className={styles.roleError}>
              {error}
            </p>
          )}
          {menu.role === 'employer' && (
            <Link className={styles.menuItem} href="/employer/company">
              Профиль компании
            </Link>
          )}
          <hr className={styles.menuSep} />
          <button type="button" className={styles.menuItem} onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}
