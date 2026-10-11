'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { LevelBadge } from '@/components/LevelBadge';
import { APPLICATION_STATUS_LABEL, answerApplicationApi, vacancyApplicationsApi } from '@/lib/applications-api';
import { formatDate } from '@/lib/labels';
import type { EmployerApplicationView } from '@/server/employer/applications';

import { Button, Kicker, Notice, Panel } from '../ui';
import { CandidateSilhouette } from './CandidateSilhouette';
import styles from './Employer.module.css';
import { NO_CANDIDATE_CONTACT } from './labels';

/**
 * Отклики на потребность (R-C-12). Карточка – та же, что в подборке (toCandidateCard): псевдоним и публичные
 * утверждения до принятия; имя и контакт – после «Принять», если кандидат не отозвал раскрытие (R-E-07).
 */
export function VacancyApplications({ vacancyId }: { vacancyId: string }) {
  const [items, setItems] = useState<EmployerApplicationView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let alive = true;
    vacancyApplicationsApi(vacancyId).then(
      ({ applications }) => alive && setItems(applications),
      (err: Error) => alive && setError(err.message),
    );
    return () => { alive = false; };
  }, [vacancyId, revision]);

  async function answer(id: string, action: 'accept' | 'decline') {
    setBusy(id);
    setError(null);
    try { await answerApplicationApi(id, action); setRevision((n) => n + 1); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось ответить на отклик.'); }
    finally { setBusy(null); }
  }

  return <Panel as="section" aria-labelledby="vacancy-applications" data-testid="vacancy-applications">
    <Kicker>Кандидаты сами</Kicker><h2 id="vacancy-applications">Отклики{items ? ` · ${items.length}` : ''}</h2>
    {error && <Notice tone="error">{error}</Notice>}
    {!items ? (!error && <p role="status">Загружаем отклики…</p>) : !items.length ? <p className={styles.meta}>Откликов пока нет. Основной путь – подборка и приглашения выше.</p> : <ul className={styles.list}>{items.map((a) => {
      const card = a.candidate;
      const open = a.status === 'sent' || a.status === 'viewed';
      return <li key={a.id} className={styles.candidateRow}>
        <CandidateSilhouette />
        <div className={styles.candidateRowBody}>
          <h3>{card.displayName}</h3>
          <p>{card.category?.label ?? 'Без категории из теста'}{card.fsp.hasAchievements && ' · ФСП'} · отклик {APPLICATION_STATUS_LABEL[a.status]} {formatDate(a.createdAt)}</p>
          {a.message && <p>{a.message}</p>}
          {a.closed && <p className={styles.meta} role="status">Отклик закрыт: {a.closed.reason}.</p>}
          {a.invitationId && <p className={styles.meta}>Отклик принят - создано приглашение: <Link href="/employer/invitations">слоты живой защиты и отметка найма</Link>.</p>}
          <div className={styles.claims}>{card.claims.map((claim) => <span key={claim.catalogId} className={styles.claim}><LevelBadge level={claim.level} />{claim.statement}</span>)}</div>
          {card.contacts ? <div className={styles.contacts}><strong>{card.contacts.name}</strong><span>{card.contacts.contact ?? NO_CANDIDATE_CONTACT}</span></div>
            : a.status === 'accepted' ? <p className={styles.meta}>Кандидат отозвал раскрытие: имя и контакты скрыты.</p>
            : <p className={styles.meta}>Имя и контакты откроются после принятия отклика.</p>}
        </div>
        {open && <div className={styles.actions}><Button variant="primary" size="sm" disabled={busy !== null} loading={busy === a.id} onClick={() => void answer(a.id, 'accept')}>Принять</Button><Button size="sm" disabled={busy !== null} onClick={() => void answer(a.id, 'decline')}>Отклонить</Button></div>}
      </li>;
    })}</ul>}
  </Panel>;
}
