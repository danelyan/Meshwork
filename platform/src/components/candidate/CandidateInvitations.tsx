'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { revokeConsentApi } from '@/lib/consent-api';
import { respondInvitationApi } from '@/lib/employer-api';
import { CONSENT_TEXTS } from '@/server/consent/texts';
import { formatDate } from '@/lib/labels';
import type { CandidateInvitationView } from '@/server/employer/invitations';

import { ContactForm } from '../employer/ContactForm';
import { CandidateLiveDefense, LiveSubStatus } from '../live-defense/LiveDefense';
import { INVITATION_STATUS_LABEL, NO_COMPANY_CONTACT, salaryRange } from '../employer/labels';
import { Button, Kicker, Notice, Panel, Tag } from '../ui';
import styles from './Candidate.module.css';

type Filter = 'all' | 'open' | 'done';
const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'Все' }, { id: 'open', label: 'Жду ответа' }, { id: 'done', label: 'Отвеченные' }];
const isOpen = (status: CandidateInvitationView['status']) => status === 'sent' || status === 'viewed';

export function CandidateInvitations({ invitations, contact, hasRecordingConsent = false }: { invitations: CandidateInvitationView[]; contact: string | null; hasRecordingConsent?: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [local, setLocal] = useState<Record<string, CandidateInvitationView['status']>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Г5 (ADR 0005): раскрытие имени и контактов подтверждается отдельно по каждому приглашению, галочка не отмечена.
  const [disclose, setDisclose] = useState<Record<string, boolean>>({});
  const [revoked, setRevoked] = useState<Record<string, boolean>>({});
  const disclosure = CONSENT_TEXTS.identity_disclosure;
  const current = invitations.map((inv) => ({ ...inv, status: local[inv.id] ?? inv.status, disclosed: revoked[inv.id] ? false : (inv.disclosed ?? local[inv.id] === 'accepted') }));
  const matches = (inv: CandidateInvitationView, value: Filter) => value === 'all' || (value === 'open' ? isOpen(inv.status) : !isOpen(inv.status));
  const visible = current.filter((inv) => matches(inv, filter));
  // lane hired: компания отметила найм — финальный этап пути, показываем сверху.
  const hiredIn = current.find((inv) => inv.status === 'hired');

  async function respond(id: string, action: 'accept' | 'decline') {
    setBusy(id);
    setError(null);
    try {
      const result = await respondInvitationApi(id, action, action === 'accept' ? disclosure.version : undefined);
      // Only known server states may update the contact disclosure message.
      if (result.status !== 'accepted' && result.status !== 'declined') throw new Error('Сервер не подтвердил ответ. Обновите страницу.');
      const status = result.status;
      setLocal((value) => ({ ...value, [id]: status }));
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось ответить на приглашение.'); }
    finally { setBusy(null); }
  }

  async function revokeDisclosure(id: string) {
    setBusy(id);
    setError(null);
    try { await revokeConsentApi('identity_disclosure', id); setRevoked((v) => ({ ...v, [id]: true })); router.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось отозвать раскрытие.'); }
    finally { setBusy(null); }
  }

  return <div className={styles.page}>
    <header className={styles.heading}><Kicker>Предложения компаний</Kicker><h1>Приглашения<i>.</i></h1><p>Вилка, причина и способ связи видны сразу. Компания получит ваше имя и контакт, только когда вы примете приглашение.</p></header>
    <div className={styles.tabs} aria-label="Статус приглашения">{FILTERS.map((item) => <Button key={item.id} size="sm" aria-pressed={filter === item.id} className={filter === item.id ? styles.activeTab : undefined} onClick={() => setFilter(item.id)}>{item.label} · {current.filter((inv) => matches(inv, item.id)).length}</Button>)}</div>
    {error && <Notice tone="error">{error}</Notice>}
    {hiredIn && <Notice data-testid="hired-banner">Нанят в {hiredIn.company.name}{hiredIn.hiredAt ? ` · ${formatDate(hiredIn.hiredAt)}` : ''}. Путь на платформе пройден: другие компании больше не видят ваш профиль в поиске.</Notice>}
    <div className={styles.twoColumns}>
      <div className={styles.stack}>
        {!visible.length ? <Panel className={styles.empty}><h2>Здесь пока пусто.</h2><p>{invitations.length ? 'Приглашений с этим статусом пока нет.' : 'Подтверждайте опыт и навыки: компании смогут найти ваш профиль и отправить предложение.'}</p><Button href="/profile">Открыть профиль</Button></Panel> : visible.map((inv) => <Panel key={inv.id} as="article" className={styles.card} aria-labelledby={`inv-${inv.id}`}>
          <div className={styles.cardHead}><div><span className={styles.letter} aria-hidden="true">{inv.company.name.slice(0, 1)}</span><div><Kicker>{inv.company.name}</Kicker><h2 id={`inv-${inv.id}`}>{inv.vacancy?.title ?? 'Предложение компании'}</h2></div></div><div><Tag className={styles.invitationStatus} data-status={inv.status}>{INVITATION_STATUS_LABEL[inv.status]}</Tag> <LiveSubStatus live={inv.liveDefense} /></div></div>
          <div><p className={styles.salary}>{salaryRange(inv.salaryFrom, inv.salaryTo)}</p><span className={styles.meta}>в месяц{inv.vacancy ? ` · ${inv.vacancy.grade}` : ''}</span></div>
          {inv.redFlags && inv.redFlags.length > 0 && <Notice tone="error" role="note" aria-label="Признаки фиктивного предложения">{inv.redFlags.map((f) => f.candidateNote).join(' ')}</Notice>}
          <div><h3>Почему именно вы</h3><p>{inv.message || 'Компания не добавила сообщение к приглашению.'}</p></div>
          {inv.vacancy?.teamDescription && <p>Команда: {inv.vacancy.teamDescription}</p>}
          {inv.vacancy?.stack.length ? <p className={styles.meta}>Стек: {inv.vacancy.stack.join(', ')}</p> : null}
          <p className={styles.meta}>Связь с компанией: {inv.company.contact ?? NO_COMPANY_CONTACT}</p>
          {inv.company.trust && <p className={styles.meta}>Индекс доверия компании: {inv.company.trust.index} из 100 (концепция: по заполненности профиля, ИНН, возрасту аккаунта и доле отклонений; не гарантия).</p>}
          <div className={styles.timeline}><span data-done="true">Отправлено<b>{formatDate(inv.createdAt)}</b></span><span data-done={inv.status !== 'sent'}>Просмотрено<b>{inv.status === 'sent' ? 'Ожидает просмотра' : 'Приглашение открыто'}</b></span><span data-done={!isOpen(inv.status)}>Ответ<b>{inv.respondedAt ? formatDate(inv.respondedAt) : isOpen(inv.status) ? 'Ждёт решения' : INVITATION_STATUS_LABEL[inv.status]}</b></span>{inv.status === 'hired' && <span data-done="true">Нанят<b>{inv.hiredAt ? formatDate(inv.hiredAt) : 'Компания отметила найм'}</b></span>}</div>
          {isOpen(inv.status) ? <><label className={styles.fine} data-testid="disclosure-check"><input type="checkbox" checked={Boolean(disclose[inv.id])} onChange={(e) => setDisclose((v) => ({ ...v, [inv.id]: e.target.checked }))} /> {disclosure.label} ({inv.company.name}). {disclosure.paragraphs.join(' ')}</label><div className={styles.actions}><Button variant="primary" disabled={busy !== null || !disclose[inv.id]} loading={busy === inv.id} onClick={() => void respond(inv.id, 'accept')}>Принять</Button><Button disabled={busy !== null} onClick={() => void respond(inv.id, 'decline')}>Отклонить</Button></div><p className={styles.fine}>Принять можно только с подтверждением раскрытия. Остальные компании ваше имя и контакт не увидят.</p></> : inv.status === 'hired' ? <p role="status">Компания отметила найм: вы наняты в {inv.company.name}. {inv.disclosed ? 'Она видит ваше имя и способ связи.' : 'Раскрытие отозвано: компания видит псевдоним.'}</p> : inv.status === 'accepted' ? (inv.disclosed ? <div role="status"><p>Контакты открыты: эта компания видит ваше имя и способ связи.</p><Button size="sm" disabled={busy !== null} onClick={() => void revokeDisclosure(inv.id)}>Отозвать раскрытие</Button><p className={styles.fine}>После отзыва компания снова видит псевдоним. Данные, которые она уже получила, отозвать невозможно.</p></div> : <p role="status">Раскрытие отозвано: компания видит псевдоним. Данные, которые она уже получила, отозвать невозможно.</p>) : <p role="status">Вы отклонили приглашение. Компания видит только статус.</p>}
          <CandidateLiveDefense invitationId={inv.id} live={inv.liveDefense} hasRecordingConsent={hasRecordingConsent} />
        </Panel>)}
      </div>
      <aside className={styles.stack}>
        <ContactForm contact={contact} />
        <Panel className={styles.card}><Kicker>Как это работает</Kicker><ol className={styles.requirements}><li>01 · Компания находит анонимную карточку по навыкам и категории.</li><li>02 · Отправляет предложение с зарплатой и способом связи.</li><li>03 · Вы принимаете или отклоняете. Обе стороны видят статус.</li></ol><Button size="sm" href="/settings">Настройки приватности ↗</Button></Panel>
      </aside>
    </div>
  </div>;
}
