'use client';

import { useCallback, useEffect, useState } from 'react';

import { type DemoPersona, demoEmployerLogin, demoFreshLogin, demoLogin, getDemoAccounts } from '@/lib/api';
import { safeNext } from '@/server/auth/redirect';
import { FRESH_PERSONA } from '@/server/demo/personas';
import { CONSENT_VERSION } from '@/server/onboarding/consent-text';

import { Button, Notice } from '../ui';

import styles from './DemoPersonas.module.css';

const assign = (path: string) => window.location.assign(path);
const isEmployerPath = (p: string | null) => !!p && (p === '/employer' || p.startsWith('/employer/') || p.startsWith('/employer?'));

export interface PersonasState {
  personas: DemoPersona[] | null;
  error: string | null;
  pending: string | null;
  enter: (p: DemoPersona) => void;
  reload: () => void;
}

/**
 * Загрузка курированных персон и вход выбранной. `next` — уже проверенный путь возврата: кандидату
 * он годится, если не ведёт в /employer, работодателю — наоборот. «Новый пользователь» требует согласия (`agreed`).
 * Полная навигация (assign): push+refresh на холодном dev-сервере давали гонку.
 */
export function useDemoPersonas({ next = null, agreed, navigate = assign, enabled = true }: { next?: string | null; agreed: boolean; navigate?: (path: string) => void; enabled?: boolean }): PersonasState {
  const [personas, setPersonas] = useState<DemoPersona[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const destination = safeNext(next);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getDemoAccounts().then(
      (a) => { if (alive) setPersonas(a.personas ?? [FRESH_PERSONA]); },
      (e: unknown) => { if (alive) { setError(e instanceof Error ? e.message : 'Не удалось загрузить демо-профили.'); setPersonas([]); } },
    );
    return () => { alive = false; };
  }, [attempt, enabled]);

  const enter = useCallback((p: DemoPersona) => {
    if (p.kind === 'fresh' && !agreed) return;
    setPending(p.id);
    setError(null);
    const back = p.kind === 'employer' ? (isEmployerPath(destination) ? destination : null) : (isEmployerPath(destination) ? null : destination);
    const run = p.kind === 'fresh' ? demoFreshLogin(CONSENT_VERSION) : p.kind === 'employer' ? demoEmployerLogin(p.id) : demoLogin(p.id);
    run.then(
      (r) => navigate(back ?? safeNext((r as { next?: string }).next) ?? '/consultant'),
      (e: unknown) => { setError(e instanceof Error ? e.message : 'Не удалось войти. Попробуй ещё раз.'); setPending(null); },
    );
  }, [agreed, destination, navigate]);

  return { personas, error, pending, enter, reload: () => { setPersonas(null); setError(null); setAttempt((n) => n + 1); } };
}

/** Одна персона: номер этапа (или «К»/«С» у компаний), имя с меткой этапа и строка «что увидишь». */
export function PersonaRow({ persona, state, disabledReason }: { persona: DemoPersona; state: PersonasState; disabledReason?: string }) {
  const busy = state.pending !== null;
  const blocked = Boolean(disabledReason);
  return (
    <li>
      <button
        type="button"
        className={styles.row}
        aria-label={persona.kind === 'fresh' ? persona.name : `Войти как ${persona.name}`}
        aria-describedby={blocked ? `${persona.id}-why` : undefined}
        disabled={busy || blocked}
        onClick={() => state.enter(persona)}
      >
        <span className={styles.step} aria-hidden="true">{persona.stage ?? '⌂'}</span>
        <span className={styles.text}>
          <span className={styles.head}>
            <span className={styles.name}>{persona.name}</span>
            <span className={styles.badge}>{persona.badge}</span>
          </span>
          <span className={styles.sees}>{persona.sees}</span>
          {blocked && <span id={`${persona.id}-why`} className={styles.why}>{disabledReason}</span>}
        </span>
        <span className={styles.go} aria-hidden="true">{state.pending === persona.id ? '…' : '→'}</span>
      </button>
    </li>
  );
}

export const specialistsOf = (list: DemoPersona[] | null) => (list ?? []).filter((p) => p.kind !== 'employer' && p.stage !== null);
export const companiesOf = (list: DemoPersona[] | null) => (list ?? []).filter((p) => p.kind === 'employer');

/** Список для окна входа: две группы «Специалисты» (этапы 1…8 по порядку) и «Компании». */
export function PersonaGroups({ state, agreed, columns = false }: { state: PersonasState; agreed: boolean; columns?: boolean }) {
  const specialists = specialistsOf(state.personas);
  const companies = companiesOf(state.personas);
  return (
    <div className={columns ? `${styles.groups} ${styles.cols}` : styles.groups}>
      {state.error && (
        <Notice tone="error">
          {state.error} <Button onClick={state.reload}>Повторить загрузку профилей</Button>
        </Notice>
      )}
      {state.personas === null && !state.error && <p role="status" className={styles.hint}>Загружаю профили…</p>}
      {specialists.length > 0 && (
        <div role="group" aria-label="Специалисты" className={styles.group}>
          <p className={styles.groupTitle}>Специалисты · путь от пустого профиля до найма</p>
          <ol className={styles.list}>
            {specialists.map((p) => <PersonaRow key={p.id} persona={p} state={state} disabledReason={p.kind === 'fresh' && !agreed ? 'Отметь согласие на обработку данных выше' : undefined} />)}
          </ol>
        </div>
      )}
      {companies.length > 0 && (
        <div role="group" aria-label="Компании" className={styles.group}>
          <p className={styles.groupTitle}>Компании</p>
          <ul className={styles.list}>
            {companies.map((p) => <PersonaRow key={p.id} persona={p} state={state} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Компактная кнопка входа для /demo: имя и метка этапа, «что увидишь» — в подсказке (title). */
export function PersonaChip({ persona, state, agreed }: { persona: DemoPersona; state: PersonasState; agreed: boolean }) {
  const blocked = persona.kind === 'fresh' && !agreed;
  return (
    <button
      type="button"
      className={styles.chip}
      title={blocked ? `${persona.sees} Сначала отметь согласие.` : persona.sees}
      aria-label={persona.kind === 'fresh' ? persona.name : `Войти как ${persona.name}`}
      disabled={state.pending !== null || blocked}
      onClick={() => state.enter(persona)}
    >
      <span className={styles.chipStep} aria-hidden="true">{persona.stage ?? '⌂'}</span>
      <span>{persona.name}</span>
      <span className={styles.chipBadge}>{state.pending === persona.id ? 'Вхожу…' : persona.badge}</span>
    </button>
  );
}
