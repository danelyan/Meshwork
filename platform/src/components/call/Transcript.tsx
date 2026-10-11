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
        <li key={e.index} className={cx(styles.entry, styles[e.role])} data-role={e.role}>
          <span className={styles.who}>
            {e.role === selfRole ? 'Вы' : e.role === 'employer' && e.defense?.speaker ? `${WHO.employer} · ${e.defense.speaker}` : WHO[e.role]}
          </span>
          {e.text}
        </li>
      ))}
      <li ref={end} aria-hidden="true" />
    </ol>
  );
}

const CRITERION = { depth: 'Глубина', why: '«Почему так»', boundary: 'Граница знаний', completion: 'Доведение' } as const;

/** Итог защиты: балл по каждому вопросу (карта «вопрос/файл → балл»), общий – среднее; флаги, пояснение. Без вердикта о подлинности. */
export function VerdictView({ verdict }: { verdict: DefenseRoomVerdict }) {
  const exact = verdict.totalMean ?? verdict.total;
  const items = verdict.items ?? [];
  return (
    <section className={styles.verdict} aria-label="Итог защиты" data-testid="defense-verdict">
      <p className={styles.total}>{exact === null ? 'Без оценки' : `${String(exact).replace('.', ',')} из 8`}</p>
      {verdict.scores && (
        <ul className={styles.scores}>
          {(Object.keys(CRITERION) as (keyof typeof CRITERION)[]).map((k) => (
            <li key={k}>
              {CRITERION[k]}: <b>{verdict.scores![k]}/2</b>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <ol className={styles.items} aria-label="Баллы по вопросам" data-testid="defense-items">
          {items.map((i) => (
            <li key={i.itemId} className={styles.itemRow} data-passed={i.passed}>
              <span className={styles.itemLabel}>{i.label}</span>
              <b className={styles.itemScore}>{i.total} из 8</b>
              <span className={styles.itemBar} aria-hidden="true">
                {Array.from({ length: 8 }, (_, n) => (
                  <i key={n} className={cx(styles.itemCell, n < i.total && styles.itemOn)} />
                ))}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className={styles.summary}>{verdict.summary}</p>
      {verdict.runs.length > 1 && (
        <p className={styles.meta}>
          Прогоны оценщика: {verdict.runs.map((r) => String(r).replace('.', ',')).join(', ')} ({items.length ? 'среднее по вопросам, медиана прогонов внутри вопроса' : 'медиана по каждому признаку'})
        </p>
      )}
    </section>
  );
}
