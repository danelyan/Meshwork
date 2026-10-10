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

export function SavedCandidates({ scope, cards, unavailable, pendingInvitations = [] }: { scope: string; cards: CandidateCard[]; unavailable: number; pendingInvitations?: { candidateId: string; status: InvitationStatus }[] }) {
  const [removed, setRemoved] = useState<string[]>([]);
  const visible = cards.filter((card) => !removed.includes(card.id));
  return <div className={styles.form}>{visible.length === 0 && <Notice>Пока пусто. Нажми «В избранное» у кандидата в подборке или поиске.</Notice>}{unavailable > 0 && <Notice>Некоторые сохранённые кандидаты сейчас скрыты или больше не имеют публичных подтверждённых данных: {unavailable}.</Notice>}<ul className={`${styles.list} ${styles.compactRows}`}>{visible.map((card) => { const invitation = pendingInvitations.find((item) => item.candidateId === card.id); return <li key={card.id} className={styles.candidateRow}><CandidateSilhouette /><div className={styles.candidateRowBody}><h2>{card.displayName}</h2><p>{card.category?.label ?? 'Без категории из теста'}{card.fsp.hasAchievements && ' · ФСП'}</p><p>{card.claims.length} подтверждённых карточек навыков</p></div><SaveCandidateButton scope={scope} candidateId={card.id} initialSaved compact onChange={(saved) => { if (!saved) setRemoved((ids) => [...ids, card.id]); }} />{!card.contacts && (invitation ? <span className={styles.invitationStatus} data-status={invitation.status}>Приглашение: {INVITATION_STATUS_LABEL[invitation.status]}</span> : <InviteForm candidateId={card.id} candidateName={card.displayName} vacancyId={null} />)}<details className={styles.rowDetails}><summary>Навыки и контакт →</summary><div className={styles.claims}>{card.claims.map((claim) => <span key={claim.catalogId} className={styles.claim}><LevelBadge level={claim.level} />{claim.statement}</span>)}</div>{card.contacts ? <><div className={styles.contacts}><strong>{card.contacts.name}</strong><span>{card.contacts.contact ?? NO_CANDIDATE_CONTACT}</span></div><CandidateQuestions candidateId={card.id} /></> : <p className={styles.meta}>Имя и контакты откроются после принятия приглашения.</p>}</details></li>; })}</ul></div>;
}
