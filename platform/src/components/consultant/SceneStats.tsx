'use client';

import type { SceneAsideData } from '@/server/consultant/aside';

import { useAsideData } from './aside-refresh';
import styles from './SceneStats.module.css';

/** Сводка кандидата на сцене рядом с головой; данные — те же, что у правой колонки, и обновляются вместе с ней. */
export function SceneStats({ initial, className }: { initial?: SceneAsideData; className?: string }) {
  const stats = (useAsideData() ?? initial)?.stats;
  if (!stats?.length) return null;
  return (
    <dl className={[styles.stats, className].filter(Boolean).join(' ')} data-testid="scene-stats" aria-label="Сводка">
      {stats.map((s) => (
        <div key={s.label} className={styles.stat}>
          <dt className={styles.label}>{s.label}</dt>
          <dd className={styles.value}>{s.value}</dd>
          <dd className={styles.note}>{s.note}</dd>
        </div>
      ))}
    </dl>
  );
}
