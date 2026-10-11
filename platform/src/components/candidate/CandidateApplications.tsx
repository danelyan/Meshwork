'use client';

import { useState } from 'react';

import { APPLICATION_STATUS_LABEL, revokeApplicationDisclosureApi } from '@/lib/applications-api';
import { formatDate } from '@/lib/labels';
import type { CandidateApplicationView } from '@/server/employer/applications';

import { Button, Kicker, Notice, Panel, Tag } from '../ui';
import styles from './Candidate.module.css';

/** Мои отклики (R-C-12): статус, даты и раскрытие контактов по каждому отклику. */
export function CandidateApplications({ applications }: { applications: CandidateApplicationView[] }) {
  const [revoked, setRevoked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string) {
    setBusy(id);
    setError(null);
    try { await revokeApplicationDisclosureApi(id); setRevoked((v) => ({ ...v, [id]: true })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось отозвать раскрытие.'); }
    finally { setBusy(null); }
  }

  return <section className={styles.page} aria-labelledby="my-applications">
    <header className={styles.heading}><Kicker>Сами откликнулись</Kicker><h2 id="my-applications">Мои отклики<i>.</i></h2><p>Компания видит анонимную карточку, как в подборке. Имя и контакт откроются, только если она примет отклик.</p></header>
    {error && <Notice tone="error">{error}</Notice>}
    {!applications.length ? <Panel className={styles.empty}><p>Откликов пока нет. Откликнуться можно на карте вакансий.</p><Button href="/career">К вакансиям</Button></Panel> : <div className={styles.stack}>{applications.map((a) => {
      const disclosed = a.disclosed && !revoked[a.id];
      return <Panel key={a.id} as="article" className={styles.card} aria-labelledby={`app-${a.id}`} data-testid="my-application">
        <div className={styles.cardHead}><div><Kicker>{a.vacancy.companyName}</Kicker><h3 id={`app-${a.id}`}>{a.vacancy.title}</h3></div><Tag className={styles.invitationStatus} data-status={a.status}>{APPLICATION_STATUS_LABEL[a.status]}</Tag></div>
        <p className={styles.meta}>Отправлен {formatDate(a.createdAt)}{a.viewedAt ? ` · просмотрен ${formatDate(a.viewedAt)}` : ''}{a.respondedAt ? ` · ответ ${formatDate(a.respondedAt)}` : ''}{a.vacancy.archived ? ' · вакансия закрыта' : ''}</p>
        {a.message && <p>{a.message}</p>}
        {a.status === 'accepted' ? (disclosed ? <div role="status"><p>Компания приняла отклик и видит ваше имя и способ связи.</p><Button size="sm" disabled={busy !== null} onClick={() => void revoke(a.id)}>Отозвать раскрытие</Button><p className={styles.fine}>После отзыва компания снова видит псевдоним. Данные, которые она уже получила, отозвать невозможно.</p></div> : <p role="status">Раскрытие отозвано: компания видит псевдоним.</p>)
          : a.status === 'declined' ? <p role="status">Компания отклонила отклик. Контакты ей не раскрывались.</p>
          : disclosed ? <div><p className={styles.fine}>Ждём ответа. Если компания примет отклик, она увидит имя и контакт.</p><Button size="sm" disabled={busy !== null} onClick={() => void revoke(a.id)}>Отозвать раскрытие</Button></div>
          : <p className={styles.fine}>Раскрытие отозвано: даже приняв отклик, компания увидит только псевдоним.</p>}
      </Panel>;
    })}</div>}
  </section>;
}
