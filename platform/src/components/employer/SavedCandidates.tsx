'use client';
import { useState } from 'react';
import type { CandidateCard } from '@/server/employer/privacy';
import type { InvitationStatus } from '@prisma/client';
import { Notice } from '@/components/ui';
import { LevelBadge } from '@/components/LevelBadge';
import { CandidateSilhouette } from './CandidateSilhouette';
import { SaveCandidateButton } from './SaveCandidateButton';
import { InviteForm } from './InviteForm';
import { CandidateQuestions } from './CandidateQuestions';
import { INVITATION_STATUS_LABEL, NO_CANDIDATE_CONTACT } from './labels';
import styles from './Employer.module.css';

const SLOTS = [[20, 14], [80, 12], [94, 52], [76, 90], [24, 90], [6, 52]] as const;

export function SavedCandidates({ scope, cards, unavailable, pendingInvitations = [] }: { scope: string; cards: CandidateCard[]; unavailable: number; pendingInvitations?: { candidateId: string; status: InvitationStatus }[] }) {
  const [removed, setRemoved] = useState<string[]>([]);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [selectedId, setSelectedId] = useState(cards[0]?.id);
  const [zoom, setZoom] = useState(100);
  const visible = cards.filter((card) => !removed.includes(card.id));
  const selected = visible.find((card) => card.id === selectedId) ?? visible[0];
  const nodes = visible.slice(0, 6);
  const graph = visible.length > 0 && <section className={styles.explorerOverview} aria-label="Избранные кандидаты">
    <div className={styles.mapHeading}><span>В избранном: {visible.length}</span><small>Сохранённые кандидаты</small></div>
    {view === 'map' && <div className={styles.mapViewport}><div className={styles.matchMap} style={{ transform: `scale(${zoom / 100})` }}>
      <svg className={styles.mapSpokes} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {[22, 34, 47].map((radius) => <ellipse key={radius} className={styles.mapRing} cx="50" cy="50" rx={radius} ry={radius * .85} vectorEffect="non-scaling-stroke" />)}
        {nodes.map((card, index) => { const [x, y] = SLOTS[index]!; return <g key={card.id} data-selected={card.id === selected?.id}><line x1="50" y1="50" x2={x} y2={y} vectorEffect="non-scaling-stroke" /></g>; })}
      </svg>
      <div className={styles.mapCenter}><span>☆</span><strong>Избранное</strong></div>
      {nodes.map((card, index) => { const [x, y] = SLOTS[index]!; return <button key={card.id} type="button" className={styles.mapNode} style={{ left: `${x}%`, top: `${y}%` }} aria-pressed={card.id === selected?.id} onClick={() => { setSelectedId(card.id); document.getElementById(`saved-candidate-${card.id}`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }}>
        <CandidateSilhouette className={card.category ? styles.confirmedAvatar : styles.unconfirmedAvatar} /><strong>{card.displayName}</strong><small>{card.category?.label ?? 'Без категории из теста'}</small>
      </button>; })}
    </div></div>}
    <div className={styles.mapFooter}>{view === 'map' && <div className={styles.mapZoom}><button type="button" aria-label="Уменьшить карту" disabled={zoom <= 70} onClick={() => setZoom((value) => value - 10)}>−</button><output aria-label="Масштаб карты">{zoom}%</output><button type="button" aria-label="Увеличить карту" disabled={zoom >= 130} onClick={() => setZoom((value) => value + 10)}>+</button></div>}<div className={styles.modeButtons}><button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>⌘ Карта</button><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>☰ Список</button></div><p>{nodes.length < visible.length ? `На карте ${nodes.length}; все ${visible.length} кандидатов в списке ниже` : 'Карточки кандидатов – в списке ниже'}</p></div>
    </section>;
  return <div className={styles.form}>{visible.length === 0 && <Notice>Пока пусто. Нажми «В избранное» у кандидата в подборке или поиске.</Notice>}{unavailable > 0 && <Notice>Некоторые сохранённые кандидаты сейчас скрыты или больше не имеют публичных подтверждённых данных: {unavailable}.</Notice>}{view === 'map' ? graph : visible.length > 0 && <div className={styles.modeButtons}><button type="button" aria-pressed={false} onClick={() => setView('map')}>⌘ Карта</button><button type="button" aria-pressed={true}>☰ Список</button></div>}<ul className={`${styles.list} ${styles.compactRows}`}>{visible.map((card) => { const invitation = pendingInvitations.find((item) => item.candidateId === card.id); return <li key={card.id} id={`saved-candidate-${card.id}`} aria-current={card.id === selected?.id ? 'true' : undefined} className={styles.candidateRow}><CandidateSilhouette /><div className={styles.candidateRowBody}><h2>{card.displayName}</h2><p>{card.category?.label ?? 'Без категории из теста'}{card.fsp.hasAchievements && ' · ФСП'}</p><p>{card.claims.length} подтверждённых карточек навыков</p></div><SaveCandidateButton scope={scope} candidateId={card.id} initialSaved compact onChange={(saved) => { if (!saved) setRemoved((ids) => [...ids, card.id]); }} />{!card.contacts && (invitation ? <span className={styles.invitationStatus} data-status={invitation.status}>Приглашение: {INVITATION_STATUS_LABEL[invitation.status]}</span> : <InviteForm candidateId={card.id} candidateName={card.displayName} vacancyId={null} matchSource="favorites" />)}<details className={styles.rowDetails}><summary>Навыки и контакт →</summary><div className={styles.claims}>{card.claims.map((claim) => <span key={claim.catalogId} className={styles.claim}><LevelBadge level={claim.level} />{claim.statement}</span>)}</div>{card.contacts ? <><div className={styles.contacts}><strong>{card.contacts.name}</strong><span>{card.contacts.contact ?? NO_CANDIDATE_CONTACT}</span></div><CandidateQuestions candidateId={card.id} /></> : <p className={styles.meta}>Имя и контакты откроются после принятия приглашения.</p>}</details></li>; })}</ul></div>;
}
