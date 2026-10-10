'use client';

import { useState } from 'react';

import type { MatchItem } from '@/server/employer/matching';
import { Button } from '@/components/ui';

import { CandidateMatchCard } from './CandidateMatchCard';
import styles from './Employer.module.css';

/** Both views use the same server-ranked, privacy-filtered results. */
export function MatchExplorer({ items, vacancyId, vacancyTitle, defaultSalary, favoriteScope }: {
  items: MatchItem[];
  vacancyId: string | null;
  vacancyTitle?: string;
  defaultSalary?: { from: number; to: number };
  favoriteScope?: string;
}) {
  const [view, setView] = useState<'map' | 'list'>(vacancyId ? 'map' : 'list');
  const [selectedId, setSelectedId] = useState(items[0]?.candidateId);
  const selected = items.find((item) => item.candidateId === selectedId) ?? items[0];
  if (!selected) return null;
  return (
    <section className={styles.explorer} aria-label="Подборка кандидатов">
      <div className={styles.explorerOverview}>
        <div className={styles.explorerBar}>
          <span className={styles.status}>Подборка · {items.length} кандидатов</span>
          <div className={styles.actions} aria-label="Вид подборки">
            <Button size="sm" variant={view === 'map' ? 'primary' : 'ghost'} aria-pressed={view === 'map'} onClick={() => setView('map')}>Карта</Button>
            <Button size="sm" variant={view === 'list' ? 'primary' : 'ghost'} aria-pressed={view === 'list'} onClick={() => setView('list')}>Список</Button>
          </div>
        </div>
        {view === 'map' ? (
          <div className={styles.matchMap}>
            <div className={styles.mapCenter}><span aria-hidden="true">✳</span><strong>{vacancyTitle ?? 'База кандидатов'}</strong><small>Подтверждённые навыки</small></div>
            <div className={styles.mapNodes}>
              {items.map((item) => (
                <button key={item.candidateId} type="button" className={styles.mapNode} aria-pressed={item.candidateId === selected.candidateId} onClick={() => setSelectedId(item.candidateId)}>
                  <span className={styles.nodeRank}>#{item.rank}</span>
                  <strong>{item.candidate.displayName}</strong>
                  <small>{item.candidate.category?.label ?? 'Без категории из теста'}</small>
                  <span className={styles.nodeScore}>{item.covered}/{item.total} требований {item.candidate.fsp.hasAchievements && '· ФСП'}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className={styles.resultRows}>
            {items.map((item) => (
              <li key={item.candidateId}>
                <button className={styles.resultRow} aria-pressed={item.candidateId === selected.candidateId} onClick={() => setSelectedId(item.candidateId)}>
                  <span className={styles.nodeRank}>{item.rank}</span>
                  <span><strong>{item.candidate.displayName}</strong><small>{item.candidate.category?.label ?? 'Без категории из теста'}{item.candidate.fsp.hasAchievements && ' · ФСП'}</small></span>
                  <span className={styles.nodeScore}>{item.covered}/{item.total}<small>требований</small></span>
                </button>
              </li>
            ))}
          </ol>
        )}
        <p className={styles.mapNote}>Порядок определён покрытием требований и уровнем доказанности. Выбери кандидата, чтобы увидеть обоснование.</p>
      </div>
      <div className={styles.selectedCandidate} aria-live="polite">
        <div className={styles.explorerBar}><span className={styles.status}>Кандидат в подборке</span><span className={styles.rank}>{selected.rank} из {items.length}</span></div>
        <ol className={styles.list}><CandidateMatchCard key={selected.candidateId} item={selected} vacancyId={vacancyId} defaultSalary={defaultSalary} favoriteScope={favoriteScope} /></ol>
      </div>
    </section>
  );
}
