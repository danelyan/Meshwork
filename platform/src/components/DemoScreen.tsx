'use client';

import { useEffect, useState } from 'react';

import { type DemoCandidate, type DemoEmployer, demoEmployerLogin, demoFreshLogin, demoLogin, demoRestartOnboarding, getDemoAccounts } from '@/lib/api';

import { CONSENT_VERSION } from '@/server/onboarding/consent-text';

import { ConsentCheck } from './auth/ConsentCheck';
import { Container } from './shell/Container';
import { PageTitle } from './shell/PageTitle';
import styles from './AuthScreen.module.css';
import { Notice } from './ui';
import ui from './ui.module.css';

const SPEC = { backend: 'Backend', frontend: 'Frontend' } as const;

function pluralCandidates(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'кандидат';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'кандидата';
  return 'кандидатов';
}

function Avatar() {
  return (
    <span className={ui.avatar} aria-hidden="true">
      <svg viewBox="0 0 44 44" focusable="false">
        <circle cx="22" cy="16" r="8" />
        <path d="M6 44c1.5-10 8-15 16-15s14.5 5 16 15z" />
      </svg>
    </span>
  );
}

const isEmployerPath = (p: string) => p === '/employer' || p.startsWith('/employer/') || p.startsWith('/employer?');

/**
 * Страница /demo: список демо-аккаунтов для жюри (только при DEMO_LOGIN=true, решает серверная страница).
 * `next` — уже проверенный safeNext путь, откуда прислал guard: после входа готовым аккаунтом ведём туда,
 * если путь подходит роли (кандидат — не /employer, работодатель — /employer…). Онбординг-входы его не используют.
 */
export function DemoScreen({ next = null }: { next?: string | null } = {}) {
  const [accounts, setAccounts] = useState<{ candidates: DemoCandidate[]; employers: DemoEmployer[] } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    let alive = true;
    getDemoAccounts().then(
      (a) => alive && setAccounts({ candidates: a.candidates, employers: a.employers ?? [] }),
      (e: unknown) => {
        if (!alive) return;
        setFailure(e instanceof Error ? e.message : 'Не удалось загрузить демо-аккаунты.');
        setAccounts({ candidates: [], employers: [] });
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  async function enter(key: string, run: () => Promise<{ next?: string }>, fallback: string, back: string | null = null) {
    setPending(key);
    setFailure(null);
    try {
      const r = await run();
      // Полная навигация: push+refresh подряд на холодном dev-сервере давали гонку (refresh /demo перебивал переход).
      window.location.assign(back ?? r.next ?? fallback);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Не удалось войти.');
      setPending(null);
    }
  }

  // Кандидаты пула работодателя (demo-pool-*) не нужны для знакомства с консультантом: прячем под спойлер.
  const mainCandidates = (accounts?.candidates ?? []).filter((c) => !c.id.startsWith('demo-pool-'));
  const poolCandidates = (accounts?.candidates ?? []).filter((c) => c.id.startsWith('demo-pool-'));
  const candidateItem = (c: DemoCandidate) => (
    <li key={c.id}>
      <button
        type="button"
        className={styles.item}
        aria-label={`Войти как ${c.name}`}
        disabled={pending !== null}
        onClick={() => void enter(c.id, () => demoLogin(c.id), '/consultant', next && !isEmployerPath(next) ? next : null)}
      >
        <Avatar />
        <span className={styles.who}>
          <span className={styles.name}>{c.name}</span>
          <span className={styles.sub}>кандидат · {c.specialization ? SPEC[c.specialization] : 'специализация не выбрана'}</span>
        </span>
        <span className={`${ui.tag} ${ui.outline}`} aria-hidden="true">
          {pending === c.id ? 'Вхожу…' : 'Войти →'}
        </span>
      </button>
      <button
        type="button"
        className={styles.restart}
        aria-label={`Пройти онбординг заново: ${c.name}`}
        disabled={pending !== null}
        onClick={() => void enter(`r-${c.id}`, () => demoRestartOnboarding({ restartCandidateId: c.id }), '/onboarding')}
      >
        пройти онбординг заново
      </button>
    </li>
  );


  return (
    <Container size="wide" className={styles.wrap}>
      <PageTitle
        kicker="ФСП Карьера · демо для жюри"
        title="Демо-аккаунты"
        lead="Готовые вымышленные пользователи с синтетическими данными. Настоящий вход - через Яндекс ID на странице входа."
      />

      {failure && <Notice tone="error">{failure}</Notice>}

      <div className={styles.grid}>
      <section className={styles.block} aria-labelledby="demo-fresh">
        <h2 id="demo-fresh" className={styles.blockTitle}>
          Новый пользователь - пройти онбординг
        </h2>
        <p className={ui.hint}>Создаёт чистый аккаунт без роли: онбординг-чат сразу спросит, кто ты - специалист или работодатель.</p>
        <ConsentCheck checked={agreed} onChange={setAgreed} />
        <button
          type="button"
          className={`${ui.btn} ${ui.cta}`}
          disabled={pending !== null || !agreed}
          onClick={() => void enter('fresh', () => demoFreshLogin(CONSENT_VERSION), '/onboarding')}
        >
          {pending === 'fresh' ? 'Создаю…' : 'Новый пользователь'}
        </button>
      </section>
      <section className={styles.block} aria-labelledby="auth-demo">
        <h2 id="auth-demo" className={styles.blockTitle}>
            Демо-вход
        </h2>
        <p className={ui.hint}>Без аккаунта: готовые вымышленные пользователи с синтетическими данными.</p>
          {accounts === null && (
          <p className={ui.muted} role="status">
            <span className={ui.spinner} aria-hidden="true" /> Загружаю список…
          </p>
          )}
          {accounts && (
          <>
            <p className={styles.group}>Кандидаты</p>
              {accounts.candidates.length === 0 && <p className={ui.muted}>Демо-кандидатов нет.</p>}
            <ul className={styles.list}>{mainCandidates.map(candidateItem)}</ul>
              {poolCandidates.length > 0 && (
              <details className={styles.more}>
                <summary>ещё {poolCandidates.length} {pluralCandidates(poolCandidates.length)} для подборки</summary>
                <ul className={styles.list}>{poolCandidates.map(candidateItem)}</ul>
              </details>
              )}
            <p className={styles.group}>Работодатели</p>
              {accounts.employers.length === 0 && <p className={ui.muted}>Демо-работодателей нет.</p>}
            <ul className={styles.list}>
                {accounts.employers.map((e) => (
                <li key={e.id}>
                  <button
                      type="button"
                      className={styles.item}
                      aria-label={`Войти как ${e.name}`}
                      disabled={pending !== null}
                      onClick={() => void enter(e.id, () => demoEmployerLogin(e.id), '/employer', next && isEmployerPath(next) ? next : null)}
                    >
                    <Avatar />
                    <span className={styles.who}>
                      <span className={styles.name}>{e.name}</span>
                      <span className={styles.sub}>работодатель{e.company ? ` · ${e.company.name}` : ''}</span>
                    </span>
                    <span className={`${ui.tag} ${ui.outline}`} aria-hidden="true">
                        {pending === e.id ? 'Вхожу…' : 'Войти →'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.restart}
                    aria-label={`Пройти онбординг заново: ${e.name}`}
                    disabled={pending !== null}
                    onClick={() => void enter(`r-${e.id}`, () => demoRestartOnboarding({ restartUserId: e.id }), '/onboarding')}
                  >
                    пройти онбординг заново
                  </button>
                </li>
                ))}
            </ul>
          </>
          )}
      </section>
      </div>
    </Container>
  );
}
