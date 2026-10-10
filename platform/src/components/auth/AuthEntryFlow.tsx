'use client';

import { useEffect, useState } from 'react';
import { Button, Kicker, Notice } from '@/components/ui';
import { demoEmployerLogin, demoFreshLogin, demoLogin, getDemoAccounts } from '@/lib/api';
import type { DemoCandidate, DemoEmployer } from '@/lib/api';
import { CONSENT_VERSION } from '@/server/onboarding/consent-text';
import { safeNext } from '@/server/auth/redirect';
import { ConsentCheck } from './ConsentCheck';
import { EmailAuth } from './EmailAuth';
import { YandexSignIn } from './YandexSignIn';
import styles from './AuthEntry.module.css';

type Role = 'candidate' | 'employer';
const assign = (path: string) => window.location.assign(path);

export function AuthEntryFlow({ yandexEnabled, demoEnabled, next, onClose, navigate = assign, error: initialError = null }: {
  yandexEnabled: boolean; demoEnabled: boolean; next: string | null; error?: string | null; onClose: () => void; navigate?: (path: string) => void;
}) {
  const [accounts, setAccounts] = useState<{candidates: DemoCandidate[]; employers?: DemoEmployer[]} | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountsAttempt, setAccountsAttempt] = useState(0);
  const [error, setError] = useState<string | null>(initialError ? initialError === 'consent_required'
    ? 'Чтобы войти, отметь согласие на обработку персональных данных.'
    : initialError === 'state' ? 'Сеанс входа устарел. Попробуй ещё раз.'
    : initialError === 'fsp_denied' ? 'Вход через ФСП ID отменён.'
    : initialError === 'fsp_unavailable' ? 'ФСП ID сейчас не отвечает. Войди по почте или попробуй позже.'
    : initialError.startsWith('fsp_') ? 'ФСП ID не подтвердил вход. Попробуй ещё раз.'
    : 'Не удалось завершить вход. Попробуй ещё раз.' : null);
  const [pending, setPending] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [fresh, setFresh] = useState(false);
  const destination = safeNext(next);
  const employerPath = destination?.split(/[?#]/)[0];
  const toEmployer = employerPath === '/employer' || employerPath?.startsWith('/employer/');
  // Куда вернуть после входа: ссылку кабинета работодателя — только работодателю, остальное — только кандидату.
  const backFor = (role: Role) => role === 'employer' ? (toEmployer ? destination : null) : (toEmployer ? null : destination);

  useEffect(() => {
    if (!demoEnabled) return;
    let alive = true;
    setAccountsError(null);
    getDemoAccounts().then(data => { if (alive) setAccounts(data); }, err => {
      if (alive) setAccountsError(err instanceof Error ? err.message : 'Не удалось загрузить профили.');
    });
    return () => { alive = false; };
  }, [demoEnabled, accountsAttempt]);

  const candidates = accounts?.candidates.filter(candidate => !candidate.id.startsWith('demo-pool-')) ?? [];
  const employers = accounts?.employers ?? [];

  async function enter(run: () => Promise<{next?: string}>, fallback: string, back: string | null = null) {
    setPending(true); setError(null);
    try {
      const result = await run();
      navigate(back ?? safeNext(result.next) ?? fallback);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти. Попробуй ещё раз.');
      setPending(false);
    }
  }

  // Роль при входе не спрашиваем (владелец 11.10: «зачем для входа выбирать роль? роль это при регистрации ведь только»):
  // почта и Яндекс узнают аккаунт, а новому аккаунту роль задаёт первый вопрос знакомства в чате («Ты здесь как кто?»).
  return <div>
    <header className={styles.header}>
      <Kicker>ФСП Карьера · вход</Kicker>
      <Button className={styles.close} aria-label="Закрыть окно входа" onClick={onClose}>×</Button>
    </header>
    <div className={styles.body}>
      <h2 id="auth-entry-title" className={styles.title}>Вход</h2>
      <p className={styles.lead}>Новый аккаунт? Кто ты - специалист или компания - спросит ИИ-помощник первым вопросом.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className={styles.methods}>
        <section className={styles.method} aria-label="Вход на платформу">
          <h3>Войти на платформу</h3>
          <EmailAuth next={destination} navigate={navigate} />
          <p className={styles.or}>или</p>
          <YandexSignIn enabled={yandexEnabled} next={destination} fsp />
          {!yandexEnabled && <p id="yandex-off" className={styles.hint}>Вход через Яндекс не настроен на этом стенде.</p>}
          <p className={styles.hint}>ФСП ID - вход спортсмена ФСП: аккаунт специалиста, достижения сразу попадут в профиль. Реестр ФСП на стенде - симулятор с синтетическими участниками.</p>
        </section>
        {demoEnabled && <section className={styles.method} aria-label="Демо-профиль">
          <h3>Демо-профиль</h3>
          <p className={styles.hint}>Вымышленные данные, вход без пароля.</p>
          {!accounts && !accountsError && <p role="status">Загружаю профили…</p>}
          {accountsError && <>
            <Notice tone="error">{accountsError}</Notice>
            <Button onClick={() => { setAccounts(null); setAccountsAttempt(attempt => attempt + 1); }}>Повторить загрузку профилей</Button>
          </>}
          {accounts && <div className={styles.list}>
            {candidates.length > 0 && <div role="group" aria-label="Специалисты" className={styles.group}>
              <p className={styles.groupTitle}>Специалисты</p>
              {candidates.map(c => <Button className={styles.account} disabled={pending} key={c.id} onClick={() => void enter(() => demoLogin(c.id), '/consultant', backFor('candidate'))}>{c.name} →</Button>)}
            </div>}
            {employers.length > 0 && <div role="group" aria-label="Компании" className={styles.group}>
              <p className={styles.groupTitle}>Компании</p>
              {employers.map(e => <Button className={styles.account} disabled={pending} key={e.id} onClick={() => void enter(() => demoEmployerLogin(e.id), '/consultant', backFor('employer') ?? '/consultant')}>{e.company?.name ?? e.name} →</Button>)}
            </div>}
            {candidates.length === 0 && employers.length === 0 && <p className={styles.hint}>Готовых профилей пока нет. Можно создать новый демо-профиль.</p>}
          </div>}
          <Button disabled={pending} onClick={() => setFresh(!fresh)} aria-expanded={fresh}>Новый демо-профиль</Button>
          {fresh && <>
            <ConsentCheck checked={agreed} onChange={setAgreed} />
            <Button variant="cta" loading={pending} disabled={!agreed} onClick={() => void enter(async () => { await demoFreshLogin(CONSENT_VERSION); return { next: '/consultant' }; }, '/consultant')}>К ИИ-помощнику →</Button>
          </>}
        </section>}
      </div>
      {pending && <p role="status" className={styles.hint}>Входим…</p>}
    </div>
  </div>;
}
