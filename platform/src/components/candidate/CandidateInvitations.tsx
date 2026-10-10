'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { respondInvitationApi } from '@/lib/employer-api';
import { formatDate } from '@/lib/labels';
import type { CandidateInvitationView } from '@/server/employer/invitations';

import { ContactForm } from '../employer/ContactForm';
import { INVITATION_STATUS_LABEL, NO_COMPANY_CONTACT, salaryRange } from '../employer/labels';
import { Button, Kicker, Notice, Panel, Tag } from '../ui';
import styles from './Candidate.module.css';

type Filter = 'all' | 'open' | 'accepted' | 'declined';
const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'Все' }, { id: 'open', label: 'Новые' }, { id: 'accepted', label: 'Принятые' }, { id: 'declined', label: 'Отклонённые' }];
const isOpen = (status: CandidateInvitationView['status']) => status === 'sent' || status === 'viewed';

export function CandidateInvitations({ invitations, contact }: { invitations: CandidateInvitationView[]; contact: string | null }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [local, setLocal] = useState<Record<string, CandidateInvitationView['status']>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = invitations.map((inv) => ({ ...inv, status: local[inv.id] ?? inv.status }));
  const matches = (inv: CandidateInvitationView, value: Filter) => value === 'all' || (value === 'open' ? isOpen(inv.status) : value === inv.status);
  const visible = current.filter((inv) => matches(inv, filter));

  async function respond(id: string, action: 'accept' | 'decline') {
    setBusy(id);
    setError(null);
    try {
      const result = await respondInvitationApi(id, action);
      // Only known server states may update the contact disclosure message.
      if (result.status !== 'accepted' && result.status !== 'declined') throw new Error('Сервер не подтвердил ответ. Обновите страницу.');
      const status = result.status;
      setLocal((value) => ({ ...value, [id]: status }));
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось ответить на приглашение.'); }
    finally { setBusy(null); }
  }

  return <div className={styles.page}>
    <header className={styles.heading}><Kicker>Предложения компаний</Kicker><h1>Приглашения.</h1><p>Вилка, причина и способ связи видны сразу. Компания получит ваше имя и контакт, только когда вы примете приглашение.</p></header>
    <div className={styles.tabs} aria-label="Статус приглашения">{FILTERS.map((item) => <Button key={item.id} size="sm" aria-pressed={filter === item.id} className={filter === item.id ? styles.activeTab : undefined} onClick={() => setFilter(item.id)}>{item.label} · {current.filter((inv) => matches(inv, item.id)).length}</Button>)}</div>
    {error && <Notice tone="error">{error}</Notice>}
    <div className={styles.twoColumns}>
      <div className={styles.stack}>
        {!visible.length ? <Panel className={styles.empty}><h2>Здесь пока пусто.</h2><p>{invitations.length ? 'Приглашений с этим статусом пока нет.' : 'Подтверждайте опыт и навыки: компании смогут найти ваш профиль и отправить предложение.'}</p><Button href="/profile">Открыть профиль</Button></Panel> : visible.map((inv) => <Panel key={inv.id} as="article" className={styles.card} aria-labelledby={`inv-${inv.id}`}>
          <div className={styles.cardHead}><div><span className={styles.letter} aria-hidden="true">{inv.company.name.slice(0, 1)}</span><div><Kicker>{inv.company.name}</Kicker><h2 id={`inv-${inv.id}`}>{inv.vacancy?.title ?? 'Предложение компании'}</h2></div></div><Tag>{INVITATION_STATUS_LABEL[inv.status]}</Tag></div>
          <div><p className={styles.salary}>{salaryRange(inv.salaryFrom, inv.salaryTo)}</p><span className={styles.meta}>в месяц{inv.vacancy ? ` · ${inv.vacancy.grade}` : ''}</span></div>
          {inv.redFlags && inv.redFlags.length > 0 && <Notice tone="error" role="note" aria-label="Признаки фиктивного предложения">{inv.redFlags.map((f) => f.candidateNote).join(' ')}</Notice>}
          <div><h3>Почему именно вы</h3><p>{inv.message || 'Компания не добавила сообщение к приглашению.'}</p></div>
          {inv.vacancy?.teamDescription && <p>Команда: {inv.vacancy.teamDescription}</p>}
          {inv.vacancy?.stack.length ? <p className={styles.meta}>Стек: {inv.vacancy.stack.join(', ')}</p> : null}
          <p className={styles.meta}>Связь с компанией: {inv.company.contact ?? NO_COMPANY_CONTACT}</p>
          {inv.company.trust && <p className={styles.meta}>Индекс доверия компании: {inv.company.trust.index} из 100 (концепция: по заполненности профиля, ИНН, возрасту аккаунта и доле отклонений; не гарантия).</p>}
          <div className={styles.timeline}><span>Получено<b>{formatDate(inv.createdAt)}</b></span>{inv.respondedAt && <span>Ответ отправлен<b>{formatDate(inv.respondedAt)}</b></span>}</div>
          {isOpen(inv.status) ? <><div className={styles.actions}><Button variant="primary" disabled={busy !== null} loading={busy === inv.id} onClick={() => void respond(inv.id, 'accept')}>Принять</Button><Button disabled={busy !== null} onClick={() => void respond(inv.id, 'decline')}>Отклонить</Button></div><p className={styles.fine}>Приняв, вы откроете этой компании имя и контакт. Остальные компании их не увидят.</p></> : <p role="status">{inv.status === 'accepted' ? 'Контакты открыты: эта компания видит ваше имя и способ связи.' : 'Вы отклонили приглашение. Компания видит только статус.'}</p>}
        </Panel>)}
      </div>
      <aside className={styles.stack}>
        <ContactForm contact={contact} />
        <Panel className={styles.card}><Kicker>Как это работает</Kicker><ol className={styles.requirements}><li>01 · Компания находит анонимную карточку по навыкам и категории.</li><li>02 · Отправляет предложение с зарплатой и способом связи.</li><li>03 · Вы принимаете или отклоняете. Обе стороны видят статус.</li></ol><Button size="sm" href="/settings">Настройки приватности ↗</Button></Panel>
      </aside>
    </div>
  </div>;
}
