'use client';

import { useEffect, useState } from 'react';
import { acceptConsent, getConsentVersion, getMe, logout, onboardingAct, type MeView } from '@/lib/api';
import { setPrivacyApi } from '@/lib/employer-api';
import type { FspLinkView } from '@/server/fsp-id/link';
import type { FspState } from '@/server/types';

import { ContactForm } from '../employer/ContactForm';
import { AccountErasure } from '../auth/AccountErasure';
import { Button, Kicker, Notice, Panel } from '../ui';
import styles from './Candidate.module.css';

const FSP_RESULT_TEXT: Record<string, { tone: 'info' | 'error'; text: string }> = {
  linked: { tone: 'info', text: 'ФСП ID привязан, достижения подтянуты из реестра.' },
  no_achievements: { tone: 'info', text: 'ФСП ID привязан. Истории соревнований нет - на подбор это не влияет.' },
  unavailable: { tone: 'info', text: 'ФСП ID привязан, но реестр достижений сейчас не отвечает. Профиль работает без него.' },
  error_denied: { tone: 'error', text: 'Вход в ФСП ID отменён.' },
  error_state: { tone: 'error', text: 'Сеанс привязки устарел или подменён. Начните привязку заново.' },
  error_session: { tone: 'error', text: 'Привязку начали из другого аккаунта. Начните заново.' },
  error_exchange: { tone: 'error', text: 'ФСП ID не выдал токен. Попробуйте ещё раз.' },
  error_token: { tone: 'error', text: 'ID-токен ФСП ID не прошёл проверку. Привязка не выполнена.' },
  error_unavailable: { tone: 'error', text: 'Сервер ФСП ID сейчас не отвечает. Попробуйте позже - профиль работает и без привязки.' },
  error_internal: { tone: 'error', text: 'Не удалось привязать ФСП ID. Попробуйте позже.' },
};

function fspStateText(state: FspState, name: string | null): string {
  const who = name ? ` (${name})` : '';
  switch (state) {
    case 'linked': return `ФСП ID привязан${who}.`;
    case 'no_achievements': return `ФСП ID привязан${who}, достижений пока нет.`;
    case 'unavailable': return `ФСП ID привязан${who}, реестр достижений сейчас недоступен.`;
    default: return 'ФСП ID не подключён.';
  }
}

function FspIdCard({ fsp, result, provider, onDialog, dialogBusy }: { fsp: FspLinkView; result: string | null; provider: 'external' | 'mock'; onDialog: () => void; dialogBusy: boolean }) {
  const [busy, setBusy] = useState(false);
  const notice = result ? FSP_RESULT_TEXT[result] : undefined;
  return <Panel className={styles.card}>
    <h2>ФСП ID</h2>
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    <p>{fspStateText(fsp.state, fsp.name)}</p>
    {fsp.achievements.length > 0 && <ul className={styles.requirements}>{fsp.achievements.map((a) => <li key={`${a.event}-${a.year}`}>{a.event}, {a.year}: {a.result}; роль: {a.role} <span className={styles.meta}>(демо-данные)</span></li>)}</ul>}
    <p className={styles.fine}>{provider === 'external'
      ? 'Вход через симулятор ФСП ID на Keycloak (OIDC), достижения - из API симулятора реестра. Это стенд команды, а не сервис ФСП: спортсмены и результаты синтетические. Платформа работает и без истории в ФСП.'
      : 'Вход через демонстрационный провайдер ФСП ID внутри платформы (OIDC, пути как у Keycloak). Настоящий реестр ФСП не подключён: участники и результаты - демо-данные. Платформа работает и без истории в ФСП.'}</p>
    <Button size="sm" loading={busy} onClick={() => { setBusy(true); window.location.assign('/api/fsp-id/link'); }}>{fsp.subject ? 'Привязать другой ФСП ID' : 'Привязать ФСП ID'}</Button>
    <Button size="sm" loading={dialogBusy} onClick={onDialog}>Добавить опыт в диалоге ↗</Button>
  </Panel>;
}

export function CandidateSettings({ hidden, contact, fspState, fsp, fspProvider = 'mock', fspResult = null }: { hidden: boolean; contact: string | null; fspState: FspState; fsp?: FspLinkView; fspProvider?: 'external' | 'mock'; fspResult?: string | null }) {
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
  async function openFspStep() {
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
        <FspIdCard fsp={fsp ?? { state: fspState, subject: null, name: null, achievements: [] }} result={fspResult} provider={fspProvider} onDialog={() => void openFspStep()} dialogBusy={busy} />
        <Panel className={styles.card}><h2>Согласие</h2><p>{user ? user.consent ? 'Согласие на текущую версию сохранено.' : 'Нужно подтвердить актуальную версию согласия.' : 'Загружаем статус…'}</p>{version && <span className={styles.meta}>Версия {version}</span>}<p className={styles.fine}>Данные обрабатываются на серверах в РФ. Компаниям доступна анонимная карточка; имя и контакт только после принятия приглашения.</p><Button href="/consent" size="sm">Читать текст</Button>{user && !user.consent && <Button size="sm" loading={busy} disabled={!version} onClick={() => void consent()}>Принять согласие</Button>}</Panel>
        <Panel className={styles.card}><h2>Аккаунт</h2>{user ? <dl className={styles.accountFacts}><div><dt>Имя</dt><dd>{user.name}</dd></div><div><dt>Почта</dt><dd>{user.email ?? 'Не указана'}</dd></div><div><dt>Вход</dt><dd>{user.isDemo ? 'Демонстрационный аккаунт' : 'Личный аккаунт'}</dd></div></dl> : <p>Загружаем аккаунт…</p>}<Button loading={busy} onClick={() => void exit()}>Выйти</Button></Panel>
        <AccountErasure />
      </aside>
    </div>
  </div>;
}
