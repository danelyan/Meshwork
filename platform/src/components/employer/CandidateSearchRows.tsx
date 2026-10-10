'use client';
import { useState } from 'react';
import type { MatchItem } from '@/server/employer/matching';
import { Notice } from '@/components/ui';
import { CandidateSilhouette } from './CandidateSilhouette';
import { CandidateMatchCard } from './CandidateMatchCard';
import { SaveCandidateButton } from './SaveCandidateButton';
import { InviteForm } from './InviteForm';
import { INVITATION_STATUS_LABEL } from './labels';
import styles from './Employer.module.css';

export function CandidateSearchRows({ items, scope }: { items: MatchItem[]; scope?: string }) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const visible = items.filter((item) => `${item.candidate.displayName} ${item.candidate.category?.label ?? ''} ${item.candidate.claims.map((claim) => claim.statement).join(' ')}`.toLowerCase().includes(normalized));
  return <section className={styles.form} aria-label="Результаты поиска"><div className={styles.searchInput}><input aria-label="Поиск среди найденных кандидатов" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Навык, специализация или номер кандидата" /><span className={styles.meta}>{visible.length}</span></div><ul className={`${styles.list} ${styles.compactRows}`}>{visible.map((item) => <li key={item.candidateId} className={styles.candidateRow}><CandidateSilhouette /><div className={styles.candidateRowBody}><h2>{item.candidate.displayName}</h2><p>{item.candidate.category?.label ?? 'Без категории из теста'}{item.candidate.fsp.hasAchievements && ' · ФСП'}</p><div className={styles.skillChips}>{item.explanation.stackMatched.slice(0, 4).map((skill) => <span key={skill}>{skill}</span>)}</div></div><span className={styles.meta}>{item.covered}/{item.total} требований</span>{scope && <SaveCandidateButton scope={scope} candidateId={item.candidateId} compact />}{item.invitation && ['sent', 'viewed', 'accepted'].includes(item.invitation.status) ? <span className={styles.invitationStatus} data-status={item.invitation.status}>{INVITATION_STATUS_LABEL[item.invitation.status]}</span> : <InviteForm candidateId={item.candidateId} candidateName={item.candidate.displayName} vacancyId={null} />}<details className={styles.rowDetails}><summary>Навыки и доказательства →</summary><ul className={styles.list}><CandidateMatchCard item={item} vacancyId={null} compact /></ul></details></li>)}</ul>{!visible.length && <Notice>В этой выдаче нет совпадений. Измени запрос или фильтры выше.</Notice>}</section>;
}
