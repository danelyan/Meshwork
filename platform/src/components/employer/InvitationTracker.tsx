'use client';

import { useState } from 'react';
import type { EmployerInvitationView } from '@/server/employer/invitations';
import { Button, Notice, Panel } from '@/components/ui';
import { markHiredApi, withdrawInvitationApi } from '@/lib/employer-api';
import { EmployerLiveDefense, LiveSubStatus } from '../live-defense/LiveDefense';
import { CandidateSilhouette } from './CandidateSilhouette';
import { formatDate } from '@/lib/labels';
import { INVITATION_STATUS_LABEL, NO_CANDIDATE_CONTACT, salaryRange } from './labels';
import styles from './Employer.module.css';

const FILTERS = [{ id: 'all', label: 'Все' }, { id: 'pending', label: 'Ждут ответа' }, { id: 'answered', label: 'С ответом' }] as const;
const matches = (status: string, filter: string) => filter === 'all' || (filter === 'pending' ? status === 'sent' || status === 'viewed' : status === 'accepted' || status === 'declined' || status === 'hired' || status === 'withdrawn' || status === 'closed_hired');
/** lane invite-cancel: отозвать можно до найма и до отказа кандидата. */
const withdrawable = (status: string) => status === 'sent' || status === 'viewed' || status === 'accepted';

export function InvitationTracker({ invitations: initial }: { invitations: EmployerInvitationView[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  // lane hired: отметка найма меняет строку на месте, без перезагрузки страницы.
  const [hired, setHired] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // lane invite-cancel: отзыв приглашения с причиной — строка меняется на месте.
  const [withdrawn, setWithdrawn] = useState<Record<string, { at: string; reason: string }>>({});
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const invitations = initial.map((inv) => {
    const w = withdrawn[inv.id];
    if (w) return { ...inv, status: 'withdrawn' as const, withdrawn: w, liveDefense: null, candidate: { ...inv.candidate, contacts: null } };
    return hired[inv.id] ? { ...inv, status: 'hired' as const, hiredAt: hired[inv.id] } : inv;
  });
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
  async function withdraw(id: string) {
    setBusy(id);
    setError(null);
    try {
      const r = await withdrawInvitationApi(id, reason.trim());
      setWithdrawn((w) => ({ ...w, [id]: r.withdrawn }));
      setWithdrawing(null);
      setReason('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отозвать приглашение');
    } finally {
      setBusy(null);
    }
  }
  return <section className={styles.form} aria-label="Приглашения кандидатам">
    <div className={styles.tabs} aria-label="Статус приглашения">{FILTERS.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{invitations.filter((inv) => matches(inv.status, item.id)).length}</span></button>)}</div>
    {error && <Notice tone="error">{error}</Notice>}
    {visible.length === 0 ? <Notice>Приглашений с таким статусом пока нет. Подходящих кандидатов можно найти в подборке или поиске по базе.</Notice> :
      <ul className={styles.list}>{visible.map((inv) => <Panel as="li" key={inv.id} className={styles.card}>
        <div className={styles.cardHead}><div className={styles.identity}><CandidateSilhouette /><div><h2>{inv.candidate.displayName}</h2><p className={styles.meta}>{inv.vacancy?.title ?? 'Без привязки к вакансии'} · {salaryRange(inv.salaryFrom, inv.salaryTo)}</p></div></div><span className={styles.invitationStatus} data-status={inv.status}>{INVITATION_STATUS_LABEL[inv.status]}</span><LiveSubStatus live={inv.liveDefense} /></div>
        <div className={styles.timeline} aria-label="История приглашения">
          <div data-complete="true"><span>Отправлено</span><small>{formatDate(inv.createdAt)}</small></div>
          <div data-complete={Boolean(inv.viewedAt)}><span>Просмотрено</span><small>{inv.viewedAt ? formatDate(inv.viewedAt) : 'Ожидаем'}</small></div>
          <div data-complete={Boolean(inv.respondedAt)}><span>{inv.status === 'declined' ? 'Отклонено' : inv.status === 'accepted' || inv.status === 'hired' ? 'Принято' : 'Ответ кандидата'}</span><small>{inv.respondedAt ? formatDate(inv.respondedAt) : 'Ожидаем'}</small></div>
          {(inv.status === 'accepted' || inv.status === 'hired') && <div data-complete={inv.status === 'hired'}><span>Нанят</span><small>{inv.hiredAt ? formatDate(inv.hiredAt) : 'Отметьте после оффера'}</small></div>}
          {inv.withdrawn && <div data-complete="true"><span>Отозвано</span><small>{formatDate(inv.withdrawn.at)}</small></div>}
        </div>
        {inv.withdrawn && <p className={styles.meta} role="status" data-testid="withdrawn-reason">Вы отозвали приглашение. Причина: {inv.withdrawn.reason}. Кандидат видит статус и причину; контакты и новые данные кандидата закрыты.</p>}
        {inv.message && <p className={styles.text}>{inv.message}</p>}
        {inv.candidate.contacts ? <div className={styles.contacts}><strong>Контакт открыт</strong><span>{inv.candidate.contacts.name}</span><span>{inv.candidate.contacts.contact ?? NO_CANDIDATE_CONTACT}</span></div> : inv.status === 'withdrawn' ? null : <p className={styles.meta}>{inv.status === 'declined' ? 'Кандидат отклонил приглашение. Контакты остаются скрыты.' : 'Имя и контакт откроются после принятия приглашения.'}</p>}
        {/* lane live-slots (ADR 0008): назначение живой защиты — только по принятому приглашению */}
        {(inv.status === 'accepted' || (inv.status === 'hired' && inv.liveDefense)) && <EmployerLiveDefense invitationId={inv.id} live={inv.liveDefense} />}
        {withdrawing === inv.id && withdrawable(inv.status) && <div className={styles.form} data-testid="withdraw-form">
          <label className={styles.meta} htmlFor={`withdraw-${inv.id}`}>Причина отзыва - её увидит кандидат</label>
          <textarea id={`withdraw-${inv.id}`} className={styles.textarea} maxLength={300} placeholder="Например: позиция закрыта" value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className={styles.meta}>{inv.status === 'accepted' ? 'Слоты живой защиты закроются, контакты кандидата перестанут обновляться. ' : ''}Лимит приглашений за сутки отзыв не возвращает.</p>
          <div className={styles.actions}><Button size="sm" variant="primary" disabled={reason.trim().length < 3} loading={busy === inv.id} onClick={() => void withdraw(inv.id)} data-testid="withdraw-confirm">Отозвать</Button><Button size="sm" disabled={busy !== null} onClick={() => { setWithdrawing(null); setReason(''); }}>Не отзывать</Button></div>
        </div>}
        {(inv.status === 'accepted' || inv.vacancy || withdrawable(inv.status)) && <div className={styles.actions}>
          {inv.status === 'accepted' && <Button size="sm" variant="primary" loading={busy === inv.id} onClick={() => void markHired(inv.id)} data-testid="mark-hired">Отметить найм</Button>}
          {withdrawable(inv.status) && withdrawing !== inv.id && <Button size="sm" disabled={busy !== null} onClick={() => { setWithdrawing(inv.id); setReason(''); }} data-testid="withdraw-invitation">Отозвать приглашение</Button>}
          {inv.vacancy && <Button size="sm" href={`/employer/needs/${encodeURIComponent(inv.vacancy.id)}`}>К подборке →</Button>}
        </div>}
      </Panel>)}</ul>}
  </section>;
}
