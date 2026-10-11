'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { MatchItem } from '@/server/employer/matching';
import { Notice } from '@/components/ui';
import { CandidateSilhouette } from './CandidateSilhouette';
import { CandidateMatchCard } from './CandidateMatchCard';
import { SaveCandidateButton } from './SaveCandidateButton';
import { InviteForm } from './InviteForm';
import { INVITATION_STATUS_LABEL } from './labels';
import styles from './Employer.module.css';

/**
 * Строки выдачи поиска по базе. Поле сверху фильтрует только показанные строки: `total` - размер всей выдачи,
 * `moreHref` - адрес той же выдачи с большим limit (MatchResults), чтобы искать по остальным.
 */
export function CandidateSearchRows({ items, scope, total = items.length, moreHref }: { items: MatchItem[]; scope?: string; total?: number; moreHref?: string }) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const partial = total > items.length;
  const showAll = partial && moreHref ? <Link href={moreHref} scroll={false} prefetch={false}>Показать остальных</Link> : null;
  const visible = items.filter((item) => `${item.candidate.displayName} ${item.candidate.category?.label ?? ''} ${item.candidate.claims.map((claim) => claim.statement).join(' ')}`.toLowerCase().includes(normalized));
  return <section className={styles.form} aria-label="Результаты поиска"><div className={styles.searchInput}><input aria-label={partial ? `Фильтр по показанным кандидатам: ${items.length} из ${total}` : 'Фильтр по найденным кандидатам'} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={partial ? 'Фильтр по показанным: навык, специализация или номер' : 'Навык, специализация или номер кандидата'} /><span className={styles.meta}>{visible.length}</span></div>{partial && normalized && <p className={styles.searchScope} role="status">Фильтр ищет только среди показанных {items.length} из {total}. {showAll}</p>}<ul className={`${styles.list} ${styles.compactRows}`}>{visible.map((item) => <li key={item.candidateId} className={styles.candidateRow}><CandidateSilhouette /><div className={styles.candidateRowBody}><h2>{item.candidate.displayName}</h2><p>{item.candidate.category?.label ?? 'Без категории из теста'}{item.candidate.fsp.hasAchievements && ' · ФСП'}</p><div className={styles.skillChips}>{item.explanation.stackMatched.slice(0, 4).map((skill) => <span key={skill}>{skill}</span>)}</div></div><span className={styles.meta}>{item.covered}/{item.total} требований</span>{scope && <SaveCandidateButton scope={scope} candidateId={item.candidateId} compact />}{item.invitation && ['sent', 'viewed', 'accepted'].includes(item.invitation.status) ? <span className={styles.invitationStatus} data-status={item.invitation.status}>{INVITATION_STATUS_LABEL[item.invitation.status]}</span> : <InviteForm candidateId={item.candidateId} candidateName={item.candidate.displayName} vacancyId={null} matchRank={item.rank} matchSource="search" />}<details className={styles.rowDetails}><summary>Навыки и доказательства →</summary><ul className={styles.list}><CandidateMatchCard item={item} vacancyId={null} compact matchSource="search" /></ul></details></li>)}</ul>{!visible.length && <Notice>{partial ? `Среди показанных ${items.length} совпадений нет. Остальные ${total - items.length} не загружены - покажи их или измени запрос и фильтры выше.` : 'В этой выдаче нет совпадений. Измени запрос или фильтры выше.'}</Notice>}</section>;
}
