'use client';

import { useEffect, useRef } from 'react';

import type { DefenseRoomVerdict, TranscriptEntry } from '@/server/defense-room/types';

import { cx } from '../ui';

import styles from './call.module.css';

const WHO = { ai: 'ИИ-интервьюер', candidate: 'Кандидат', employer: 'Работодатель' } as const;

/** Лента реплик звонка: ИИ и работодатель слева, кандидат справа. Прокручивается к последней. */
export function Transcript({ entries, selfRole }: { entries: TranscriptEntry[]; selfRole: 'candidate' | 'employer' }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => end.current?.scrollIntoView?.({ block: 'end' }), [entries.length]);
  return (
    <ol className={styles.thread} aria-live="polite" data-testid="call-transcript">
      {entries.map((e) => (
        <li key={e.seq} className={cx(styles.entry, styles[e.role])} data-role={e.role}>
          <span className={styles.who}>
            {e.role === selfRole ? 'Вы' : e.role === 'employer' && e.speaker ? `${WHO.employer} · ${e.speaker}` : WHO[e.role]}
          </span>
          {e.text}
        </li>
      ))}
      <li ref={end} aria-hidden="true" />
    </ol>
  );
}

const CRITERION = { depth: 'Глубина', why: '«Почему так»', boundary: 'Граница знаний', completion: 'Доведение' } as const;

/** Итог защиты: медиана рубрики A-02, флаги, пояснение. Без вердикта о подлинности. */
export function VerdictView({ verdict }: { verdict: DefenseRoomVerdict }) {
  return (
    <section className={styles.verdict} aria-label="Итог защиты" data-testid="defense-verdict">
      <p className={styles.total}>{verdict.total === null ? 'Без оценки' : `${verdict.total} из 8`}</p>
      {verdict.scores && (
        <ul className={styles.scores}>
          {(Object.keys(CRITERION) as (keyof typeof CRITERION)[]).map((k) => (
            <li key={k}>
              {CRITERION[k]}: <b>{verdict.scores![k]}/2</b>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.summary}>{verdict.summary}</p>
      {verdict.runs.length > 1 && <p className={styles.meta}>Прогоны оценщика: {verdict.runs.join(', ')} (медиана по каждому признаку)</p>}
    </section>
  );
}
