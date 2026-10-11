'use client';

import { useState } from 'react';
import type { MatchItem } from '@/server/employer/matching';
import { Button } from '../ui';
import { CandidateMatchCard } from './CandidateMatchCard';
import { CompareDialog } from './CompareDialog';
import styles from './Employer.module.css';

const coveragePercent = (item: MatchItem) => item.total ? Math.round(item.covered / item.total * 100) : 0;

/** Ranked list with candidate details and comparison; maps belong in favorites. */
export function MatchExplorer({ items, vacancyId, defaultSalary, favoriteScope }: {
  items: MatchItem[]; vacancyId: string | null; vacancyTitle?: string; companyName?: string;
  defaultSalary?: { from: number; to: number }; favoriteScope?: string;
}) {
  const [selectedId, setSelectedId] = useState(items[0]?.candidateId);
  const [picked, setPicked] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const toggle = (id: string) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? [p[1]!, id] : [...p, id]);
  const selected = items.find((item) => item.candidateId === selectedId) ?? items[0];
  if (!selected) return null;
  const pair = picked.length === 2 && vacancyId ? picked.map((id) => items.find((i) => i.candidateId === id)).filter((i): i is MatchItem => Boolean(i)) : [];
  return <section className={styles.explorer} aria-label="Подборка кандидатов">
    <div className={styles.explorerOverview}>
      <div className={styles.mapHeading}><span>{items.length} кандидатов в подборке</span><small>По подтверждённым данным</small></div>
      <ol className={styles.resultRows}>{items.map((item) => <li key={item.candidateId} className={styles.resultItem}>{vacancyId && <input type="checkbox" className={styles.compareCheck} checked={picked.includes(item.candidateId)} onChange={() => toggle(item.candidateId)} aria-label={`Сравнить: ${item.candidate.displayName}`} />}<button className={styles.resultRow} aria-pressed={item.candidateId === selected.candidateId} onClick={() => setSelectedId(item.candidateId)}><span className={styles.nodeRank}>{item.rank}</span><span><strong>{item.candidate.displayName}</strong><small>{item.candidate.category?.label ?? 'Без категории из теста'}</small></span><span className={styles.nodeScore}>{coveragePercent(item)}%<small>{item.covered}/{item.total} требований</small></span></button></li>)}</ol>

    </div>
    <div className={styles.selectedCandidate} aria-live="polite"><div className={styles.explorerBar}><span className={styles.status}>Кандидат в подборке</span><span className={styles.rank}>{selected.rank} из {items.length}</span>{vacancyId && <Button size="sm" aria-pressed={picked.includes(selected.candidateId)} onClick={() => toggle(selected.candidateId)}>{picked.includes(selected.candidateId) ? '✓ В сравнении' : 'Сравнить'}</Button>}</div><ol className={styles.list}><CandidateMatchCard key={selected.candidateId} item={selected} vacancyId={vacancyId} defaultSalary={defaultSalary} favoriteScope={favoriteScope} compact /></ol></div>
    {vacancyId && picked.length > 0 && <div className={styles.compareBar} role="status"><span>К сравнению: {picked.length} из 2</span><Button variant="cta" size="sm" disabled={pair.length !== 2} onClick={() => setComparing(true)}>Сравнить двоих</Button><Button size="sm" onClick={() => setPicked([])}>Сбросить</Button></div>}
    {comparing && vacancyId && pair.length === 2 && <CompareDialog vacancyId={vacancyId} a={{ id: pair[0]!.candidateId, name: pair[0]!.candidate.displayName }} b={{ id: pair[1]!.candidateId, name: pair[1]!.candidate.displayName }} onClose={() => setComparing(false)} />}
  </section>;
}
