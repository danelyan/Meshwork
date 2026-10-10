'use client';

import { useEffect, useState } from 'react';
import { acceptConsent, getConsentVersion, getMe, logout, onboardingAct, type MeView } from '@/lib/api';
import { setPrivacyApi } from '@/lib/employer-api';
import type { FspState } from '@/server/types';

import { ContactForm } from '../employer/ContactForm';
import { AccountErasure } from '../auth/AccountErasure';
import { Button, Kicker, Notice, Panel } from '../ui';
import styles from './Candidate.module.css';

export function CandidateSettings({ hidden, contact, fspState }: { hidden: boolean; contact: string | null; fspState: FspState }) {
  const [user, setUser] = useState<MeView | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [privateProfile, setPrivateProfile] = useState(hidden);
  async function visibility() {
    setBusy(true); setError(null);
    try { setPrivateProfile((await setPrivacyApi(!privateProfile)).hiddenFromEmployers); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить видимость.'); }
    finally { setBusy(false); }
  }
  async function fsp() {
    setBusy(true); setError(null);
    try { await onboardingAct({ action: 'goto', stepId: 'fsp' }); window.location.assign('/consultant?edit=profile'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось открыть подключение.'); setBusy(false); }
  }
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
    <header className={styles.heading}><Kicker>Ваш аккаунт</Kicker><h1>Настройки<i>.</i></h1><p>Управляйте видимостью профиля, способом связи и согласием на обработку данных.</p></header>
    {error && <Notice tone="error">{error}</Notice>}
    <div className={styles.twoColumns}>
      <div className={styles.stack}>
        <Panel className={styles.settingsPrivacy}><div className={styles.sectionLabel}>Приватность</div><div><section><h3>Профиль виден компаниям</h3><p>Анонимная карточка участвует в поиске. Имя и контакт откроются только после принятия приглашения.</p></section><button className={styles.switch} type="button" aria-label="Профиль виден компаниям" aria-pressed={!privateProfile} disabled={busy} onClick={() => void visibility()}><i /></button></div><p className={styles.meta} role="status">{privateProfile ? 'Сейчас профиль скрыт из поиска' : 'Сейчас профиль участвует в подборках'}</p><dl className={styles.privacyFields}><div><dt>Категория и специализация</dt><dd>Видно</dd></div><div><dt>Подтверждённые утверждения и их уровень</dt><dd>Видно</dd></div><div><dt>Отметка ФСП</dt><dd>Видно · демо</dd></div><div><dt>Город, зарплатные ожидания</dt><dd>Скрыто</dd></div><div><dt>Имя и контакты</dt><dd>По приглашению</dd></div><div><dt>Цитаты и исходные ссылки</dt><dd>Скрыто</dd></div></dl><p className={styles.fine}>Поля карточки определяются правилами сервиса. Отдельные переключатели для этих полей пока не поддерживаются.</p><Button href="/profile">Посмотреть анонимную карточку →</Button></Panel>
        <ContactForm contact={contact} />
        <Panel className={styles.card}><h2>В анонимной карточке</h2><dl className={styles.accountFacts}><div><dt>Всегда скрыто</dt><dd>Имя, контакты, цитаты из резюме. Имя и контакт открываются только после принятия приглашения.</dd></div><div><dt>Видно</dt><dd>Категория, специализация и подтверждённые вами утверждения с уровнями доказанности.</dd></div></dl><Button href="/profile" size="sm">Посмотреть профиль ↗</Button></Panel>
      </div>
      <aside className={styles.stack}>
        <Panel className={styles.card}><h2>ФСП ID</h2><p>{fspState === 'linked' ? 'В профиле отмечена связь с ФСП.' : 'ФСП ID не подключён.'}</p><p className={styles.fine}>Реестр ФСП на этом стенде не подключён. Достижения из демонстрационного реестра остаются демоданными. Платформа работает и без истории в ФСП.</p><Button size="sm" loading={busy} onClick={() => void fsp()}>{fspState === 'linked' ? 'Изменить связь' : 'Подключить ФСП ID'} · демо ↗</Button></Panel>
        <Panel className={styles.card}><h2>Согласие</h2><p>{user ? user.consent ? 'Согласие на текущую версию сохранено.' : 'Нужно подтвердить актуальную версию согласия.' : 'Загружаем статус…'}</p>{version && <span className={styles.meta}>Версия {version}</span>}<p className={styles.fine}>Данные обрабатываются на серверах в РФ. Компаниям доступна анонимная карточка; имя и контакт только после принятия приглашения.</p><Button href="/consent" size="sm">Читать текст</Button>{user && !user.consent && <Button size="sm" loading={busy} disabled={!version} onClick={() => void consent()}>Принять согласие</Button>}</Panel>
        <Panel className={styles.card}><h2>Аккаунт</h2>{user ? <dl className={styles.accountFacts}><div><dt>Имя</dt><dd>{user.name}</dd></div><div><dt>Почта</dt><dd>{user.email ?? 'Не указана'}</dd></div><div><dt>Вход</dt><dd>{user.isDemo ? 'Демонстрационный аккаунт' : 'Личный аккаунт'}</dd></div></dl> : <p>Загружаем аккаунт…</p>}<Button loading={busy} onClick={() => void exit()}>Выйти</Button></Panel>
        <AccountErasure />
      </aside>
    </div>
  </div>;
}
