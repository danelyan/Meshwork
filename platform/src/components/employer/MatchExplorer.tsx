'use client';

import { useState } from 'react';
import type { MatchItem } from '@/server/employer/matching';
import { CandidateMatchCard } from './CandidateMatchCard';
import { CandidateSilhouette } from './CandidateSilhouette';
import styles from './Employer.module.css';

const SLOTS = [[20, 14], [80, 12], [94, 52], [76, 90], [24, 90], [6, 52]] as const;
const coveragePercent = (item: MatchItem) => item.total ? Math.round(item.covered / item.total * 100) : 0;

/** Same server ranking in both views. Six visible graph nodes; the list retains every result. */
export function MatchExplorer({ items, vacancyId, vacancyTitle, companyName = 'Компания', defaultSalary, favoriteScope }: {
  items: MatchItem[]; vacancyId: string | null; vacancyTitle?: string; companyName?: string;
  defaultSalary?: { from: number; to: number }; favoriteScope?: string;
}) {
  const [view, setView] = useState<'map' | 'list'>(vacancyId ? 'map' : 'list');
  const [selectedId, setSelectedId] = useState(items[0]?.candidateId);
  const selected = items.find((item) => item.candidateId === selectedId) ?? items[0];
  const visible = items.slice(0, 6);
  if (!selected) return null;
  return <section className={styles.explorer} aria-label="Подборка кандидатов">
    <div className={styles.explorerOverview}>
      <div className={styles.mapHeading}><span>{items.length} кандидатов в подборке</span><small>По подтверждённым данным</small></div>
      {view === 'map' ? <div className={styles.matchMap}>
        <svg className={styles.mapSpokes} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {visible.map((item, index) => { const [x, y] = SLOTS[index]!; return <g key={item.candidateId} data-selected={item.candidateId === selected.candidateId}><line x1="50" y1="50" x2={x} y2={y} vectorEffect="non-scaling-stroke" /><circle r=".7"><animateMotion dur={`${3 + index * .3}s`} repeatCount="indefinite" path={`M50,50 L${x},${y}`} /></circle></g>; })}
        </svg>
        <div className={styles.mapCenter}><span>{companyName.slice(0, 1)}</span><strong>{companyName}</strong><small>{vacancyTitle}</small></div>
        {visible.map((item, index) => { const [x, y] = SLOTS[index]!; return <button key={item.candidateId} type="button" className={styles.mapNode} style={{ left: `${x}%`, top: `${y}%` }} aria-pressed={item.candidateId === selected.candidateId} onClick={() => setSelectedId(item.candidateId)}>
          <CandidateSilhouette className={item.candidate.category ? styles.confirmedAvatar : styles.unconfirmedAvatar} /><strong>{item.candidate.displayName}</strong><small>{item.candidate.category?.label ?? 'Без категории из теста'}</small>
        </button>; })}
        {visible.map((item, index) => { const [x, y] = SLOTS[index]!; return <span key={item.candidateId} className={styles.spokeScore} data-selected={item.candidateId === selected.candidateId} style={{ left: `${50 + (x - 50) * .55}%`, top: `${50 + (y - 50) * .55}%` }}>{coveragePercent(item)}%</span>; })}
      </div> : <ol className={styles.resultRows}>{items.map((item) => <li key={item.candidateId}><button className={styles.resultRow} aria-pressed={item.candidateId === selected.candidateId} onClick={() => setSelectedId(item.candidateId)}><span className={styles.nodeRank}>{item.rank}</span><span><strong>{item.candidate.displayName}</strong><small>{item.candidate.category?.label ?? 'Без категории из теста'}</small></span><span className={styles.nodeScore}>{coveragePercent(item)}%<small>{item.covered}/{item.total} требований</small></span></button></li>)}</ol>}
      <div className={styles.mapFooter}><div className={styles.modeButtons}><button aria-pressed={view === 'map'} onClick={() => setView('map')}>⌘ Карта</button><button aria-pressed={view === 'list'} onClick={() => setView('list')}>☰ Список</button></div><p>□ Категория подтверждена<br /><span>━</span> Покрытие требований{items.length > 6 && <><br />Все {items.length} кандидатов в списке</>}</p></div>
    </div>
    <div className={styles.selectedCandidate} aria-live="polite"><div className={styles.explorerBar}><span className={styles.status}>Кандидат в подборке</span><span className={styles.rank}>{selected.rank} из {items.length}</span></div><ol className={styles.list}><CandidateMatchCard key={selected.candidateId} item={selected} vacancyId={vacancyId} defaultSalary={defaultSalary} favoriteScope={favoriteScope} compact /></ol></div>
  </section>;
}
