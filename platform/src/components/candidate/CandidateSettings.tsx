'use client';

import { useEffect, useState } from 'react';
import { acceptConsent, getConsentVersion, getMe, logout, type MeView } from '@/lib/api';
import type { FspState } from '@/server/types';

import { ContactForm } from '../employer/ContactForm';
import { PrivacyToggle } from '../employer/PrivacyToggle';
import { AccountErasure } from '../auth/AccountErasure';
import { Button, Kicker, Notice, Panel } from '../ui';
import styles from './Candidate.module.css';

export function CandidateSettings({ hidden, contact, fspState }: { hidden: boolean; contact: string | null; fspState: FspState }) {
  const [user, setUser] = useState<MeView | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([getMe(), getConsentVersion()]).then(([me, current]) => { if (alive) { setUser(me); setVersion(current); } }).catch((err: Error) => alive && setError(err.message));
    return () => { alive = false; };
  }, []);

  async function consent() {
    if (!version) return;
    setBusy(true); setError(null);
    try { await acceptConsent(version); setUser((value) => value ? { ...value, consent: true } : value); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить согласие.'); }
    finally { setBusy(false); }
  }
  async function exit() {
    setBusy(true); setError(null);
    try { await logout(); window.location.assign('/auth'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось выйти.'); setBusy(false); }
  }

  return <div className={styles.page}>
    <header className={styles.heading}><Kicker>Ваш аккаунт</Kicker><h1>Настройки.</h1><p>Управляйте видимостью профиля, способом связи и согласием на обработку данных.</p></header>
    {error && <Notice tone="error">{error}</Notice>}
    <div className={styles.twoColumns}>
      <div className={styles.stack}>
        <PrivacyToggle hidden={hidden} />
        <AccountErasure />
        <ContactForm contact={contact} />
        <Panel className={styles.card}><h2>В анонимной карточке</h2><dl className={styles.accountFacts}><div><dt>Всегда скрыто</dt><dd>Имя, контакты, цитаты из резюме. Имя и контакт открываются только после принятия приглашения.</dd></div><div><dt>Видно</dt><dd>Категория, специализация и подтверждённые вами утверждения с уровнями доказанности.</dd></div></dl><Button href="/profile" size="sm">Посмотреть профиль ↗</Button></Panel>
      </div>
      <aside className={styles.stack}>
        <Panel className={styles.card}><h2>ФСП ID</h2><p>{fspState === 'linked' ? 'В профиле отмечена связь с ФСП.' : 'ФСП ID не подключён.'}</p><p className={styles.fine}>Реестр ФСП на этом стенде не подключён. Достижения из демонстрационного реестра остаются демоданными. Платформа работает и без истории в ФСП.</p><Button href="/consultant" size="sm">Добавить опыт в диалоге ↗</Button></Panel>
        <Panel className={styles.card}><h2>Согласие</h2><p>{user ? user.consent ? 'Согласие на текущую версию сохранено.' : 'Нужно подтвердить актуальную версию согласия.' : 'Загружаем статус…'}</p>{version && <span className={styles.meta}>Версия {version}</span>}<p className={styles.fine}>Данные обрабатываются на серверах в РФ. Компаниям доступна анонимная карточка; имя и контакт только после принятия приглашения.</p><Button href="/consent" size="sm">Читать текст</Button>{user && !user.consent && <Button size="sm" loading={busy} disabled={!version} onClick={() => void consent()}>Принять согласие</Button>}</Panel>
        <Panel className={styles.card}><h2>Аккаунт</h2>{user ? <dl className={styles.accountFacts}><div><dt>Имя</dt><dd>{user.name}</dd></div><div><dt>Почта</dt><dd>{user.email ?? 'Не указана'}</dd></div><div><dt>Вход</dt><dd>{user.isDemo ? 'Демонстрационный аккаунт' : 'Личный аккаунт'}</dd></div></dl> : <p>Загружаем аккаунт…</p>}<Button loading={busy} onClick={() => void exit()}>Выйти</Button></Panel>
      </aside>
    </div>
  </div>;
}
