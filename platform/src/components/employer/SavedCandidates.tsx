'use client';

import { useState } from 'react';
import type { CandidateCard } from '@/server/employer/privacy';
import { Notice, Panel, Tag } from '@/components/ui';
import { LevelBadge } from '@/components/LevelBadge';
import { SaveCandidateButton } from './SaveCandidateButton';
import { InviteForm } from './InviteForm';
import { CandidateQuestions } from './CandidateQuestions';
import { INVITATION_STATUS_LABEL, NO_CANDIDATE_CONTACT } from './labels';
import type { InvitationStatus } from '@prisma/client';
import styles from './Employer.module.css';

export function SavedCandidates({ scope, cards, unavailable, pendingInvitations = [] }: { scope: string; cards: CandidateCard[]; unavailable: number; pendingInvitations?: { candidateId: string; status: InvitationStatus }[] }) {
  const [removed, setRemoved] = useState<string[]>([]);
  const visible = cards.filter((card) => !removed.includes(card.id));
  return <div className={styles.form}>
    {visible.length === 0 && <Notice>Пока пусто. Нажми «В избранное» у кандидата в подборке или поиске.</Notice>}
    {unavailable > 0 && <Notice>Некоторые сохранённые кандидаты сейчас скрыты или больше не имеют публичных подтверждённых данных: {unavailable}.</Notice>}
    <ul className={styles.list}>{visible.map((card) => <Panel as="li" key={card.id} className={styles.card}>
      <div className={styles.cardHead}><h2>{card.displayName}</h2><SaveCandidateButton scope={scope} candidateId={card.id} initialSaved onChange={(saved) => { if (!saved) setRemoved((ids) => [...ids, card.id]); }} /></div>
      <div className={styles.meta}>{card.category && <Tag tone="solid">{card.category.label} · тест</Tag>}{card.fsp.hasAchievements && <Tag>ФСП</Tag>}</div>
      <div className={styles.claims}>{card.claims.map((claim) => <span key={claim.catalogId} className={styles.claim}><LevelBadge level={claim.level} />{claim.statement}</span>)}</div>
      {card.contacts ? <><div className={styles.contacts}><strong>Контакт открыт</strong><span>{card.contacts.name}</span><span>{card.contacts.contact ?? NO_CANDIDATE_CONTACT}</span></div><CandidateQuestions candidateId={card.id} /></> : <><p className={styles.meta}>Имя и контакты откроются после принятия приглашения.</p>{pendingInvitations.some((invitation) => invitation.candidateId === card.id) ? <p className={styles.status}>Приглашение: {INVITATION_STATUS_LABEL[pendingInvitations.find((invitation) => invitation.candidateId === card.id)!.status]}</p> : <InviteForm candidateId={card.id} candidateName={card.displayName} vacancyId={null} />}</>}
    </Panel>)}</ul>
  </div>;
}
