'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Field, Kicker, Meter, Notice } from '@/components/ui';
import { chooseRoleApi, demoEmployerLogin, demoFreshLogin, demoLogin, getDemoAccounts } from '@/lib/api';
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
  const [role, setRole] = useState<Role | null>(null);
  const [step, setStep] = useState(1);
  const [accounts, setAccounts] = useState<{candidates: DemoCandidate[]; employers?: DemoEmployer[]} | null>(null);
  const [error, setError] = useState<string | null>(initialError ? initialError === 'consent_required'
    ? 'Чтобы войти, отметь согласие на обработку персональных данных.'
    : initialError === 'state' ? 'Сеанс входа устарел. Попробуй ещё раз.'
    : 'Не удалось завершить вход. Попробуй ещё раз.' : null);
  const [pending, setPending] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [company, setCompany] = useState('');
  const created = useRef(false);
  const destination = safeNext(next);
  const employerPath = destination?.split(/[?#]/)[0];
  const roleNext = role === 'employer'
    ? employerPath === '/employer' || employerPath?.startsWith('/employer/') ? destination : null
    : employerPath === '/employer' || employerPath?.startsWith('/employer/') ? null : destination;

  useEffect(() => {
    if (step !== 2 || !demoEnabled) return;
    let alive = true;
    getDemoAccounts().then(data => { if (alive) setAccounts(data); }, err => {
      if (alive) setError(err instanceof Error ? err.message : 'Не удалось загрузить профили.');
    });
    return () => { alive = false; };
  }, [step, demoEnabled]);

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

  async function newProfile() {
    if (!created.current) { await demoFreshLogin(CONSENT_VERSION); created.current = true; }
    await chooseRoleApi(role === 'employer' ? {role,companyName:company.trim()} : {role:'candidate'});
    return {next:'/onboarding'};
  }

  return <div onKeyDown={event => {
    if (step !== 1 || (event.target as HTMLElement).matches('input,textarea,select')) return;
    if (event.key === '1') setRole('candidate');
    if (event.key === '2') setRole('employer');
    if (event.key === 'Enter' && role) { event.preventDefault(); setStep(2); }
  }}>
    <header className={styles.header}>
      <div className={styles.progress}><Meter value={step} max={2} label={`Шаг ${step} из 2`} /></div>
      <span className={styles.count}>{step} / 2</span>
      <Button className={styles.close} aria-label="Закрыть окно входа" onClick={onClose}>×</Button>
    </header>
    <div className={styles.body}>
      <Kicker>{step === 1 ? 'Знакомство' : 'ФСП Карьера · вход'}</Kicker>
      <h2 id="auth-entry-title" className={styles.title}>{step === 1 ? 'Кто вы?' : 'Начнём с входа'}</h2>
      <p className={styles.lead}>{step === 1 ? 'Помощник подстроится под вашу задачу.' : 'Опыт, навыки и цели обсудим уже с ИИ-помощником.'}</p>
      {error && <Notice tone="error">{error}</Notice>}
      {step === 1 ? <>
        <div className={styles.choices}>
          {([['candidate','Ищу работу','Кандидат · Star — компании пишут вам первыми'],['employer','Ищу специалистов','Работодатель · Scout — вы пишете кандидатам']] as const).map(([value,label,note], i) =>
            <Button key={value} className={styles.choice} aria-pressed={role === value} onClick={() => setRole(value)}>
              <span className={styles.number}>{i + 1}</span><span className={styles.label}><b>{label}</b><small>{note}</small></span><span className={styles.check} aria-hidden="true" />
            </Button>)}
        </div>
        <Button variant="cta" className={styles.continue} disabled={!role} onClick={() => setStep(2)}>Продолжить →</Button>
        <p className={styles.hint}>1–2 — выбрать · Enter — дальше · Esc — закрыть</p>
      </> : <>
        <div className={styles.methods}>
          <section className={styles.method} aria-label="Вход на платформу">
            <h3>Войти на платформу</h3>
            <EmailAuth next={roleNext} navigate={navigate} />
            <p className={styles.or}>или</p>
            <YandexSignIn enabled={yandexEnabled} next={roleNext} />
            {!yandexEnabled && <p id="yandex-off" className={styles.hint}>Вход через Яндекс не настроен на этом стенде.</p>}
            <p className={styles.hint}>ФСП ID пока не подключён. Для входа используйте почту, Яндекс ID{demoEnabled ? ' или демо-профиль' : ''}.</p>
          </section>
          {demoEnabled && <section className={styles.method} aria-label="Демо-профиль">
            <h3>Демо-профиль</h3>
            <p className={styles.hint}>Вымышленные данные, вход без пароля.</p>
            {!accounts && !error && <p role="status">Загружаю профили…</p>}
            <div className={styles.list}>
              {role === 'candidate' ? accounts?.candidates.filter(c=>!c.id.startsWith('demo-pool-')).map(c=>
                <Button className={styles.account} disabled={pending} key={c.id} onClick={()=>void enter(()=>demoLogin(c.id),'/consultant',roleNext)}>{c.name} →</Button>)
                : accounts?.employers?.map(e=><Button className={styles.account} disabled={pending} key={e.id} onClick={()=>void enter(()=>demoEmployerLogin(e.id),'/employer/assistant',roleNext ?? '/employer/assistant')}>{e.company?.name ?? e.name} →</Button>)}
            </div>
            <Button disabled={pending} onClick={()=>setFresh(!fresh)} aria-expanded={fresh}>Новый демо-профиль</Button>
            {fresh && <>
              {role === 'employer' && <Field label="Название компании"><input maxLength={120} value={company} onChange={e=>setCompany(e.target.value)} /></Field>}
              <ConsentCheck checked={agreed} onChange={setAgreed} />
              <Button variant="cta" loading={pending} disabled={!agreed || role === 'employer' && company.trim().length < 2} onClick={()=>void enter(newProfile,'/onboarding')}>К ИИ-помощнику →</Button>
            </>}
          </section>}
        </div>
        <footer className={styles.footer}>
          <Button disabled={pending || created.current} onClick={()=>{setStep(1);setError(null);setFresh(false);}}>← Назад</Button>
          {pending && <span role="status">Входим…</span>}
        </footer>
      </>}
    </div>
  </div>;
}
