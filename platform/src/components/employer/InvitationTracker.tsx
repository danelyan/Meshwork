'use client';

import { useState } from 'react';
import type { EmployerInvitationView } from '@/server/employer/invitations';
import { Button, Notice, Panel } from '@/components/ui';
import { markHiredApi } from '@/lib/employer-api';
import { CandidateSilhouette } from './CandidateSilhouette';
import { formatDate } from '@/lib/labels';
import { INVITATION_STATUS_LABEL, NO_CANDIDATE_CONTACT, salaryRange } from './labels';
import styles from './Employer.module.css';

const FILTERS = [{ id: 'all', label: 'Все' }, { id: 'pending', label: 'Ждут ответа' }, { id: 'answered', label: 'С ответом' }] as const;
const matches = (status: string, filter: string) => filter === 'all' || (filter === 'pending' ? status === 'sent' || status === 'viewed' : status === 'accepted' || status === 'declined' || status === 'hired');

export function InvitationTracker({ invitations: initial }: { invitations: EmployerInvitationView[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  // lane hired: отметка найма меняет строку на месте, без перезагрузки страницы.
  const [hired, setHired] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invitations = initial.map((inv) => (hired[inv.id] ? { ...inv, status: 'hired' as const, hiredAt: hired[inv.id] } : inv));
  const visible = invitations.filter((inv) => matches(inv.status, filter));
  async function markHired(id: string) {
    setBusy(id);
    setError(null);
    try {
      const r = await markHiredApi(id);
      setHired((h) => ({ ...h, [id]: r.hiredAt }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отметить найм');
    } finally {
      setBusy(null);
    }
  }
  return <section className={styles.form} aria-label="Приглашения кандидатам">
    <div className={styles.tabs} aria-label="Статус приглашения">{FILTERS.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{invitations.filter((inv) => matches(inv.status, item.id)).length}</span></button>)}</div>
    {error && <Notice tone="error">{error}</Notice>}
    {visible.length === 0 ? <Notice>Приглашений с таким статусом пока нет. Подходящих кандидатов можно найти в подборке или поиске по базе.</Notice> :
      <ul className={styles.list}>{visible.map((inv) => <Panel as="li" key={inv.id} className={styles.card}>
        <div className={styles.cardHead}><div className={styles.identity}><CandidateSilhouette /><div><h2>{inv.candidate.displayName}</h2><p className={styles.meta}>{inv.vacancy?.title ?? 'Без привязки к вакансии'} · {salaryRange(inv.salaryFrom, inv.salaryTo)}</p></div></div><span className={styles.invitationStatus} data-status={inv.status}>{INVITATION_STATUS_LABEL[inv.status]}</span></div>
        <div className={styles.timeline} aria-label="История приглашения">
          <div data-complete="true"><span>Отправлено</span><small>{formatDate(inv.createdAt)}</small></div>
          <div data-complete={Boolean(inv.viewedAt)}><span>Просмотрено</span><small>{inv.viewedAt ? formatDate(inv.viewedAt) : 'Ожидаем'}</small></div>
          <div data-complete={Boolean(inv.respondedAt)}><span>{inv.status === 'declined' ? 'Отклонено' : inv.status === 'accepted' || inv.status === 'hired' ? 'Принято' : 'Ответ кандидата'}</span><small>{inv.respondedAt ? formatDate(inv.respondedAt) : 'Ожидаем'}</small></div>
          {(inv.status === 'accepted' || inv.status === 'hired') && <div data-complete={inv.status === 'hired'}><span>Нанят</span><small>{inv.hiredAt ? formatDate(inv.hiredAt) : 'Отметьте после оффера'}</small></div>}
        </div>
        {inv.message && <p className={styles.text}>{inv.message}</p>}
        {inv.candidate.contacts ? <div className={styles.contacts}><strong>Контакт открыт</strong><span>{inv.candidate.contacts.name}</span><span>{inv.candidate.contacts.contact ?? NO_CANDIDATE_CONTACT}</span></div> : <p className={styles.meta}>{inv.status === 'declined' ? 'Кандидат отклонил приглашение. Контакты остаются скрыты.' : 'Имя и контакт откроются после принятия приглашения.'}</p>}
        {(inv.status === 'accepted' || inv.vacancy) && <div className={styles.actions}>
          {inv.status === 'accepted' && <Button size="sm" variant="primary" loading={busy === inv.id} onClick={() => void markHired(inv.id)} data-testid="mark-hired">Отметить найм</Button>}
          {inv.vacancy && <Button size="sm" href={`/employer/needs/${encodeURIComponent(inv.vacancy.id)}`}>К подборке →</Button>}
        </div>}
      </Panel>)}</ul>}
  </section>;
}
